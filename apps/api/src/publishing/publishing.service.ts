import { createHash } from "node:crypto";
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  ApprovalStatus,
  ChangeCategory,
  ChangeVisibility,
  ProjectRole,
  ReleaseAudienceMode,
  ReleaseStatus,
} from "../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PublicResponseCache } from "../public/public-response-cache.service";

type Actor = { id: string; isSystemAdmin: boolean };
const approvers = [
  ProjectRole.ADMIN,
  ProjectRole.RELEASE_MANAGER,
  ProjectRole.REVIEWER,
];
const publishers = [ProjectRole.ADMIN, ProjectRole.RELEASE_MANAGER];

export function approvalContentHash(content: unknown): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stable(nested)]),
    );
  };
  return createHash("sha256")
    .update(JSON.stringify(stable(content)))
    .digest("hex");
}

@Injectable()
export class PublishingService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(NotificationsService)
    private readonly notifications?: NotificationsService,
    @Optional()
    @Inject(PublicResponseCache)
    private readonly publicResponseCache?: PublicResponseCache,
  ) {}

  async listReviewQueue(actor: Actor) {
    const projectFilter = actor.isSystemAdmin
      ? undefined
      : {
          projectId: {
            in: (
              await this.prisma.projectMember.findMany({
                where: { userId: actor.id, role: { in: approvers } },
                select: { projectId: true },
              })
            ).map((membership) => membership.projectId),
          },
        };
    return this.prisma.approvalRevision.findMany({
      where: {
        status: ApprovalStatus.PENDING,
        submittedById: { not: actor.id },
        ...(projectFilter ? { release: projectFilter } : {}),
      },
      include: {
        release: {
          select: {
            id: true,
            version: true,
            title: true,
            projectId: true,
            project: { select: { name: true, slug: true } },
          },
        },
        decisions: {
          select: {
            id: true,
            reviewerId: true,
            status: true,
            comment: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: [{ createdAt: "asc" }, { revision: "asc" }],
    });
  }

  /**
   * Approved revisions that have not been published yet, newest per release,
   * in projects where the actor may publish (Admin or Release Manager).
   */
  async listReadyToPublish(actor: Actor) {
    const projectFilter = actor.isSystemAdmin
      ? undefined
      : {
          projectId: {
            in: (
              await this.prisma.projectMember.findMany({
                where: { userId: actor.id, role: { in: publishers } },
                select: { projectId: true },
              })
            ).map((membership) => membership.projectId),
          },
        };
    const revisions = await this.prisma.approvalRevision.findMany({
      where: {
        status: ApprovalStatus.APPROVED,
        publication: { is: null },
        release: {
          status: { not: ReleaseStatus.ARCHIVED },
          ...(projectFilter ?? {}),
        },
      },
      include: {
        release: {
          select: {
            id: true,
            version: true,
            title: true,
            projectId: true,
            project: { select: { name: true, slug: true } },
          },
        },
        decisions: {
          where: { status: ApprovalStatus.APPROVED },
          select: {
            id: true,
            reviewerId: true,
            status: true,
            comment: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: [{ releaseId: "asc" }, { revision: "desc" }],
    });
    const newestPerRelease = new Map<string, (typeof revisions)[number]>();
    for (const revision of revisions)
      if (!newestPerRelease.has(revision.releaseId))
        newestPerRelease.set(revision.releaseId, revision);
    return [...newestPerRelease.values()].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }

  async submit(actor: Actor, releaseId: string) {
    const release = await this.prisma.release.findUnique({
      where: { id: releaseId },
      include: {
        changes: { orderBy: { sortOrder: "asc" } },
        translations: {
          include: {
            changes: { select: { changeId: true, description: true } },
          },
          orderBy: { locale: "asc" },
        },
        attachments: {
          where: { publicAllowed: true, scanStatus: "CLEAN" },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            fileName: true,
            contentType: true,
            sizeBytes: true,
            checksumSha256: true,
          },
        },
        project: {
          select: {
            branding: {
              select: {
                primaryColor: true,
                accentColor: true,
                logoUrl: true,
                defaultLocale: true,
              },
            },
          },
        },
        clientAudiences: {
          select: { audienceId: true },
          orderBy: { audienceId: "asc" },
        },
      },
    });
    if (!release) throw new NotFoundException("Release not found");
    await this.requireRole(actor, release.projectId, [
      ProjectRole.ADMIN,
      ProjectRole.RELEASE_MANAGER,
      ProjectRole.DEVELOPER,
    ]);
    if (release.status !== ReleaseStatus.REVIEW || release.changes.length === 0)
      throw new UnprocessableEntityException(
        "Submit the release for internal review before requesting public approval",
      );
    const candidates = release.changes.filter(
      (change) =>
        change.visibility === ChangeVisibility.PUBLIC_CANDIDATE &&
        change.publicDescription?.trim(),
    );
    if (candidates.length === 0)
      throw new UnprocessableEntityException(
        "At least one public change with a customer-facing description is required",
      );
    const audienceIds = (release.clientAudiences ?? []).map(
      ({ audienceId }) => audienceId,
    );
    if (
      release.audienceMode === ReleaseAudienceMode.CLIENTS &&
      audienceIds.length === 0
    )
      throw new UnprocessableEntityException(
        "Select at least one client audience before submitting this release",
      );
    const content = {
      projectId: release.projectId,
      audience: { mode: release.audienceMode, audienceIds },
      version: release.version,
      title: release.title,
      summary: release.publicSummary,
      releaseDate: release.releaseDate?.toISOString() ?? null,
      brand: {
        primaryColor: release.project.branding?.primaryColor ?? "#2457c5",
        accentColor: release.project.branding?.accentColor ?? null,
        logoUrl: release.project.branding?.logoUrl ?? null,
        defaultLocale: release.project.branding?.defaultLocale ?? "en",
      },
      changes: candidates.map(
        ({
          id: sourceChangeId,
          title,
          category,
          publicDescription,
          sortOrder,
        }) => ({
          sourceChangeId,
          title,
          category,
          description: publicDescription,
          sortOrder,
        }),
      ),
      locales: (release.translations ?? []).map((translation) => ({
        locale: translation.locale,
        title: translation.title,
        summary: translation.summary,
        changes: translation.changes
          .filter(({ changeId }) =>
            candidates.some((change) => change.id === changeId),
          )
          .map(({ changeId, description }) => ({
            sourceChangeId: changeId,
            description,
          })),
      })),
      attachments: (release.attachments ?? []).map((attachment) => ({
        sourceAttachmentId: attachment.id,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes.toString(),
        checksumSha256: attachment.checksumSha256,
      })),
    };
    const contentHash = approvalContentHash(content);
    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.approvalRevision.findFirst({
        where: { releaseId },
        orderBy: { revision: "desc" },
        select: { revision: true },
      });
      const revision = await tx.approvalRevision.create({
        data: {
          releaseId,
          revision: (latest?.revision ?? 0) + 1,
          contentHash,
          content,
          submittedById: actor.id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId: release.projectId,
          action: "publication.submitted",
          entityType: "approval_revision",
          entityId: revision.id,
        },
      });
      return revision;
    });
  }

  async decide(
    actor: Actor,
    releaseId: string,
    revisionId: string,
    approved: boolean,
    comment?: string,
  ) {
    const revision = await this.prisma.approvalRevision.findFirst({
      where: { id: revisionId, releaseId },
      include: {
        release: { select: { projectId: true } },
        decisions: { where: { status: ApprovalStatus.APPROVED } },
      },
    });
    if (!revision) throw new NotFoundException("Approval revision not found");
    await this.requireRole(actor, revision.release.projectId, approvers);
    if (revision.submittedById === actor.id)
      throw new ForbiddenException(
        "The author cannot approve their own public revision",
      );
    if (revision.status !== ApprovalStatus.PENDING)
      throw new UnprocessableEntityException(
        "This approval revision is no longer pending",
      );
    if (approved && revision.decisions.length > 0)
      throw new UnprocessableEntityException(
        "This revision already has an approval",
      );
    return this.prisma.$transaction(async (tx) => {
      const status = approved
        ? ApprovalStatus.APPROVED
        : ApprovalStatus.REJECTED;
      const transition = await tx.approvalRevision.updateMany({
        where: { id: revisionId, releaseId, status: ApprovalStatus.PENDING },
        data: { status },
      });
      if (transition.count !== 1)
        throw new UnprocessableEntityException(
          "This approval revision was decided by another reviewer",
        );
      const decision = await tx.approvalDecision.create({
        data: {
          revisionId,
          reviewerId: actor.id,
          status,
          comment: comment?.trim() || null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId: revision.release.projectId,
          action: approved ? "publication.approved" : "publication.rejected",
          entityType: "approval_revision",
          entityId: revisionId,
        },
      });
      return decision;
    });
  }

  async publish(actor: Actor, releaseId: string, revisionId: string) {
    const revision = await this.prisma.approvalRevision.findFirst({
      where: { id: revisionId, releaseId },
      include: {
        release: { include: { project: true } },
        decisions: { where: { status: ApprovalStatus.APPROVED } },
      },
    });
    if (!revision) throw new NotFoundException("Approval revision not found");
    await this.requireRole(actor, revision.release.projectId, publishers);
    if (
      revision.status !== ApprovalStatus.APPROVED ||
      revision.decisions.length === 0
    )
      throw new UnprocessableEntityException(
        "Only an approved revision can be published",
      );
    const content = revision.content as {
      version: string;
      title: string;
      summary: string | null;
      brand?: {
        primaryColor?: string;
        accentColor?: string | null;
        logoUrl?: string | null;
        defaultLocale?: string;
      };
      changes: Array<{
        sourceChangeId?: string;
        title: string;
        category: string;
        description: string;
        sortOrder: number;
      }>;
      locales?: Array<{
        locale: string;
        title: string;
        summary: string | null;
        changes: Array<{ sourceChangeId: string; description: string }>;
      }>;
      attachments?: Array<{
        sourceAttachmentId: string;
        fileName: string;
        contentType: string;
        sizeBytes: string;
        checksumSha256: string;
      }>;
      audience?: { mode: ReleaseAudienceMode; audienceIds: string[] };
    };
    if (
      Array.isArray(content.locales) &&
      approvalContentHash(content) !== revision.contentHash
    )
      throw new UnprocessableEntityException(
        "Approved localized content hash does not match the revision",
      );
    const audience = content.audience ?? {
      mode: ReleaseAudienceMode.PUBLIC,
      audienceIds: [],
    };
    if (
      audience.mode === ReleaseAudienceMode.CLIENTS &&
      audience.audienceIds.length === 0
    )
      throw new UnprocessableEntityException(
        "The approved revision does not contain a client audience",
      );
    const published = await this.prisma.$transaction(async (tx) => {
      const frozenAttachments = content.attachments ?? [];
      const currentAttachments = frozenAttachments.length
        ? await tx.releaseAttachment.findMany({
            where: {
              releaseId,
              id: {
                in: frozenAttachments.map(
                  (attachment) => attachment.sourceAttachmentId,
                ),
              },
              scanStatus: "CLEAN",
              publicAllowed: true,
            },
            select: {
              id: true,
              storageKey: true,
              fileName: true,
              contentType: true,
              sizeBytes: true,
              checksumSha256: true,
            },
          })
        : [];
      if (currentAttachments.length !== frozenAttachments.length) {
        throw new UnprocessableEntityException(
          "A reviewed public attachment changed; submit a new revision",
        );
      }
      const currentById = new Map(
        currentAttachments.map((attachment) => [attachment.id, attachment]),
      );
      const snapshotAttachments = frozenAttachments.map((frozen) => {
        const current = currentById.get(frozen.sourceAttachmentId);
        if (
          !current ||
          current.fileName !== frozen.fileName ||
          current.contentType !== frozen.contentType ||
          current.sizeBytes.toString() !== frozen.sizeBytes ||
          current.checksumSha256 !== frozen.checksumSha256
        ) {
          throw new UnprocessableEntityException(
            "A reviewed public attachment changed; submit a new revision",
          );
        }
        return {
          sourceAttachmentId: current.id,
          storageKey: current.storageKey,
          fileName: current.fileName,
          contentType: current.contentType,
          sizeBytes: current.sizeBytes,
          checksumSha256: current.checksumSha256,
        };
      });
      const sequence =
        (await tx.releasePublication.count({ where: { releaseId } })) + 1;
      const publication = await tx.releasePublication.create({
        data: {
          releaseId,
          revisionId,
          sequence,
          snapshot: {
            create: {
              projectSlug: revision.release.project.slug,
              projectName: revision.release.project.name,
              version: content.version,
              title: content.title,
              summary: content.summary,
              primaryColor: content.brand?.primaryColor ?? "#2457c5",
              accentColor: content.brand?.accentColor ?? null,
              logoUrl: content.brand?.logoUrl ?? null,
              locale: content.brand?.defaultLocale ?? "en",
              defaultLocale: content.brand?.defaultLocale ?? "en",
              contentHash: revision.contentHash,
              publishedAt: new Date(),
              ...(audience.mode === ReleaseAudienceMode.CLIENTS
                ? {
                    audienceMode: ReleaseAudienceMode.CLIENTS,
                    clientAudiences: {
                      createMany: {
                        data: audience.audienceIds.map((audienceId) => ({
                          audienceId,
                        })),
                      },
                    },
                  }
                : {}),
              changes: {
                create: content.changes.map((change) => ({
                  ...change,
                  category: change.category as ChangeCategory,
                })),
              },
              attachments: { create: snapshotAttachments },
            },
          },
        },
        include: { snapshot: { include: { changes: true } } },
      });
      if (publication.snapshot && content.locales?.length) {
        const snapshotChangeIds = new Map(
          publication.snapshot.changes
            .filter((change) => change.sourceChangeId)
            .map((change) => [change.sourceChangeId!, change.id]),
        );
        for (const locale of content.locales) {
          await tx.publicSnapshotLocale.create({
            data: {
              snapshotId: publication.snapshot.id,
              locale: locale.locale,
              title: locale.title,
              summary: locale.summary,
              changes: {
                create: locale.changes.flatMap((change) => {
                  const snapshotChangeId = snapshotChangeIds.get(
                    change.sourceChangeId,
                  );
                  return snapshotChangeId
                    ? [{ snapshotChangeId, description: change.description }]
                    : [];
                }),
              },
            },
          });
        }
      }
      await tx.release.update({
        where: { id: releaseId },
        data: { status: ReleaseStatus.PUBLISHED },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId: revision.release.projectId,
          action: "publication.published",
          entityType: "publication",
          entityId: publication.id,
        },
      });
      return publication;
    });
    if (audience.mode === ReleaseAudienceMode.PUBLIC)
      await this.publicResponseCache?.invalidateProject(
        revision.release.project.slug,
      );
    if (
      published.snapshot?.id &&
      audience.mode === ReleaseAudienceMode.PUBLIC
    ) {
      await this.notifications?.queuePublication(
        revision.release.projectId,
        published.snapshot.id,
      );
    }
    return published;
  }

  async unpublish(actor: Actor, releaseId: string, publicationId: string) {
    const publication = await this.prisma.releasePublication.findFirst({
      where: { id: publicationId, releaseId },
      include: {
        release: {
          select: { projectId: true, project: { select: { slug: true } } },
        },
      },
    });
    if (!publication) throw new NotFoundException("Publication not found");
    await this.requireRole(actor, publication.release.projectId, publishers);
    if (publication.revokedAt)
      throw new UnprocessableEntityException(
        "Publication is already unpublished",
      );
    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.releasePublication.update({
        where: { id: publicationId },
        data: { revokedAt: new Date() },
      });
      await tx.release.update({
        where: { id: releaseId },
        data: { status: ReleaseStatus.UNPUBLISHED },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId: publication.release.projectId,
          action: "publication.unpublished",
          entityType: "publication",
          entityId: publicationId,
        },
      });
      return updated;
    });
    await this.publicResponseCache?.invalidateProject(
      publication.release.project.slug,
    );
    return updated;
  }

  private async requireRole(
    actor: Actor,
    projectId: string,
    allowed: ProjectRole[],
  ) {
    if (actor.isSystemAdmin) return;
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: actor.id } },
      select: { role: true },
    });
    if (!member) throw new NotFoundException("Project not found");
    if (!allowed.includes(member.role))
      throw new ForbiddenException(
        "Your project role does not allow this action",
      );
  }
}
