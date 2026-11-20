import { createHash } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { ProjectRole } from "../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";
import type { AttachmentStorage } from "../release-content/release-content.adapters";
import { ATTACHMENT_STORAGE } from "../release-content/release-content.service";

type Actor = { id: string; isSystemAdmin: boolean };

const clientSnapshotSelect = {
  id: true,
  projectSlug: true,
  projectName: true,
  version: true,
  title: true,
  summary: true,
  primaryColor: true,
  accentColor: true,
  logoUrl: true,
  locale: true,
  defaultLocale: true,
  publishedAt: true,
  changes: {
    select: {
      title: true,
      category: true,
      description: true,
      sortOrder: true,
    },
    orderBy: { sortOrder: "asc" as const },
  },
  attachments: {
    select: {
      id: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      checksumSha256: true,
    },
    orderBy: { fileName: "asc" as const },
  },
} as const;

@Injectable()
export class ClientVisibilityService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
  ) {}

  async listAudiences(actor: Actor, projectId: string) {
    await this.requireManager(actor, projectId);
    return this.prisma.clientAudience.findMany({
      where: { projectId },
      select: {
        id: true,
        projectId: true,
        name: true,
        slug: true,
        createdAt: true,
      },
      orderBy: { name: "asc" },
    });
  }

  async createAudience(
    actor: Actor,
    projectId: string,
    input: { name: string; slug: string },
  ) {
    await this.requireManager(actor, projectId);
    const name = input.name.trim();
    const slug = input.slug.trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
      throw new ConflictException(
        "Audience slug must use lowercase letters, numbers, and hyphens",
      );
    try {
      return await this.prisma.$transaction(async (tx) => {
        const audience = await tx.clientAudience.create({
          data: { projectId, name, slug },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            projectId,
            action: "client_audience.created",
            entityType: "client_audience",
            entityId: audience.id,
          },
        });
        return audience;
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002"
      )
        throw new ConflictException(
          "An audience with that slug already exists in this project",
        );
      throw error;
    }
  }

  async assignMember(
    actor: Actor,
    projectId: string,
    membershipId: string,
    clientAudienceId: string | null,
  ) {
    await this.requireAdmin(actor, projectId);
    const membership = await this.prisma.projectMember.findFirst({
      where: { id: membershipId, projectId },
      select: { id: true, role: true, clientAudienceId: true },
    });
    if (!membership) throw new NotFoundException("Project member not found");
    if (membership.role !== ProjectRole.CLIENT)
      throw new ConflictException(
        "Only CLIENT members can be assigned to a client audience",
      );
    if (clientAudienceId) {
      const audience = await this.prisma.clientAudience.findFirst({
        where: { id: clientAudienceId, projectId },
        select: { id: true },
      });
      if (!audience) throw new NotFoundException("Client audience not found");
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.projectMember.update({
        where: { id: membershipId },
        data: { clientAudienceId },
        select: {
          id: true,
          projectId: true,
          userId: true,
          role: true,
          clientAudienceId: true,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId,
          action: "client_audience.member_assigned",
          entityType: "project_member",
          entityId: membershipId,
          metadata: {
            previousAudienceId: membership.clientAudienceId,
            clientAudienceId,
          },
        },
      });
      return updated;
    });
  }

  async clientReleases(
    actor: Actor,
    projectSlug: string,
    page = 1,
    pageSize = 20,
  ) {
    const membership = await this.getClientMembership(actor, projectSlug);
    const safePage =
      Number.isFinite(page) && page >= 1
        ? Math.min(1_000_000, Math.floor(page))
        : 1;
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize) || 20));
    const canonical = Prisma.sql`
      WITH canonical AS (
        SELECT DISTINCT ON (s."version") s."id", s."version", s."publishedAt"
        FROM "PublicReleaseSnapshot" s
        JOIN "ReleasePublication" p ON p."id" = s."publicationId"
        JOIN "PublicSnapshotClientAudience" ca ON ca."snapshotId" = s."id"
        WHERE s."projectSlug" = ${projectSlug}
          AND s."audienceMode" = 'CLIENTS'
          AND p."revokedAt" IS NULL
          AND ca."audienceId" = ${membership.clientAudience!.id}
        ORDER BY s."version", s."publishedAt" DESC, s."id" DESC
      )`;
    const totals = await this.prisma.$queryRaw<Array<{ total: number }>>(
      Prisma.sql`${canonical} SELECT COUNT(*)::int AS total FROM canonical`,
    );
    const total = totals[0]?.total ?? 0;
    const totalPages = Math.ceil(total / safePageSize);
    const actualPage = totalPages ? Math.min(safePage, totalPages) : 1;
    const rows = total
      ? await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          ${canonical}
          SELECT "id" FROM canonical
          ORDER BY "publishedAt" DESC, "version" DESC
          LIMIT ${safePageSize} OFFSET ${(actualPage - 1) * safePageSize}
        `)
      : [];
    const ids = rows.map(({ id }) => id);
    const snapshots = await this.prisma.publicReleaseSnapshot.findMany({
      where: {
        id: { in: ids },
        audienceMode: "CLIENTS",
        projectSlug,
        publication: { revokedAt: null },
        clientAudiences: {
          some: { audienceId: membership.clientAudience!.id },
        },
      },
      select: clientSnapshotSelect,
    });
    const byId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
    return {
      audience: membership.clientAudience,
      pagination: {
        page: actualPage,
        pageSize: safePageSize,
        total,
        totalPages,
      },
      releases: ids
        .map((id) => byId.get(id))
        .filter((snapshot) => snapshot !== undefined)
        .map((snapshot) => {
          const { id: snapshotId, ...release } = snapshot;
          void snapshotId;
          return {
            ...release,
            attachments: snapshot.attachments.map((attachment) => ({
              id: attachment.id,
              fileName: attachment.fileName,
              contentType: attachment.contentType,
              sizeBytes: attachment.sizeBytes.toString(),
              checksumSha256: attachment.checksumSha256,
              downloadUrl: `/client/projects/${encodeURIComponent(snapshot.projectSlug)}/releases/${encodeURIComponent(snapshot.version)}/attachments/${encodeURIComponent(attachment.id)}/download`,
            })),
          };
        }),
    };
  }

  async downloadClientAttachment(
    actor: Actor,
    projectSlug: string,
    version: string,
    attachmentId: string,
  ) {
    const membership = await this.getClientMembership(actor, projectSlug);
    const attachment = await this.prisma.publicSnapshotAttachment.findFirst({
      where: {
        id: attachmentId,
        snapshot: {
          projectSlug,
          version,
          audienceMode: "CLIENTS",
          publication: { revokedAt: null },
          clientAudiences: {
            some: { audienceId: membership.clientAudience!.id },
          },
        },
      },
      select: {
        storageKey: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        checksumSha256: true,
      },
    });
    if (!attachment) throw new NotFoundException("Client attachment not found");
    const bytes = await this.storage.get(attachment.storageKey);
    if (
      BigInt(bytes.length) !== attachment.sizeBytes ||
      createHash("sha256").update(bytes).digest("hex") !==
        attachment.checksumSha256
    )
      throw new ForbiddenException(
        "Attachment failed its published integrity check",
      );
    return {
      bytes,
      metadata: {
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes.toString(),
      },
    };
  }

  private async getClientMembership(actor: Actor, projectSlug: string) {
    const membership = await this.prisma.projectMember.findFirst({
      where: {
        role: ProjectRole.CLIENT,
        userId: actor.id,
        clientAudience: { isNot: null },
        project: { slug: projectSlug, status: "ACTIVE" },
        user: { status: "ACTIVE" },
      },
      select: {
        clientAudience: { select: { id: true, name: true } },
        projectId: true,
      },
    });
    if (!membership?.clientAudience)
      throw new NotFoundException("Client release portal not found");
    return membership;
  }

  private async requireManager(actor: Actor, projectId: string) {
    await this.requireRole(actor, projectId, [
      ProjectRole.ADMIN,
      ProjectRole.RELEASE_MANAGER,
    ]);
  }

  private async requireAdmin(actor: Actor, projectId: string) {
    await this.requireRole(actor, projectId, [ProjectRole.ADMIN]);
  }

  private async requireRole(
    actor: Actor,
    projectId: string,
    allowed: ProjectRole[],
  ) {
    if (actor.isSystemAdmin) return;
    const membership = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: actor.id } },
      select: { role: true },
    });
    if (!membership) throw new NotFoundException("Project not found");
    if (!allowed.includes(membership.role))
      throw new ForbiddenException(
        "Your project role does not allow this action",
      );
  }
}
