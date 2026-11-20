import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { PublicResponseCache } from "../public/public-response-cache.service";
import {
  defaultPublicPageConfig,
  normalizePublicPageConfig,
  parsePublicPageConfig,
  type PublicPageConfig,
} from "./public-page-config";

type Actor = { id: string; isSystemAdmin: boolean };

/** Stored under ProjectBrand.settings.publicPage. */
type StoredPublicPage = {
  draft?: unknown;
  published?: unknown;
  draftUpdatedAt?: string;
  publishedAt?: string;
};

type BrandSettings = Record<string, unknown> & {
  publicPage?: StoredPublicPage;
};

function readSettings(value: unknown): BrandSettings {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as BrandSettings) }
    : {};
}

function readStored(settings: BrandSettings): StoredPublicPage {
  const value = settings.publicPage;
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...value }
    : {};
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export type PublicPageState = {
  draft: PublicPageConfig;
  published: PublicPageConfig | null;
  draftUpdatedAt: string | null;
  publishedAt: string | null;
  hasUnpublishedChanges: boolean;
};

@Injectable()
export class PublicPageService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(PublicResponseCache)
    private readonly publicResponseCache?: PublicResponseCache,
  ) {}

  async get(actor: Actor, projectId: string): Promise<PublicPageState> {
    await this.requireRole(actor, projectId, false);
    const brand = await this.prisma.projectBrand.findUnique({
      where: { projectId },
      select: { settings: true },
    });
    return this.toState(readStored(readSettings(brand?.settings)));
  }

  async saveDraft(
    actor: Actor,
    projectId: string,
    input: unknown,
  ): Promise<PublicPageState> {
    await this.requireRole(actor, projectId, true);
    const { config, issues } = parsePublicPageConfig(input);
    if (issues.length)
      throw new UnprocessableEntityException({
        message: "The page configuration is not valid",
        issues,
      });
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.projectBrand.findUnique({
        where: { projectId },
        select: { settings: true },
      });
      const settings = readSettings(existing?.settings);
      const stored: StoredPublicPage = {
        ...readStored(settings),
        draft: config,
        draftUpdatedAt: new Date().toISOString(),
      };
      const nextSettings = toJson({ ...settings, publicPage: stored });
      const brand = await tx.projectBrand.upsert({
        where: { projectId },
        create: { projectId, settings: nextSettings },
        update: { settings: nextSettings },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId,
          action: "project.public_page_draft_saved",
          entityType: "project_brand",
          entityId: brand.id,
          metadata: { widgets: config.widgets.length },
        },
      });
      return this.toState(stored);
    });
  }

  async publish(actor: Actor, projectId: string): Promise<PublicPageState> {
    await this.requireRole(actor, projectId, true);
    const state = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.projectBrand.findUnique({
        where: { projectId },
        select: { id: true, settings: true },
      });
      const settings = readSettings(existing?.settings);
      const stored = readStored(settings);
      const { config, issues } = parsePublicPageConfig(
        stored.draft ?? stored.published ?? defaultPublicPageConfig(),
      );
      if (issues.length)
        throw new UnprocessableEntityException({
          message: "Fix the draft before publishing it",
          issues,
        });
      const now = new Date().toISOString();
      const next: StoredPublicPage = {
        ...stored,
        draft: config,
        published: config,
        publishedAt: now,
        draftUpdatedAt: stored.draftUpdatedAt ?? now,
      };
      const nextSettings = toJson({ ...settings, publicPage: next });
      const brand = await tx.projectBrand.upsert({
        where: { projectId },
        create: { projectId, settings: nextSettings },
        update: { settings: nextSettings },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId,
          action: "project.public_page_published",
          entityType: "project_brand",
          entityId: brand.id,
          metadata: {
            template: config.layout.template,
            widgets: config.widgets.filter((widget) => widget.enabled).length,
          },
        },
      });
      return this.toState(next);
    });
    await this.invalidate(projectId);
    return state;
  }

  /** Published layout for a slug that currently has public release notes. */
  async publicConfig(slug: string) {
    const snapshot = await this.prisma.publicReleaseSnapshot.findFirst({
      where: {
        projectSlug: slug,
        audienceMode: "PUBLIC",
        publication: { is: { revokedAt: null } },
      },
      select: {
        publication: { select: { release: { select: { projectId: true } } } },
      },
      orderBy: { publishedAt: "desc" },
    });
    const projectId = snapshot?.publication?.release?.projectId;
    if (!projectId) throw new NotFoundException("Published project not found");
    const brand = await this.prisma.projectBrand.findUnique({
      where: { projectId },
      select: { settings: true },
    });
    const stored = readStored(readSettings(brand?.settings));
    return {
      customized: stored.published !== undefined,
      config: stored.published
        ? normalizePublicPageConfig(stored.published)
        : defaultPublicPageConfig(),
    };
  }

  private toState(stored: StoredPublicPage): PublicPageState {
    const published =
      stored.published === undefined
        ? null
        : normalizePublicPageConfig(stored.published);
    const draft =
      stored.draft === undefined
        ? (published ?? defaultPublicPageConfig())
        : normalizePublicPageConfig(stored.draft);
    return {
      draft,
      published,
      draftUpdatedAt: stored.draftUpdatedAt ?? null,
      publishedAt: stored.publishedAt ?? null,
      hasUnpublishedChanges:
        JSON.stringify(draft) !==
        JSON.stringify(published ?? defaultPublicPageConfig()),
    };
  }

  private async invalidate(projectId: string) {
    if (!this.publicResponseCache) return;
    const [project, snapshots] = await Promise.all([
      this.prisma.project.findUnique({
        where: { id: projectId },
        select: { slug: true },
      }),
      this.prisma.publicReleaseSnapshot.findMany({
        where: { publication: { is: { release: { is: { projectId } } } } },
        select: { projectSlug: true },
        distinct: ["projectSlug"],
      }),
    ]);
    const slugs = new Set(
      [
        project?.slug,
        ...snapshots.map(({ projectSlug }) => projectSlug),
      ].filter((slug): slug is string => Boolean(slug)),
    );
    await Promise.all(
      [...slugs].map((slug) =>
        this.publicResponseCache!.invalidateProject(slug),
      ),
    );
  }

  private async requireRole(actor: Actor, projectId: string, admin: boolean) {
    if (actor.isSystemAdmin) {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true },
      });
      if (!project) throw new NotFoundException("Project not found");
      return;
    }
    const membership = await this.prisma.projectMember.findFirst({
      where: { projectId, userId: actor.id },
      select: { role: true },
    });
    if (!membership || membership.role === "CLIENT")
      throw new NotFoundException("Project not found");
    if (admin && membership.role !== "ADMIN")
      throw new ForbiddenException("Project administrator access is required");
  }
}
