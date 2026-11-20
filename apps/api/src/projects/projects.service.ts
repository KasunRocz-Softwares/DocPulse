import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import {
  ProjectRole,
  ProjectStatus,
  UserStatus,
} from "../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async listMembers(
    actor: { id: string; isSystemAdmin: boolean },
    projectId: string,
  ) {
    await this.requireProjectAdmin(actor, projectId);
    return this.prisma.projectMember.findMany({
      where: { projectId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            status: true,
          },
        },
      },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    });
  }

  async listRepositories(
    actor: { id: string; isSystemAdmin: boolean },
    projectId: string,
  ) {
    await this.requireProjectMember(actor, projectId);
    return this.prisma.projectRepository.findMany({
      where: { projectId },
      orderBy: [{ provider: "asc" }, { owner: "asc" }, { name: "asc" }],
    });
  }

  async addRepository(
    actor: { id: string; isSystemAdmin: boolean },
    projectId: string,
    input: {
      provider?: string;
      owner: string;
      name: string;
      externalId?: string;
    },
  ) {
    await this.requireProjectAdmin(actor, projectId);
    return this.prisma.$transaction(async (tx) => {
      const repository = await tx.projectRepository.create({
        data: {
          projectId,
          provider: input.provider?.trim().toLowerCase() || "github",
          owner: input.owner.trim(),
          name: input.name.trim(),
          externalId: input.externalId?.trim() || null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId,
          action: "project.repository_added",
          entityType: "project_repository",
          entityId: repository.id,
        },
      });
      return repository;
    });
  }

  async removeRepository(
    actor: { id: string; isSystemAdmin: boolean },
    projectId: string,
    repositoryId: string,
  ) {
    await this.requireProjectAdmin(actor, projectId);
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.projectRepository.deleteMany({
        where: { id: repositoryId, projectId },
      });
      if (result.count === 0)
        throw new NotFoundException("Repository not found");
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId,
          action: "project.repository_removed",
          entityType: "project_repository",
          entityId: repositoryId,
        },
      });
      return { removed: true };
    });
  }

  async listEnvironments(
    actor: { id: string; isSystemAdmin: boolean },
    projectId: string,
  ) {
    await this.requireProjectMember(actor, projectId);
    return this.prisma.projectEnvironment.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
    });
  }

  async updateEnvironment(
    actor: { id: string; isSystemAdmin: boolean },
    projectId: string,
    environmentId: string,
    input: { label?: string; enabled?: boolean },
  ) {
    await this.requireProjectAdmin(actor, projectId);
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.projectEnvironment.updateMany({
        where: { id: environmentId, projectId },
        data: input,
      });
      if (result.count === 0)
        throw new NotFoundException("Environment not found");
      const environment = await tx.projectEnvironment.findFirst({
        where: { id: environmentId, projectId },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId,
          action: "project.environment_updated",
          entityType: "project_environment",
          entityId: environmentId,
          metadata: input,
        },
      });
      return environment;
    });
  }

  async listAuditEvents(
    actor: { id: string; isSystemAdmin: boolean },
    projectId: string,
    page = 1,
    pageSize = 50,
  ) {
    await this.requireProjectAdmin(actor, projectId);
    const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
    const safePageSize = Number.isFinite(pageSize)
      ? Math.min(100, Math.max(1, Math.floor(pageSize)))
      : 50;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where: { projectId },
        include: {
          actor: { select: { id: true, email: true, displayName: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
      }),
      this.prisma.auditLog.count({ where: { projectId } }),
    ]);
    return { items, page: safePage, pageSize: safePageSize, total };
  }

  async exportAuditEvents(
    actor: { id: string; isSystemAdmin: boolean },
    projectId: string,
  ) {
    await this.requireProjectAdmin(actor, projectId);
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        projectId,
        action: "project.audit_exported",
        entityType: "project_audit",
        entityId: projectId,
        metadata: { format: "csv" },
      },
    });

    const prisma = this.prisma;
    return (async function* () {
      let cursorId: string | undefined;
      while (true) {
        const events = await prisma.auditLog.findMany({
          where: { projectId },
          include: {
            actor: { select: { id: true, email: true, displayName: true } },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
          take: 500,
        });
        if (events.length === 0) return;
        for (const event of events) yield event;
        if (events.length < 500) return;
        cursorId = events[events.length - 1]!.id;
      }
    })();
  }

  async addMember(
    actor: { id: string; isSystemAdmin: boolean },
    projectId: string,
    input: { email: string; displayName?: string; role: ProjectRole },
  ) {
    await this.requireProjectAdmin(actor, projectId);
    const email = input.email.trim().toLowerCase();
    const invitationToken = randomBytes(32).toString("base64url");
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { email },
        create: {
          email,
          displayName:
            input.displayName?.trim() || email.split("@")[0] || email,
          status: UserStatus.INVITED,
        },
        update: {},
        select: { id: true, email: true, displayName: true, status: true },
      });
      if (user.status === UserStatus.SUSPENDED)
        throw new ConflictException(
          "Suspended users cannot be added to a project",
        );
      const membership = await tx.projectMember.upsert({
        where: { projectId_userId: { projectId, userId: user.id } },
        create: { projectId, userId: user.id, role: input.role },
        update: {
          role: input.role,
          ...(input.role === ProjectRole.CLIENT
            ? {}
            : { clientAudienceId: null }),
        },
        include: {
          user: {
            select: { id: true, email: true, displayName: true, status: true },
          },
        },
      });
      let rawInvitation: string | undefined;
      if (user.status === UserStatus.INVITED) {
        const now = new Date();
        await tx.projectInvitation.updateMany({
          where: { projectId, email, acceptedAt: null, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.projectInvitation.create({
          data: {
            projectId,
            email,
            role: input.role,
            tokenHash: createHash("sha256")
              .update(invitationToken)
              .digest("hex"),
            expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
            invitedById: actor.id,
          },
        });
        rawInvitation = invitationToken;
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId,
          action: "project.member_upserted",
          entityType: "project_member",
          entityId: membership.id,
          metadata: { role: input.role, email },
        },
      });
      return {
        membership,
        ...(rawInvitation ? { invitationToken: rawInvitation } : {}),
      };
    });
  }

  async updateMemberRole(
    actor: { id: string; isSystemAdmin: boolean },
    projectId: string,
    membershipId: string,
    role: ProjectRole,
  ) {
    await this.requireProjectAdmin(actor, projectId);
    return this.prisma.$transaction(
      async (tx) => {
        const current = await tx.projectMember.findFirst({
          where: { id: membershipId, projectId },
          select: { id: true, role: true },
        });
        if (!current) throw new NotFoundException("Project member not found");
        await this.assertAdminRemains(tx, projectId, current.role, role);
        const updated = await tx.projectMember.update({
          where: { id: membershipId },
          data: {
            role,
            ...(role === ProjectRole.CLIENT ? {} : { clientAudienceId: null }),
          },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                displayName: true,
                status: true,
              },
            },
          },
        });
        await tx.projectInvitation.updateMany({
          where: {
            projectId,
            email: updated.user.email,
            acceptedAt: null,
            revokedAt: null,
          },
          data: { role },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            projectId,
            action: "project.member_role_changed",
            entityType: "project_member",
            entityId: membershipId,
            metadata: { previousRole: current.role, role },
          },
        });
        return updated;
      },
      { isolationLevel: "Serializable" },
    );
  }

  async removeMember(
    actor: { id: string; isSystemAdmin: boolean },
    projectId: string,
    membershipId: string,
  ) {
    await this.requireProjectAdmin(actor, projectId);
    return this.prisma.$transaction(
      async (tx) => {
        const current = await tx.projectMember.findFirst({
          where: { id: membershipId, projectId },
          select: {
            id: true,
            role: true,
            userId: true,
            user: { select: { email: true } },
          },
        });
        if (!current) throw new NotFoundException("Project member not found");
        await this.assertAdminRemains(tx, projectId, current.role, null);
        await tx.projectMember.delete({ where: { id: membershipId } });
        await tx.projectInvitation.updateMany({
          where: {
            projectId,
            email: current.user.email,
            acceptedAt: null,
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            projectId,
            action: "project.member_removed",
            entityType: "project_member",
            entityId: membershipId,
            metadata: { userId: current.userId, role: current.role },
          },
        });
        return { removed: true };
      },
      { isolationLevel: "Serializable" },
    );
  }

  private async assertAdminRemains(
    tx: any,
    projectId: string,
    currentRole: ProjectRole,
    nextRole: ProjectRole | null,
  ) {
    if (currentRole !== ProjectRole.ADMIN || nextRole === ProjectRole.ADMIN)
      return;
    const admins = await tx.projectMember.count({
      where: { projectId, role: ProjectRole.ADMIN },
    });
    if (admins <= 1)
      throw new ConflictException(
        "A project must retain at least one administrator",
      );
  }

  private async requireProjectAdmin(
    actor: { id: string; isSystemAdmin: boolean },
    projectId: string,
  ) {
    if (actor.isSystemAdmin) return;
    const membership = await this.prisma.projectMember.findFirst({
      where: { projectId, userId: actor.id },
      select: { role: true },
    });
    if (!membership) throw new NotFoundException("Project not found");
    if (membership.role !== ProjectRole.ADMIN)
      throw new ForbiddenException("Project administrator access is required");
  }

  private async requireProjectMember(
    actor: { id: string; isSystemAdmin: boolean },
    projectId: string,
  ) {
    if (actor.isSystemAdmin) return;
    const membership = await this.prisma.projectMember.findFirst({
      where: { projectId, userId: actor.id },
      select: { id: true },
    });
    if (!membership) throw new NotFoundException("Project not found");
  }
  listForUser(userId: string, isSystemAdmin: boolean) {
    return this.prisma.project.findMany({
      where: isSystemAdmin ? {} : { members: { some: { userId } } },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        status: true,
        createdAt: true,
        _count: { select: { releases: true, members: true } },
      },
      orderBy: { name: "asc" },
    });
  }
  async create(
    actor: { id: string; isSystemAdmin: boolean },
    input: { name: string; slug: string; description?: string },
  ) {
    if (!actor.isSystemAdmin)
      throw new ForbiddenException("System administrator access is required");
    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          name: input.name.trim(),
          slug: input.slug.toLowerCase(),
          description: input.description?.trim() || null,
          members: { create: { userId: actor.id, role: ProjectRole.ADMIN } },
          environments: {
            create: [
              { name: "DEVELOPMENT", label: "Development" },
              { name: "QA", label: "QA" },
              { name: "STAGING", label: "Staging" },
              { name: "BETA", label: "Beta" },
              { name: "ENTERPRISE", label: "Enterprise" },
              { name: "CANARY", label: "Canary" },
              { name: "PRODUCTION", label: "Production" },
            ],
          },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId: project.id,
          action: "project.created",
          entityType: "project",
          entityId: project.id,
        },
      });
      return project;
    });
  }
  async getForUser(projectId: string, userId: string, isSystemAdmin: boolean) {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        ...(isSystemAdmin ? {} : { members: { some: { userId } } }),
      },
      include: { environments: true, repositories: true },
    });
    if (!project) throw new NotFoundException("Project not found");
    return project;
  }

  async updateProject(
    actor: { id: string; isSystemAdmin: boolean },
    projectId: string,
    input: {
      name?: string;
      description?: string | null;
      status?: ProjectStatus;
    },
  ) {
    await this.requireProjectAdmin(actor, projectId);
    const data = {
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.description === undefined
        ? {}
        : { description: input.description?.trim() || null }),
      ...(input.status === undefined ? {} : { status: input.status }),
    };
    if (Object.keys(data).length === 0)
      throw new ConflictException("At least one project field is required");
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.project.updateMany({
        where: { id: projectId },
        data,
      });
      if (result.count === 0) throw new NotFoundException("Project not found");
      const updated = await tx.project.findUnique({ where: { id: projectId } });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId,
          action: "project.updated",
          entityType: "project",
          entityId: projectId,
          metadata: { fields: Object.keys(data) },
        },
      });
      return updated;
    });
  }

  async getBrand(
    actor: { id: string; isSystemAdmin: boolean },
    projectId: string,
  ) {
    await this.requireProjectMember(actor, projectId);
    const brand = await this.prisma.projectBrand.findUnique({
      where: { projectId },
    });
    return (
      brand ?? {
        projectId,
        primaryColor: "#2457c5",
        accentColor: null,
        logoUrl: null,
        customDomain: null,
        defaultLocale: "en",
        settings: {},
      }
    );
  }

  async updateBrand(
    actor: { id: string; isSystemAdmin: boolean },
    projectId: string,
    input: {
      primaryColor?: string;
      accentColor?: string | null;
      logoUrl?: string | null;
      defaultLocale?: string;
    },
  ) {
    await this.requireProjectAdmin(actor, projectId);
    const data = {
      ...(input.primaryColor === undefined
        ? {}
        : { primaryColor: validateColor(input.primaryColor, "primaryColor") }),
      ...(input.accentColor === undefined
        ? {}
        : {
            accentColor:
              input.accentColor === null
                ? null
                : validateColor(input.accentColor, "accentColor"),
          }),
      ...(input.logoUrl === undefined
        ? {}
        : {
            logoUrl:
              input.logoUrl === null ? null : validateHttpsUrl(input.logoUrl),
          }),
      ...(input.defaultLocale === undefined
        ? {}
        : { defaultLocale: validateLocale(input.defaultLocale) }),
    };
    if (Object.keys(data).length === 0)
      throw new ConflictException("At least one branding field is required");
    return this.prisma.$transaction(async (tx) => {
      const brand = await tx.projectBrand.upsert({
        where: { projectId },
        create: { projectId, ...data },
        update: data,
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId,
          action: "project.brand_updated",
          entityType: "project_brand",
          entityId: brand.id,
          metadata: { fields: Object.keys(data) },
        },
      });
      return brand;
    });
  }
}

export function auditCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const text = String(value);
  const safeText = /^[\u0000-\u0020\uFEFF]*[=+\-@]/.test(text)
    ? `'${text}`
    : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

function validateColor(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(normalized))
    throw new ConflictException(`${field} must be a six-digit hex color`);
  return normalized;
}

function validateHttpsUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConflictException("logoUrl must be an absolute HTTPS URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    throw new ConflictException("logoUrl must be an absolute HTTPS URL");
  return parsed.toString();
}

function validateLocale(value: string): string {
  try {
    const [locale] = Intl.getCanonicalLocales(value.trim());
    if (!locale || locale.length > 255) throw new Error("invalid");
    return locale;
  } catch {
    throw new ConflictException("defaultLocale must be a valid BCP 47 locale");
  }
}
