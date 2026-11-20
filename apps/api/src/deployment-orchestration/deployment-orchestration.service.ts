import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Inject,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import {
  DEPLOYMENT_TRIGGER_JOB,
  DEPLOYMENT_TRIGGER_JOB_DEFAULTS,
  DEPLOYMENT_TRIGGER_QUEUE_PROVIDER,
  type DeploymentTriggerQueue,
} from "./deployment-contracts";

export type DeploymentActor = { id: string; isSystemAdmin: boolean };
export type TriggerStatusInput = {
  status: "ACCEPTED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  resultCode?: string | null;
  resultSummary?: string | null;
};

const triggerRoles = ["ADMIN", "RELEASE_MANAGER", "DEVELOPER"];
const readRoles = [...triggerRoles, "REVIEWER"];
const terminalStatuses = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);
const transitions: Record<string, string[]> = {
  REQUESTED: ["ACCEPTED", "RUNNING", "FAILED", "CANCELLED"],
  ACCEPTED: ["RUNNING", "FAILED", "CANCELLED"],
  RUNNING: ["SUCCEEDED", "FAILED", "CANCELLED"],
};

@Injectable()
export class DeploymentOrchestrationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(DEPLOYMENT_TRIGGER_QUEUE_PROVIDER)
    private readonly queue: DeploymentTriggerQueue,
  ) {}

  async getPolicy(
    actor: DeploymentActor,
    projectId: string,
    environmentId: string,
  ) {
    await this.requireRole(actor, projectId, readRoles);
    const environment = await this.findEnvironment(projectId, environmentId);
    return this.policyView(environment);
  }

  async setPolicy(
    actor: DeploymentActor,
    projectId: string,
    environmentId: string,
    input: { enabled: boolean; requireApprovedRelease: boolean },
  ) {
    await this.requireRole(actor, projectId, ["ADMIN", "RELEASE_MANAGER"]);
    const environment = await this.findEnvironment(projectId, environmentId);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.projectEnvironment.update({
        where: { id: environment.id },
        data: {
          deploymentTriggerEnabled: input.enabled,
          deploymentRequiresApprovedRelease: input.requireApprovedRelease,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId,
          action: "deployment.policy.updated",
          entityType: "project_environment",
          entityId: environment.id,
          metadata: {
            deploymentTriggerEnabled: input.enabled,
            deploymentRequiresApprovedRelease: input.requireApprovedRelease,
          },
        },
      });
      return this.policyView(updated);
    });
  }

  async requestTrigger(
    actor: DeploymentActor,
    projectId: string,
    releaseId: string,
    environmentId: string,
    idempotencyKey: string,
    reason?: string,
  ) {
    await this.requireRole(actor, projectId, triggerRoles);
    this.validateIdempotencyKey(idempotencyKey);
    const safeReason = this.validateReason(reason);
    const [environment, release] = await Promise.all([
      this.findEnvironment(projectId, environmentId),
      this.prisma.release.findFirst({
        where: { id: releaseId, projectId },
        select: { id: true, status: true },
      }),
    ]);
    if (!release) throw new NotFoundException("Release not found");
    if (!environment.enabled || !environment.deploymentTriggerEnabled)
      throw new ForbiddenException(
        "Deployment triggers are disabled by environment policy",
      );
    if (
      environment.deploymentRequiresApprovedRelease &&
      !["APPROVED", "PUBLISHED"].includes(release.status)
    )
      throw new ForbiddenException(
        "Environment policy requires an approved release",
      );

    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          projectId,
          releaseId,
          environmentId,
          reason: safeReason,
        }),
      )
      .digest("hex");
    const existing = await this.prisma.deploymentTriggerRequest.findUnique({
      where: { projectId_idempotencyKey: { projectId, idempotencyKey } },
    });
    if (existing) {
      this.assertReplayIntent(existing, requestHash);
      await this.ensureQueued(existing);
      return this.requestView(existing);
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const request = await tx.deploymentTriggerRequest.create({
          data: {
            projectId,
            releaseId,
            environmentId,
            requestedById: actor.id,
            idempotencyKey,
            requestHash,
            reason: safeReason,
            status: "REQUESTED",
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            projectId,
            action: "deployment.trigger.requested",
            entityType: "deployment_trigger_request",
            entityId: request.id,
            metadata: {
              releaseId,
              environmentId,
              status: "REQUESTED",
              reason: safeReason,
            },
          },
        });
        return request;
      });
      await this.ensureQueued(created);
      return this.requestView(created);
    } catch (error) {
      if ((error as { code?: string })?.code !== "P2002") throw error;
      const raced = await this.prisma.deploymentTriggerRequest.findUnique({
        where: { projectId_idempotencyKey: { projectId, idempotencyKey } },
      });
      if (raced) {
        this.assertReplayIntent(raced, requestHash);
        await this.ensureQueued(raced);
        return this.requestView(raced);
      }
      throw error;
    }
  }

  async listRequests(
    actor: DeploymentActor,
    projectId: string,
    releaseId: string,
  ) {
    await this.requireRole(actor, projectId, readRoles);
    if (
      !(await this.prisma.release.findFirst({
        where: { id: releaseId, projectId },
        select: { id: true },
      }))
    )
      throw new NotFoundException("Release not found");
    const requests = await this.prisma.deploymentTriggerRequest.findMany({
      where: { projectId, releaseId },
      orderBy: { createdAt: "desc" },
    });
    return requests.map((request: any) => this.requestView(request));
  }

  async getRequest(
    actor: DeploymentActor,
    projectId: string,
    requestId: string,
  ) {
    await this.requireRole(actor, projectId, readRoles);
    const request = await this.prisma.deploymentTriggerRequest.findFirst({
      where: { id: requestId, projectId },
    });
    if (!request)
      throw new NotFoundException("Deployment trigger request not found");
    return this.requestView(request);
  }

  async updateStatus(
    actor: DeploymentActor,
    projectId: string,
    requestId: string,
    input: TriggerStatusInput,
  ) {
    await this.requireRole(actor, projectId, ["ADMIN", "RELEASE_MANAGER"]);
    this.validateResult(input);
    const request = await this.prisma.deploymentTriggerRequest.findFirst({
      where: { id: requestId, projectId },
    });
    if (!request)
      throw new NotFoundException("Deployment trigger request not found");
    if (!transitions[request.status]?.includes(input.status))
      throw new ConflictException(
        `Invalid deployment status transition: ${request.status} to ${input.status}`,
      );
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.deploymentTriggerRequest.updateMany({
        where: { id: request.id, projectId, status: request.status },
        data: {
          status: input.status,
          resultCode: input.resultCode ?? null,
          resultSummary: input.resultSummary ?? null,
          ...(input.status === "RUNNING" ? { startedAt: now } : {}),
          ...(terminalStatuses.has(input.status) ? { completedAt: now } : {}),
        },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          "Deployment request status changed; reload before retrying",
        );
      const updated = await tx.deploymentTriggerRequest.findFirst({
        where: { id: request.id, projectId },
      });
      if (!updated)
        throw new NotFoundException("Deployment trigger request not found");
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId,
          action: "deployment.trigger.status_updated",
          entityType: "deployment_trigger_request",
          entityId: request.id,
          metadata: {
            from: request.status,
            to: input.status,
            resultCode: input.resultCode ?? null,
            resultSummary: input.resultSummary ?? null,
          },
        },
      });
      return this.requestView(updated);
    });
  }

  async reportDispatchStatus(
    requestId: string,
    input: {
      status: "ACCEPTED" | "FAILED";
      resultCode: string;
      resultSummary: string;
    },
  ) {
    this.validateResult(input);
    const request = await this.prisma.deploymentTriggerRequest.findUnique({
      where: { id: requestId },
    });
    if (!request)
      throw new NotFoundException("Deployment trigger request not found");

    // The worker may finish after an administrator has manually advanced the
    // request. Never let a delayed callback roll that state back or replace it.
    if (request.status !== "REQUESTED") return this.requestView(request);

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.deploymentTriggerRequest.updateMany({
        where: { id: request.id, status: "REQUESTED" },
        data: {
          status: input.status,
          resultCode: input.resultCode,
          resultSummary: input.resultSummary,
          ...(input.status === "FAILED" ? { completedAt: now } : {}),
        },
      });
      if (changed.count !== 1) {
        const latest = await tx.deploymentTriggerRequest.findUnique({
          where: { id: request.id },
        });
        if (!latest)
          throw new NotFoundException("Deployment trigger request not found");
        return latest;
      }
      const latest = await tx.deploymentTriggerRequest.findUnique({
        where: { id: request.id },
      });
      if (!latest)
        throw new NotFoundException("Deployment trigger request not found");
      await tx.auditLog.create({
        data: {
          actorId: request.requestedById,
          projectId: request.projectId,
          action: "deployment.trigger.dispatch_reported",
          entityType: "deployment_trigger_request",
          entityId: request.id,
          metadata: {
            from: "REQUESTED",
            to: input.status,
            resultCode: input.resultCode,
            resultSummary: input.resultSummary,
            actor: "deployment-worker",
          },
        },
      });
      return latest;
    });
    return this.requestView(updated);
  }

  async reportRunnerStatus(requestId: string, input: TriggerStatusInput) {
    this.validateResult(input);
    const request = await this.prisma.deploymentTriggerRequest.findUnique({
      where: { id: requestId },
    });
    if (!request)
      throw new NotFoundException("Deployment trigger request not found");
    if (request.status === input.status) return this.requestView(request);
    if (!transitions[request.status]?.includes(input.status))
      throw new ConflictException(
        `Invalid deployment status transition: ${request.status} to ${input.status}`,
      );

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.deploymentTriggerRequest.updateMany({
        where: {
          id: request.id,
          projectId: request.projectId,
          status: request.status,
        },
        data: {
          status: input.status,
          resultCode: input.resultCode ?? null,
          resultSummary: input.resultSummary ?? null,
          ...(input.status === "RUNNING" ? { startedAt: now } : {}),
          ...(terminalStatuses.has(input.status) ? { completedAt: now } : {}),
        },
      });
      if (changed.count !== 1) {
        const latest = await tx.deploymentTriggerRequest.findUnique({
          where: { id: request.id },
        });
        if (latest?.status === input.status) return this.requestView(latest);
        throw new ConflictException(
          "Deployment request status changed; reload before retrying",
        );
      }
      const updated = await tx.deploymentTriggerRequest.findUnique({
        where: { id: request.id },
      });
      if (!updated)
        throw new NotFoundException("Deployment trigger request not found");
      await tx.auditLog.create({
        data: {
          actorId: request.requestedById,
          projectId: request.projectId,
          action: "deployment.trigger.runner_status_updated",
          entityType: "deployment_trigger_request",
          entityId: request.id,
          metadata: {
            actor: "deployment-runner",
            from: request.status,
            to: input.status,
            resultCode: input.resultCode ?? null,
            resultSummary: input.resultSummary ?? null,
          },
        },
      });
      return this.requestView(updated);
    });
  }

  private async findEnvironment(projectId: string, environmentId: string) {
    const environment = await this.prisma.projectEnvironment.findFirst({
      where: { id: environmentId, projectId },
    });
    if (!environment)
      throw new NotFoundException("Project environment not found");
    return environment;
  }

  private async requireRole(
    actor: DeploymentActor,
    projectId: string,
    roles: string[],
  ) {
    if (actor.isSystemAdmin) return;
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: actor.id } },
      select: { role: true },
    });
    if (!member) throw new NotFoundException("Project not found");
    if (!roles.includes(member.role))
      throw new ForbiddenException("Insufficient project role");
  }

  private validateIdempotencyKey(key: string) {
    if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{8,120}$/.test(key))
      throw new BadRequestException(
        "Idempotency-Key must be 8 to 120 safe characters",
      );
  }

  private validateReason(reason?: string) {
    if (reason === undefined) return null;
    const normalized = reason.trim();
    if (
      !normalized ||
      normalized.length > 500 ||
      /[\u0000-\u001f\u007f]/.test(normalized)
    )
      throw new BadRequestException(
        "reason must contain 1 to 500 printable characters",
      );
    return normalized;
  }

  private validateResult(input: TriggerStatusInput) {
    if (
      input.resultCode !== undefined &&
      input.resultCode !== null &&
      !/^[A-Z0-9_.-]{1,80}$/.test(input.resultCode)
    )
      throw new BadRequestException(
        "resultCode must use 1 to 80 uppercase code characters",
      );
    if (
      input.resultSummary !== undefined &&
      input.resultSummary !== null &&
      (input.resultSummary.length > 500 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(
          input.resultSummary,
        ) ||
        /(?:bearer\s+\S+|https?:\/\/|(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/i.test(
          input.resultSummary,
        ))
    )
      throw new BadRequestException(
        "resultSummary must be printable, credential-free, and at most 500 characters",
      );
  }

  private assertReplayIntent(request: any, requestHash: string) {
    if (request.requestHash !== requestHash)
      throw new ConflictException(
        "Idempotency-Key was already used for a different deployment request",
      );
  }

  private async ensureQueued(request: any) {
    if (request.dispatchEnqueuedAt || request.status !== "REQUESTED") return;
    await this.queue.add(
      DEPLOYMENT_TRIGGER_JOB,
      {
        requestId: request.id,
        projectId: request.projectId,
        releaseId: request.releaseId,
        environmentId: request.environmentId,
        idempotencyKey: request.idempotencyKey,
        reason: request.reason,
      },
      {
        jobId: request.id,
        ...DEPLOYMENT_TRIGGER_JOB_DEFAULTS,
      },
    );
    await this.prisma.deploymentTriggerRequest.updateMany({
      where: { id: request.id, dispatchEnqueuedAt: null },
      data: { dispatchEnqueuedAt: new Date() },
    });
    request.dispatchEnqueuedAt = new Date();
  }

  private policyView(environment: any) {
    return {
      environmentId: environment.id,
      enabled: environment.deploymentTriggerEnabled,
      requireApprovedRelease: environment.deploymentRequiresApprovedRelease,
    };
  }

  private requestView(request: any) {
    return {
      id: request.id,
      projectId: request.projectId,
      releaseId: request.releaseId,
      environmentId: request.environmentId,
      reason: request.reason,
      status: request.status,
      resultCode: request.resultCode,
      resultSummary: request.resultSummary,
      requestedAt: request.requestedAt,
      startedAt: request.startedAt,
      completedAt: request.completedAt,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }
}
