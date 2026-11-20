import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ProjectRole } from "../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";
import { INTEGRATION_OPERATIONS_QUEUE } from "./integration-operations.tokens";
import { Inject } from "@nestjs/common";
import type {
  IntegrationOperationsQueue,
  QueueJob,
} from "./integration-operations.types";

const JOB_SCAN_LIMIT = 1_000;
const EVENT_LIMIT = 100;
const READ_ROLES = new Set<string>([
  ProjectRole.ADMIN,
  ProjectRole.RELEASE_MANAGER,
  ProjectRole.DEVELOPER,
  ProjectRole.REVIEWER,
]);
const RETRY_ROLES = new Set<string>([
  ProjectRole.ADMIN,
  ProjectRole.RELEASE_MANAGER,
]);

type Actor = { id: string; isSystemAdmin: boolean };

@Injectable()
export class IntegrationOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(INTEGRATION_OPERATIONS_QUEUE)
    private readonly queue: IntegrationOperationsQueue,
  ) {}

  async list(actor: Actor, projectId: string) {
    const role = await this.requireProjectRole(actor, projectId);
    if (!role || (!actor.isSystemAdmin && !READ_ROLES.has(role))) {
      throw new ForbiddenException("Integration diagnostics are unavailable");
    }

    const [auditRows, suggestions, repositories] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { projectId, entityType: "WebhookEvent" },
        select: { entityId: true },
      }),
      this.prisma.integrationSuggestion.findMany({
        where: { projectId },
        select: { webhookEventId: true },
      }),
      this.prisma.projectRepository.findMany({
        where: { projectId, provider: "github" },
        select: { owner: true, name: true },
      }),
    ]);
    const repositoryNames = new Set(
      repositories.map((repository) =>
        `${repository.owner}/${repository.name}`.toLowerCase(),
      ),
    );
    const projectEventIds = new Set<string>();
    for (const row of auditRows)
      if (row.entityId) projectEventIds.add(row.entityId);
    for (const row of suggestions) projectEventIds.add(row.webhookEventId);

    const states = ["waiting", "active", "delayed", "failed", "completed"];
    const jobs = await this.queue.getJobs(states, 0, JOB_SCAN_LIMIT - 1, false);
    const projectJobs: Array<{ job: QueueJob; state: string }> = [];
    for (const job of jobs) {
      let state: string;
      try {
        state = await job.getState();
      } catch {
        continue;
      }
      if (jobBelongsToProject(job, projectId, repositoryNames)) {
        projectJobs.push({ job, state });
        const eventId = normalizedEventId(job);
        if (eventId) projectEventIds.add(eventId);
      }
    }

    const ids = [...projectEventIds];
    const eventRows = ids.length
      ? await this.prisma.webhookEvent.findMany({
          where: { id: { in: ids } },
          orderBy: { receivedAt: "desc" },
          take: EVENT_LIMIT,
          select: {
            id: true,
            provider: true,
            eventType: true,
            status: true,
            receivedAt: true,
            processedAt: true,
          },
        })
      : [];

    const jobsByEventId = new Map<string, { job: QueueJob; state: string }>();
    for (const entry of projectJobs) {
      const eventId = normalizedEventId(entry.job);
      if (eventId) jobsByEventId.set(eventId, entry);
    }
    let waiting = 0;
    let active = 0;
    let delayed = 0;
    let failed = 0;
    let completed = 0;
    let rateLimited = 0;
    for (const { job, state } of projectJobs) {
      if (state === "waiting" || state === "waiting-children") waiting += 1;
      else if (state === "active") active += 1;
      else if (state === "delayed") delayed += 1;
      else if (state === "failed") {
        failed += 1;
        if (safeErrorCode(job.failedReason) === "RATE_LIMITED")
          rateLimited += 1;
      } else if (state === "completed") completed += 1;
    }

    const events = eventRows.map((event) => {
      const entry = jobsByEventId.get(event.id);
      const job = entry?.job;
      const state = entry?.state ?? null;
      const retryable =
        state === "failed" && !!job && hasNormalizedPayload(job, event.id);
      return {
        id: event.id,
        provider: event.provider,
        eventType: event.eventType,
        status: event.status,
        attempts: job?.attemptsMade ?? 0,
        queueState: state,
        errorCode:
          state === "failed" && job ? safeErrorCode(job.failedReason) : null,
        receivedAt: event.receivedAt,
        completedAt:
          event.processedAt ??
          (state === "completed" ? dateFromMillis(job?.finishedOn) : null),
        retryable,
        retryUnavailableReason:
          state === "failed" && !retryable
            ? "The retained normalized job payload is unavailable. This event cannot be retried from RDPS."
            : null,
      };
    });

    return {
      events,
      counts: {
        waiting,
        active,
        delayed,
        failed,
        completed,
        errors: failed,
        rateLimited,
      },
      truncated:
        jobs.length >= JOB_SCAN_LIMIT || projectEventIds.size > EVENT_LIMIT,
      scannedJobs: jobs.length,
    };
  }

  async retry(actor: Actor, projectId: string, eventId: string) {
    const role = await this.requireProjectRole(actor, projectId);
    if (!actor.isSystemAdmin && (!role || !RETRY_ROLES.has(role))) {
      throw new ForbiddenException(
        "Administrator or release manager access is required",
      );
    }
    const event = await this.prisma.webhookEvent.findFirst({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) throw new NotFoundException("Webhook event not found");

    const repositories = await this.prisma.projectRepository.findMany({
      where: { projectId, provider: "github" },
      select: { owner: true, name: true },
    });
    const repositoryNames = new Set(
      repositories.map((repository) =>
        `${repository.owner}/${repository.name}`.toLowerCase(),
      ),
    );
    const job = await this.queue.getJob(`webhook-${eventId}`);
    if (
      !job ||
      (await job.getState()) !== "failed" ||
      !hasNormalizedPayload(job, eventId) ||
      !jobBelongsToProject(job, projectId, repositoryNames)
    ) {
      throw new NotFoundException(
        "Retained failed webhook job not found for this project",
      );
    }

    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        projectId,
        action: "integration.webhook.retry_requested",
        entityType: "WebhookEvent",
        entityId: eventId,
        metadata: {
          queue: "webhooks",
          queueJobId: job.id ?? `webhook-${eventId}`,
          previousAttempts: job.attemptsMade,
          previousState: "failed",
        },
      },
    });
    try {
      await job.retry();
    } catch {
      throw new ServiceUnavailableException(
        "The retry attempt was recorded, but the queue could not accept it.",
      );
    }
    return {
      retried: true,
      eventId,
      queueJobId: job.id ?? `webhook-${eventId}`,
    };
  }

  private async requireProjectRole(actor: Actor, projectId: string) {
    if (actor.isSystemAdmin) return "SYSTEM_ADMIN";
    const membership = await this.prisma.projectMember.findFirst({
      where: { projectId, userId: actor.id },
      select: { role: true },
    });
    if (!membership) throw new NotFoundException("Project not found");
    return membership.role as string;
  }
}

function normalizedEventId(job: QueueJob): string | null {
  const id = job.data?.eventId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function jobBelongsToProject(
  job: QueueJob,
  projectId: string,
  repositoryNames: Set<string>,
): boolean {
  const data = job.data;
  if (!data || typeof data !== "object") return false;
  if (data.kind === "deployment") return data.projectId === projectId;
  return (
    data.kind === "github" &&
    typeof data.repository === "string" &&
    repositoryNames.has(data.repository.toLowerCase())
  );
}

function hasNormalizedPayload(job: QueueJob, eventId: string): boolean {
  const data = job.data;
  if (!data || data.eventId !== eventId) return false;
  if (data.kind === "deployment") {
    const statuses = [
      "queued",
      "in_progress",
      "succeeded",
      "failed",
      "cancelled",
    ];
    return (
      [
        data.provider,
        data.projectId,
        data.releaseId,
        data.environmentId,
        data.deploymentId,
      ].every((value) => typeof value === "string" && value.length > 0) &&
      statuses.includes(data.status) &&
      typeof data.occurredAt === "string" &&
      Number.isFinite(Date.parse(data.occurredAt))
    );
  }
  const eventTypes = ["push", "pull_request", "issues", "release"];
  const referenceKinds = ["commit", "pull_request", "issue", "tag"];
  return (
    data.kind === "github" &&
    typeof data.repository === "string" &&
    eventTypes.includes(data.eventType) &&
    typeof data.action === "string" &&
    !!data.reference &&
    typeof data.reference === "object" &&
    referenceKinds.includes(data.reference.kind) &&
    typeof data.reference.externalId === "string" &&
    (data.reference.revision === undefined ||
      typeof data.reference.revision === "string")
  );
}

function safeErrorCode(reason: unknown): string {
  const safeText =
    typeof reason === "string" ? reason.slice(0, 1_000).toLowerCase() : "";
  if (/\b429\b|rate.?limit|too many requests/.test(safeText))
    return "RATE_LIMITED";
  if (/timeout|timed out|etimedout/.test(safeText)) return "TIMEOUT";
  if (/unauthori[sz]ed|\b401\b|\b403\b|forbidden/.test(safeText))
    return "AUTHENTICATION_FAILED";
  if (/\b5\d\d\b|service unavailable|econnreset|ehostunreach/.test(safeText))
    return "UPSTREAM_UNAVAILABLE";
  if (/invalid|malformed|does not match/.test(safeText))
    return "INVALID_PAYLOAD";
  return "PROCESSING_FAILED";
}

function dateFromMillis(value?: number): Date | null {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value)
    : null;
}
