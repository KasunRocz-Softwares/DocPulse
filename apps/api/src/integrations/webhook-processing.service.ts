import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { WebhookJob } from "./webhook-contracts";

@Injectable()
export class WebhookProcessingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async process(
    eventId: string,
    job: WebhookJob,
  ): Promise<{ processed: boolean; outcome: string }> {
    return this.prisma.$transaction(
      async (tx) => {
        const event = await tx.webhookEvent.findUnique({
          where: { id: eventId },
          select: { id: true, status: true },
        });
        if (!event) throw new Error("Webhook event does not exist");
        if (event.status === "PROCESSED" || event.status === "UNMATCHED")
          return { processed: true, outcome: event.status.toLowerCase() };
        const claim = await tx.webhookEvent.updateMany({
          where: { id: eventId, status: "RECEIVED" },
          data: { status: "PROCESSING" },
        });
        if (claim.count !== 1) {
          const current = await tx.webhookEvent.findUnique({
            where: { id: eventId },
            select: { status: true },
          });
          if (
            current?.status === "PROCESSED" ||
            current?.status === "UNMATCHED"
          )
            return { processed: true, outcome: current.status.toLowerCase() };
          throw new Error("Webhook event is already being processed");
        }

        let outcome: string;
        let projectId: string | undefined;
        if (job.kind === "deployment") {
          const [release, environment] = await Promise.all([
            tx.release.findUnique({
              where: { id: job.releaseId },
              select: { projectId: true },
            }),
            tx.projectEnvironment.findUnique({
              where: { id: job.environmentId },
              select: { projectId: true, enabled: true },
            }),
          ]);
          if (
            !release ||
            !environment ||
            release.projectId !== job.projectId ||
            environment.projectId !== job.projectId ||
            !environment.enabled
          ) {
            throw new Error(
              "Deployment target does not belong to the specified active project",
            );
          }
          projectId = job.projectId;
          const externalId = `${job.provider}:${job.deploymentId}`;
          const existing = await tx.releaseDeployment.findFirst({
            where: {
              releaseId: job.releaseId,
              environmentId: job.environmentId,
              externalId,
            },
            select: { id: true },
          });
          const data = {
            status: job.status,
            deployedAt: new Date(job.occurredAt),
            metadata: {
              provider: job.provider,
              deploymentId: job.deploymentId,
            },
          };
          if (existing)
            await tx.releaseDeployment.update({
              where: { id: existing.id },
              data,
            });
          else
            await tx.releaseDeployment.create({
              data: {
                ...data,
                releaseId: job.releaseId,
                environmentId: job.environmentId,
                externalId,
              },
            });
          outcome = "deployment_recorded";
        } else {
          const [owner, name] = job.repository.split("/");
          if (!owner || !name)
            throw new Error("Webhook repository identifier is invalid");
          const repository = await tx.projectRepository.findFirst({
            where: { provider: "github", owner, name },
            select: { projectId: true },
          });
          projectId = repository?.projectId;
          if (repository && job.reference.kind === "tag") {
            const version = job.reference.externalId.replace(/^v(?=\d)/i, "");
            const release = await tx.release.findFirst({
              where: { projectId: repository.projectId, version },
              select: { id: true },
            });
            if (release) {
              const reference = {
                repository: job.repository,
                kind: "tag",
                externalId: job.reference.externalId,
                url: `https://github.com/${job.repository}/tree/${encodeURIComponent(job.reference.externalId)}`,
                title: null,
                releaseId: release.id,
              };
              await tx.gitReference.upsert({
                where: {
                  repository_kind_externalId_releaseId: {
                    repository: reference.repository,
                    kind: reference.kind,
                    externalId: reference.externalId,
                    releaseId: reference.releaseId,
                  },
                },
                create: reference,
                update: { url: reference.url },
              });
              outcome = "tag_linked";
            } else outcome = "unmatched_release_tag";
          } else
            outcome = repository
              ? "reference_requires_release_mapping"
              : "repository_not_connected";

          if (outcome !== "tag_linked") {
            await tx.integrationSuggestion.upsert({
              where: { webhookEventId: eventId },
              create: {
                projectId: projectId ?? null,
                webhookEventId: eventId,
                repository: job.repository,
                referenceKind: job.reference.kind,
                externalId: job.reference.externalId,
                revision: job.reference.revision ?? null,
                action: job.action,
                status: projectId ? "PENDING" : "UNASSIGNED",
              },
              update: {},
            });
          }
        }

        const status =
          outcome === "tag_linked" || outcome === "deployment_recorded"
            ? "PROCESSED"
            : "UNMATCHED";
        await tx.webhookEvent.update({
          where: { id: eventId },
          data: { status, processedAt: new Date() },
        });
        await tx.auditLog.create({
          data: {
            ...(projectId ? { projectId } : {}),
            action: `integration.webhook.${outcome}`,
            entityType: "WebhookEvent",
            entityId: eventId,
            metadata: {
              kind: job.kind,
              ...(job.kind === "github"
                ? {
                    eventType: job.eventType,
                    repository: job.repository,
                    referenceKind: job.reference.kind,
                  }
                : { provider: job.provider, deploymentId: job.deploymentId }),
            },
          },
        });
        return { processed: true, outcome };
      },
      { isolationLevel: "Serializable" },
    );
  }

  /**
   * Read contract for the project-authorized admin integration surface.
   * Controller authorization and review actions remain owned by the project API.
   */
  listPendingSuggestions(projectId: string, limit = 100) {
    const boundedLimit = Number.isSafeInteger(limit)
      ? Math.min(Math.max(limit, 1), 250)
      : 100;
    return this.prisma.integrationSuggestion.findMany({
      where: { projectId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: boundedLimit,
    });
  }
}
