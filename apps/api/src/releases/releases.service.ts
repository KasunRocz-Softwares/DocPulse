import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  ChangeCategory,
  ChangeVisibility,
  ProjectRole,
  ReleaseChannel,
  ReleaseAudienceMode,
  ReleaseStatus,
} from "../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";
import { canonicalizeLocale } from "../localization/localization";
import { compareReleaseChanges } from "./release-comparison";

type Actor = { id: string; isSystemAdmin: boolean };

@Injectable()
export class ReleasesService {
  constructor(private readonly prisma: PrismaService) {}

  async saveTranslation(
    actor: Actor,
    releaseId: string,
    rawLocale: string,
    input: {
      title: string;
      summary?: string | null;
      changes: Array<{ changeId: string; description: string }>;
    },
  ) {
    const locale = canonicalizeLocale(rawLocale);
    const release = await this.prisma.release.findUnique({
      where: { id: releaseId },
      select: {
        id: true,
        projectId: true,
        status: true,
        project: { select: { branding: { select: { defaultLocale: true } } } },
      },
    });
    if (!release) throw new NotFoundException("Release not found");
    await this.requireProjectRole(actor, release.projectId, [
      ProjectRole.ADMIN,
      ProjectRole.RELEASE_MANAGER,
      ProjectRole.DEVELOPER,
    ]);
    if (
      release.status !== ReleaseStatus.DRAFT &&
      release.status !== ReleaseStatus.REJECTED
    )
      throw new UnprocessableEntityException(
        "Translations can only be edited on draft or rejected releases",
      );
    const defaultLocale = canonicalizeLocale(
      release.project.branding?.defaultLocale ?? "en",
    );
    if (locale.toLowerCase() === defaultLocale.toLowerCase())
      throw new BadRequestException(
        "Use the release's primary fields for the project default locale",
      );
    if (!input.title.trim())
      throw new BadRequestException("Translated title is required");
    const changes = [
      ...new Map(
        input.changes.map((change) => [change.changeId, change]),
      ).values(),
    ];
    if (changes.some(({ description }) => !description.trim()))
      throw new BadRequestException(
        "Translated change descriptions cannot be empty",
      );
    const ownedChanges = changes.length
      ? await this.prisma.releaseChange.findMany({
          where: {
            releaseId,
            id: { in: changes.map(({ changeId }) => changeId) },
          },
          select: { id: true },
        })
      : [];
    if (ownedChanges.length !== changes.length)
      throw new BadRequestException(
        "Every translated change must belong to this release",
      );
    return this.prisma.$transaction(async (tx) => {
      const translation = await tx.releaseTranslation.upsert({
        where: { releaseId_locale: { releaseId, locale } },
        create: {
          releaseId,
          locale,
          title: input.title.trim(),
          summary: input.summary?.trim() || null,
        },
        update: {
          title: input.title.trim(),
          summary: input.summary?.trim() || null,
        },
      });
      await tx.releaseChangeTranslation.deleteMany({
        where: { translationId: translation.id },
      });
      if (changes.length)
        await tx.releaseChangeTranslation.createMany({
          data: changes.map(({ changeId, description }) => ({
            translationId: translation.id,
            changeId,
            description: description.trim(),
          })),
        });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId: release.projectId,
          action: "release.translation_saved",
          entityType: "release",
          entityId: releaseId,
          metadata: { locale, translatedChanges: changes.length },
        },
      });
      return {
        locale: translation.locale,
        title: translation.title,
        summary: translation.summary,
      };
    });
  }

  async search(actor: Actor, query: string, page = 1, pageSize = 30) {
    const term = query.trim().slice(0, 100);
    if (term.length < 2)
      return { items: [], page: 1, pageSize: 20, total: 0, pageCount: 1 };
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safePageSize = Math.min(100, Math.max(2, Math.floor(pageSize) || 30));
    const projectIds = actor.isSystemAdmin
      ? undefined
      : (
          await this.prisma.projectMember.findMany({
            where: { userId: actor.id, role: { not: ProjectRole.CLIENT } },
            select: { projectId: true },
          })
        ).map((membership) => membership.projectId);
    if (projectIds && projectIds.length === 0)
      return { items: [], page: 1, pageSize: 20, total: 0, pageCount: 1 };
    const match = { contains: term, mode: "insensitive" as const };
    const releaseWhere = {
      ...(projectIds ? { projectId: { in: projectIds } } : {}),
      OR: [
        { title: match },
        { version: match },
        { internalSummary: match },
        { publicSummary: match },
        {
          changes: {
            some: {
              OR: [
                { title: match },
                { internalDescription: match },
                { publicDescription: match },
              ],
            },
          },
        },
      ],
    };
    const documentPageSize = Math.ceil(safePageSize / 2);
    const releasePageSize = safePageSize - documentPageSize;
    const documentSkip = (safePage - 1) * documentPageSize;
    const releaseSkip = (safePage - 1) * releasePageSize;
    const [releaseHits, releaseTotal, documentTotalRows, documentHits] =
      await Promise.all([
        releasePageSize === 0
          ? Promise.resolve([])
          : this.prisma.release.findMany({
              where: releaseWhere,
              include: {
                project: { select: { id: true, name: true, slug: true } },
                changes: {
                  where: {
                    OR: [
                      { title: match },
                      { internalDescription: match },
                      { publicDescription: match },
                    ],
                  },
                  orderBy: { sortOrder: "asc" },
                  take: 10,
                },
              },
              orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
              skip: releaseSkip,
              take: releasePageSize,
            }),
        this.prisma.release.count({ where: releaseWhere }),
        this.prisma.$queryRaw<Array<{ total: bigint | number }>>`
          SELECT count(*)::bigint AS total
          FROM "ReleaseDocumentSearch" d
          JOIN "Release" r ON r.id = d."releaseId"
          WHERE d."searchVector" @@ websearch_to_tsquery('simple', ${term})
            AND (
              ${actor.isSystemAdmin}::boolean
              OR EXISTS (
                SELECT 1 FROM "ProjectMember" pm
                WHERE pm."projectId" = r."projectId"
                  AND pm."userId" = ${actor.id}::uuid
                  AND pm."role" <> 'CLIENT'
              )
            )
        `,
        this.prisma.$queryRaw<
          Array<{
            id: string;
            title: string;
            section: string;
            snippet: string;
            projectId: string;
            projectName: string;
            projectSlug: string;
            releaseId: string;
            version: string;
            releaseTitle: string;
            updatedAt: Date;
          }>
        >`
          SELECT
            d."documentId" AS id,
            d.title,
            d.section,
            CASE
              WHEN d."contentText" <> '' THEN ts_headline(
                'simple', d."contentText", websearch_to_tsquery('simple', ${term}),
                'MaxWords=24,MinWords=8,MaxFragments=1,StartSel=,StopSel='
              )
              ELSE d.title || ' · ' || d.section
            END AS snippet,
            r."projectId" AS "projectId",
            p.name AS "projectName",
            p.slug AS "projectSlug",
            r.id AS "releaseId",
            r.version,
            r.title AS "releaseTitle",
            d."updatedAt"
          FROM "ReleaseDocumentSearch" d
          JOIN "Release" r ON r.id = d."releaseId"
          JOIN "Project" p ON p.id = r."projectId"
          WHERE d."searchVector" @@ websearch_to_tsquery('simple', ${term})
            AND (
              ${actor.isSystemAdmin}::boolean
              OR EXISTS (
                SELECT 1 FROM "ProjectMember" pm
                WHERE pm."projectId" = r."projectId"
                  AND pm."userId" = ${actor.id}::uuid
                  AND pm."role" <> 'CLIENT'
              )
            )
          ORDER BY d."updatedAt" DESC, d."documentId" ASC
          LIMIT ${documentPageSize} OFFSET ${documentSkip}
        `,
      ]);
    const documents = documentHits.map((hit) => ({ ...hit, type: "document" }));
    const releases = releaseHits.map((hit) => ({ ...hit, type: "release" }));
    return {
      items: [...documents, ...releases],
      page: safePage,
      pageSize: safePageSize,
      total: releaseTotal + Number(documentTotalRows[0]?.total ?? 0),
      pageCount: Math.max(
        1,
        Math.ceil(Number(documentTotalRows[0]?.total ?? 0) / documentPageSize),
        Math.ceil(releaseTotal / releasePageSize),
      ),
    };
  }

  async exportCsv(actor: Actor, releaseId: string): Promise<string> {
    const release = await this.prisma.release.findUnique({
      where: { id: releaseId },
      select: { id: true, projectId: true, version: true },
    });
    if (!release) throw new NotFoundException("Release not found");
    await this.requireProjectRole(actor, release.projectId, [
      ProjectRole.ADMIN,
      ProjectRole.RELEASE_MANAGER,
      ProjectRole.DEVELOPER,
      ProjectRole.REVIEWER,
    ]);
    const changes = await this.prisma.releaseChange.findMany({
      where: { releaseId },
      orderBy: { sortOrder: "asc" },
      select: {
        title: true,
        category: true,
        visibility: true,
        internalDescription: true,
        publicDescription: true,
        sortOrder: true,
      },
    });
    const rows = [
      ["Version", release.version],
      [
        "Title",
        "Category",
        "Visibility",
        "Internal description",
        "Public description",
        "Order",
      ],
      ...changes.map((change) => [
        change.title,
        change.category,
        change.visibility,
        change.internalDescription,
        change.publicDescription ?? "",
        String(change.sortOrder),
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    await this.prisma.$transaction((tx) =>
      tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId: release.projectId,
          action: "release.exported",
          entityType: "release",
          entityId: releaseId,
          metadata: { format: "csv", rowCount: changes.length },
        },
      }),
    );
    return csv;
  }

  async list(actor: Actor, projectId: string) {
    await this.requireProjectRole(actor, projectId, [
      ProjectRole.ADMIN,
      ProjectRole.RELEASE_MANAGER,
      ProjectRole.DEVELOPER,
      ProjectRole.REVIEWER,
    ]);
    return this.prisma.release.findMany({
      where: { projectId },
      select: {
        id: true,
        version: true,
        title: true,
        type: true,
        channel: true,
        status: true,
        releaseDate: true,
        updatedAt: true,
        _count: { select: { changes: true, deployments: true } },
      },
      orderBy: [{ releaseDate: "desc" }, { createdAt: "desc" }],
    });
  }

  async compare(
    actor: Actor,
    projectId: string,
    fromReleaseId: string,
    toReleaseId: string,
  ) {
    await this.requireProjectRole(actor, projectId, [
      ProjectRole.ADMIN,
      ProjectRole.RELEASE_MANAGER,
      ProjectRole.DEVELOPER,
      ProjectRole.REVIEWER,
    ]);
    if (fromReleaseId === toReleaseId)
      throw new BadRequestException("Choose two different releases to compare");
    const releases = await this.prisma.release.findMany({
      where: { projectId, id: { in: [fromReleaseId, toReleaseId] } },
      include: {
        changes: {
          include: { references: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    const previous = releases.find((release) => release.id === fromReleaseId);
    const current = releases.find((release) => release.id === toReleaseId);
    if (!previous || !current) throw new NotFoundException("Release not found");
    return {
      from: {
        id: previous.id,
        version: previous.version,
        title: previous.title,
        releaseDate: previous.releaseDate,
      },
      to: {
        id: current.id,
        version: current.version,
        title: current.title,
        releaseDate: current.releaseDate,
      },
      changes: compareReleaseChanges(previous.changes, current.changes),
    };
  }

  async exportComparison(
    actor: Actor,
    projectId: string,
    fromReleaseId: string,
    toReleaseId: string,
    format: string,
  ): Promise<string> {
    if (format !== "csv" && format !== "json")
      throw new BadRequestException(
        "Comparison export format must be csv or json",
      );

    const comparison = await this.compare(
      actor,
      projectId,
      fromReleaseId,
      toReleaseId,
    );
    const rowCount =
      comparison.changes.added.length +
      comparison.changes.removed.length +
      comparison.changes.updated.length;
    const body =
      format === "json"
        ? JSON.stringify(comparison, null, 2)
        : comparisonCsv(comparison);

    await this.prisma.$transaction((tx) =>
      tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId,
          action: "release.comparison.exported",
          entityType: "release_comparison",
          entityId: `${fromReleaseId}:${toReleaseId}`,
          metadata: { format, rowCount, fromReleaseId, toReleaseId },
        },
      }),
    );

    return body;
  }

  async create(
    actor: Actor,
    projectId: string,
    input: {
      version: string;
      title: string;
      type: string;
      channel?: ReleaseChannel;
      releaseDate?: string;
      internalSummary?: string;
    },
  ) {
    await this.requireProjectRole(actor, projectId, [
      ProjectRole.ADMIN,
      ProjectRole.RELEASE_MANAGER,
      ProjectRole.DEVELOPER,
    ]);
    const version = input.version.startsWith("v")
      ? input.version
      : `v${input.version}`;
    return this.prisma.$transaction(async (tx) => {
      const release = await tx.release.create({
        data: {
          projectId,
          version,
          title: input.title.trim(),
          type: input.type as never,
          channel: input.channel ?? ReleaseChannel.STABLE,
          releaseDate: input.releaseDate ? new Date(input.releaseDate) : null,
          internalSummary: input.internalSummary?.trim() || null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId,
          action: "release.created",
          entityType: "release",
          entityId: release.id,
        },
      });
      return release;
    });
  }

  async update(
    actor: Actor,
    releaseId: string,
    input: {
      version?: string;
      title?: string;
      type?: string;
      channel?: ReleaseChannel;
      releaseDate?: string | null;
      internalSummary?: string | null;
      publicSummary?: string | null;
    },
  ) {
    const release = await this.prisma.release.findUnique({
      where: { id: releaseId },
      select: { id: true, projectId: true, status: true },
    });
    if (!release) throw new NotFoundException("Release not found");
    await this.requireProjectRole(actor, release.projectId, [
      ProjectRole.ADMIN,
      ProjectRole.RELEASE_MANAGER,
      ProjectRole.DEVELOPER,
    ]);
    if (
      release.status !== ReleaseStatus.DRAFT &&
      release.status !== ReleaseStatus.REJECTED
    )
      throw new UnprocessableEntityException(
        "Only draft or rejected releases can be edited",
      );

    const data = {
      ...(input.version === undefined
        ? {}
        : {
            version: input.version.startsWith("v")
              ? input.version
              : `v${input.version}`,
          }),
      ...(input.title === undefined ? {} : { title: input.title.trim() }),
      ...(input.type === undefined ? {} : { type: input.type as never }),
      ...(input.channel === undefined ? {} : { channel: input.channel }),
      ...(input.releaseDate === undefined
        ? {}
        : {
            releaseDate: input.releaseDate ? new Date(input.releaseDate) : null,
          }),
      ...(input.internalSummary === undefined
        ? {}
        : { internalSummary: input.internalSummary?.trim() || null }),
      ...(input.publicSummary === undefined
        ? {}
        : { publicSummary: input.publicSummary?.trim() || null }),
    };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.release.update({
          where: { id: releaseId },
          data,
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            projectId: release.projectId,
            action: "release.updated",
            entityType: "release",
            entityId: releaseId,
            metadata: { fields: Object.keys(data) },
          },
        });
        return updated;
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002"
      )
        throw new ConflictException("That version and channel already exist");
      throw error;
    }
  }

  async getAudience(actor: Actor, releaseId: string) {
    const release = await this.prisma.release.findUnique({
      where: { id: releaseId },
      select: {
        id: true,
        projectId: true,
        audienceMode: true,
        clientAudiences: {
          select: {
            audience: { select: { id: true, name: true, slug: true } },
          },
          orderBy: { audience: { name: "asc" } },
        },
      },
    });
    if (!release) throw new NotFoundException("Release not found");
    await this.requireProjectRole(actor, release.projectId, [
      ProjectRole.ADMIN,
      ProjectRole.RELEASE_MANAGER,
      ProjectRole.DEVELOPER,
      ProjectRole.REVIEWER,
    ]);
    return {
      releaseId: release.id,
      mode: release.audienceMode,
      audiences: release.clientAudiences.map(({ audience }) => audience),
    };
  }

  async setAudience(
    actor: Actor,
    releaseId: string,
    input: { mode: ReleaseAudienceMode; audienceIds: string[] },
  ) {
    const release = await this.prisma.release.findUnique({
      where: { id: releaseId },
      select: { id: true, projectId: true, status: true },
    });
    if (!release) throw new NotFoundException("Release not found");
    await this.requireProjectRole(actor, release.projectId, [
      ProjectRole.ADMIN,
      ProjectRole.RELEASE_MANAGER,
      ProjectRole.DEVELOPER,
    ]);
    if (
      release.status !== ReleaseStatus.DRAFT &&
      release.status !== ReleaseStatus.REJECTED
    )
      throw new UnprocessableEntityException(
        "Release audiences can only change on draft or rejected releases",
      );

    const audienceIds = [...new Set(input.audienceIds)];
    if (input.mode === ReleaseAudienceMode.CLIENTS && audienceIds.length === 0)
      throw new BadRequestException("Select at least one client audience");
    if (input.mode === ReleaseAudienceMode.PUBLIC && audienceIds.length > 0)
      throw new BadRequestException(
        "Public releases cannot include client-only audiences",
      );
    if (audienceIds.length) {
      const count = await this.prisma.clientAudience.count({
        where: { projectId: release.projectId, id: { in: audienceIds } },
      });
      if (count !== audienceIds.length)
        throw new NotFoundException(
          "One or more client audiences were not found in this project",
        );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.releaseClientAudience.deleteMany({ where: { releaseId } });
      if (audienceIds.length)
        await tx.releaseClientAudience.createMany({
          data: audienceIds.map((audienceId) => ({ releaseId, audienceId })),
        });
      await tx.release.update({
        where: { id: releaseId },
        data: { audienceMode: input.mode },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId: release.projectId,
          action: "release.audience_updated",
          entityType: "release",
          entityId: releaseId,
          metadata: { mode: input.mode, audienceIds },
        },
      });
    });
    return this.getAudience(actor, releaseId);
  }

  async archive(actor: Actor, releaseId: string) {
    const release = await this.prisma.release.findUnique({
      where: { id: releaseId },
      select: { id: true, projectId: true, status: true },
    });
    if (!release) throw new NotFoundException("Release not found");
    await this.requireProjectRole(actor, release.projectId, [
      ProjectRole.ADMIN,
      ProjectRole.RELEASE_MANAGER,
    ]);
    if (release.status === ReleaseStatus.ARCHIVED) return release;
    return this.prisma.$transaction(async (tx) => {
      const archived = await tx.release.update({
        where: { id: releaseId },
        data: { status: ReleaseStatus.ARCHIVED },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId: release.projectId,
          action: "release.archived",
          entityType: "release",
          entityId: releaseId,
          metadata: { previousStatus: release.status },
        },
      });
      return archived;
    });
  }

  async get(actor: Actor, releaseId: string) {
    const release = await this.prisma.release.findUnique({
      where: { id: releaseId },
      include: { project: { select: { id: true } } },
    });
    if (!release) throw new NotFoundException("Release not found");
    await this.requireProjectRole(actor, release.projectId, [
      ProjectRole.ADMIN,
      ProjectRole.RELEASE_MANAGER,
      ProjectRole.DEVELOPER,
      ProjectRole.REVIEWER,
    ]);
    return this.prisma.release.findUnique({
      where: { id: releaseId },
      include: {
        changes: { orderBy: { sortOrder: "asc" } },
        project: { select: { branding: { select: { defaultLocale: true } } } },
        translations: {
          include: { changes: true },
          orderBy: { locale: "asc" },
        },
        documents: { orderBy: { sortOrder: "asc" } },
        deployments: { include: { environment: true } },
      },
    });
  }

  async addChange(
    actor: Actor,
    releaseId: string,
    input: {
      title: string;
      category: string;
      internalDescription: string;
      publicDescription?: string;
    },
  ) {
    const release = await this.prisma.release.findUnique({
      where: { id: releaseId },
      select: { id: true, projectId: true, status: true },
    });
    if (!release) throw new NotFoundException("Release not found");
    await this.requireProjectRole(actor, release.projectId, [
      ProjectRole.ADMIN,
      ProjectRole.RELEASE_MANAGER,
      ProjectRole.DEVELOPER,
    ]);
    if (
      release.status !== ReleaseStatus.DRAFT &&
      release.status !== ReleaseStatus.REJECTED
    ) {
      throw new UnprocessableEntityException(
        "Changes can only be added to a draft or rejected release",
      );
    }
    const count = await this.prisma.releaseChange.count({
      where: { releaseId },
    });
    return this.prisma.$transaction(async (tx) => {
      const change = await tx.releaseChange.create({
        data: {
          releaseId,
          title: input.title.trim(),
          category: input.category as never,
          internalDescription: input.internalDescription.trim(),
          publicDescription: input.publicDescription?.trim() || null,
          visibility: input.publicDescription?.trim()
            ? ChangeVisibility.PUBLIC_CANDIDATE
            : ChangeVisibility.INTERNAL_ONLY,
          sortOrder: count,
          authorId: actor.id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId: release.projectId,
          action: "release_change.created",
          entityType: "release_change",
          entityId: change.id,
        },
      });
      return change;
    });
  }

  async submitForReview(actor: Actor, releaseId: string) {
    const release = await this.prisma.release.findUnique({
      where: { id: releaseId },
      include: { changes: true, project: { select: { id: true } } },
    });
    if (!release) throw new NotFoundException("Release not found");
    await this.requireProjectRole(actor, release.projectId, [
      ProjectRole.ADMIN,
      ProjectRole.RELEASE_MANAGER,
      ProjectRole.DEVELOPER,
    ]);
    if (
      release.status !== ReleaseStatus.DRAFT ||
      release.changes.length === 0
    ) {
      throw new UnprocessableEntityException(
        "A draft release with at least one change is required for review",
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.release.update({
        where: { id: releaseId },
        data: { status: ReleaseStatus.REVIEW },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId: release.projectId,
          action: "release.submitted_for_review",
          entityType: "release",
          entityId: releaseId,
        },
      });
      return updated;
    });
  }

  async updateChange(
    actor: Actor,
    releaseId: string,
    changeId: string,
    input: {
      title: string;
      category: string;
      internalDescription: string;
      publicDescription?: string;
    },
  ) {
    const change = await this.prisma.releaseChange.findFirst({
      where: { id: changeId, releaseId },
      include: { release: { select: { projectId: true, status: true } } },
    });
    if (!change) throw new NotFoundException("Release change not found");
    await this.requireProjectRole(actor, change.release.projectId, [
      ProjectRole.ADMIN,
      ProjectRole.RELEASE_MANAGER,
      ProjectRole.DEVELOPER,
    ]);
    if (
      change.release.status !== ReleaseStatus.DRAFT &&
      change.release.status !== ReleaseStatus.REJECTED
    ) {
      throw new UnprocessableEntityException(
        "Changes can only be edited on a draft or rejected release",
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.releaseChange.update({
        where: { id: changeId },
        data: {
          title: input.title.trim(),
          category: input.category as never,
          internalDescription: input.internalDescription.trim(),
          publicDescription: input.publicDescription?.trim() || null,
          visibility: input.publicDescription?.trim()
            ? ChangeVisibility.PUBLIC_CANDIDATE
            : ChangeVisibility.INTERNAL_ONLY,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId: change.release.projectId,
          action: "release_change.updated",
          entityType: "release_change",
          entityId: changeId,
        },
      });
      return updated;
    });
  }

  async bulkUpdateChanges(
    actor: Actor,
    releaseId: string,
    changes: Array<{
      id: string;
      sortOrder: number;
      category?: ChangeCategory;
      visibility?: ChangeVisibility;
    }>,
  ) {
    if (changes.length === 0 || changes.length > 500)
      throw new BadRequestException("Provide between 1 and 500 changes");
    const ids = new Set(changes.map((change) => change.id));
    const orders = new Set(changes.map((change) => change.sortOrder));
    if (ids.size !== changes.length)
      throw new BadRequestException("Change IDs must be unique");
    if (
      changes.some(
        (change) =>
          !Number.isSafeInteger(change.sortOrder) || change.sortOrder < 0,
      ) ||
      orders.size !== changes.length
    )
      throw new BadRequestException(
        "Sort positions must be unique non-negative integers",
      );

    const release = await this.prisma.release.findUnique({
      where: { id: releaseId },
      select: { id: true, projectId: true, status: true },
    });
    if (!release) throw new NotFoundException("Release not found");
    await this.requireProjectRole(actor, release.projectId, [
      ProjectRole.ADMIN,
      ProjectRole.RELEASE_MANAGER,
      ProjectRole.DEVELOPER,
    ]);
    if (
      release.status !== ReleaseStatus.DRAFT &&
      release.status !== ReleaseStatus.REJECTED
    )
      throw new UnprocessableEntityException(
        "Changes can only be edited on a draft or rejected release",
      );

    const existing = await this.prisma.releaseChange.findMany({
      where: { releaseId, id: { in: [...ids] } },
      select: { id: true },
    });
    if (existing.length !== changes.length)
      throw new NotFoundException("One or more release changes were not found");

    return this.prisma.$transaction(async (tx) => {
      for (const change of changes) {
        await tx.releaseChange.update({
          where: { id: change.id },
          data: {
            sortOrder: change.sortOrder,
            ...(change.category === undefined
              ? {}
              : { category: change.category }),
            ...(change.visibility === undefined
              ? {}
              : { visibility: change.visibility }),
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId: release.projectId,
          action: "release_changes.bulk_updated",
          entityType: "release",
          entityId: releaseId,
          metadata: {
            changeIds: changes.map(({ id }) => id),
            count: changes.length,
          },
        },
      });
      return tx.releaseChange.findMany({
        where: { releaseId },
        orderBy: { sortOrder: "asc" },
      });
    });
  }

  private async requireProjectRole(
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

function comparisonCsv(comparison: {
  from: { version: string };
  to: { version: string };
  changes: {
    added: Array<{
      title: string;
      category: string;
      internalDescription: string;
      publicDescription: string | null;
      visibility: string;
      references?: Array<{
        repository: string;
        kind: string;
        externalId: string;
      }>;
    }>;
    removed: Array<{
      title: string;
      category: string;
      internalDescription: string;
      publicDescription: string | null;
      visibility: string;
      references?: Array<{
        repository: string;
        kind: string;
        externalId: string;
      }>;
    }>;
    updated: Array<{
      before: {
        title: string;
        category: string;
        internalDescription: string;
        publicDescription: string | null;
        visibility: string;
        references?: Array<{
          repository: string;
          kind: string;
          externalId: string;
        }>;
      };
      after: {
        title: string;
        category: string;
        internalDescription: string;
        publicDescription: string | null;
        visibility: string;
        references?: Array<{
          repository: string;
          kind: string;
          externalId: string;
        }>;
      };
    }>;
  };
}): string {
  const headers = [
    "From version",
    "To version",
    "Change",
    "Title",
    "Category",
    "Before internal description",
    "After internal description",
    "Before public description",
    "After public description",
    "Visibility",
    "References",
  ];
  const rows: string[][] = [headers];
  for (const [kind, changes] of [
    ["Added", comparison.changes.added],
    ["Removed", comparison.changes.removed],
  ] as const) {
    for (const change of changes) {
      const added = kind === "Added";
      rows.push([
        comparison.from.version,
        comparison.to.version,
        kind,
        change.title,
        change.category,
        added ? "" : change.internalDescription,
        added ? change.internalDescription : "",
        added ? "" : (change.publicDescription ?? ""),
        added ? (change.publicDescription ?? "") : "",
        change.visibility,
        JSON.stringify(change.references ?? []),
      ]);
    }
  }
  for (const { before, after } of comparison.changes.updated) {
    rows.push([
      comparison.from.version,
      comparison.to.version,
      "Updated",
      after.title,
      after.category,
      before.internalDescription,
      after.internalDescription,
      before.publicDescription ?? "",
      after.publicDescription ?? "",
      `${before.visibility} → ${after.visibility}`,
      JSON.stringify(after.references ?? []),
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function csvCell(value: string): string {
  const safe = /^[\t\r ]*[=+@-]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
