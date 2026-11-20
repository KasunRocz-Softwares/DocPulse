import { Injectable, NotFoundException } from "@nestjs/common";
import { ChangeCategory } from "../generated/prisma/client";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  canonicalizeLocale,
  resolvePublicLocale,
} from "../localization/localization";

const activeSnapshot = {
  publication: { revokedAt: null },
  audienceMode: "PUBLIC",
} as const;

function normalizePage(value: number): number {
  return Number.isFinite(value) && value >= 1
    ? Math.min(1_000_000, Math.floor(value))
    : 1;
}
/** The approved revision's frozen content (holds the release date). */
const approvedContent = {
  select: { revision: { select: { content: true } } },
} as const;

/** Release date from the approved revision, if the release had one. */
function approvedReleaseDate(snapshot: {
  publication?: { revision?: { content?: unknown } | null } | null;
}): Date | null {
  const content = snapshot.publication?.revision?.content;
  const value =
    content && typeof content === "object" && !Array.isArray(content)
      ? (content as Record<string, unknown>).releaseDate
      : null;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const snapshotWithChanges = {
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
  publication: approvedContent,
  changes: {
    select: {
      id: true,
      title: true,
      category: true,
      description: true,
      sortOrder: true,
    },
    orderBy: { sortOrder: "asc" },
  },
  attachments: {
    select: {
      id: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      checksumSha256: true,
    },
    orderBy: { fileName: "asc" },
  },
} as const;

const snapshotWithChangePreviews = {
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
  publication: approvedContent,
  changes: {
    select: { id: true, title: true, category: true, sortOrder: true },
    orderBy: { sortOrder: "asc" },
    take: 3,
  },
} as const;

function snapshotSelectWithLocale(
  select: typeof snapshotWithChanges | typeof snapshotWithChangePreviews,
  requestedLocale?: string,
) {
  return requestedLocale
    ? {
        ...select,
        locales: {
          select: {
            locale: true,
            title: true,
            summary: true,
            changes: { select: { snapshotChangeId: true, description: true } },
          },
        },
      }
    : select;
}

type PublicSnapshot = {
  id: string;
  projectSlug: string;
  projectName: string;
  version: string;
  title: string;
  summary: string | null;
  primaryColor: string;
  accentColor: string | null;
  logoUrl: string | null;
  locale: string;
  defaultLocale: string;
  publishedAt: Date;
  publication?: { revision?: { content?: unknown } | null } | null;
  changes: Array<{
    id?: string;
    title: string;
    category: ChangeCategory;
    description?: string;
    sortOrder: number;
  }>;
  locales?: Array<{
    locale: string;
    title: string;
    summary: string | null;
    changes: Array<{ snapshotChangeId: string; description: string }>;
  }>;
  attachments?: Array<{
    id: string;
    fileName: string;
    contentType: string;
    sizeBytes: bigint;
    checksumSha256: string;
  }>;
};

function toPublicSnapshot(snapshot: PublicSnapshot, requestedLocale?: string) {
  const defaultLocale = snapshot.defaultLocale ?? snapshot.locale ?? "en";
  const selectedLocale = resolvePublicLocale(requestedLocale, defaultLocale, [
    defaultLocale,
    ...(snapshot.locales ?? []).map(({ locale }) => locale),
  ]);
  const availableLocales = [
    ...new Set([
      defaultLocale,
      ...(snapshot.locales ?? []).map(({ locale }) => locale),
    ]),
  ];
  const localized = snapshot.locales?.find(
    ({ locale }) => locale.toLowerCase() === selectedLocale.toLowerCase(),
  );
  const localizedDescriptions = new Map(
    localized?.changes.map(({ snapshotChangeId, description }) => [
      snapshotChangeId,
      description,
    ]) ?? [],
  );
  return {
    projectSlug: snapshot.projectSlug,
    projectName: snapshot.projectName,
    version: snapshot.version,
    title: localized?.title ?? snapshot.title,
    summary: localized?.summary ?? snapshot.summary,
    primaryColor: snapshot.primaryColor,
    accentColor: snapshot.accentColor,
    logoUrl: snapshot.logoUrl,
    locale: selectedLocale,
    defaultLocale: snapshot.defaultLocale,
    availableLocales,
    publishedAt: snapshot.publishedAt,
    releaseDate: approvedReleaseDate(snapshot)?.toISOString() ?? null,
    changes: snapshot.changes.map((change) => ({
      title: change.title,
      category: change.category,
      ...(typeof (change.id
        ? localizedDescriptions.get(change.id)
        : undefined) === "string"
        ? { description: localizedDescriptions.get(change.id!) }
        : typeof change.description === "string"
          ? { description: change.description }
          : {}),
      sortOrder: change.sortOrder,
    })),
    attachments: (snapshot.attachments ?? []).map((attachment) => ({
      id: attachment.id,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      sizeBytes: attachment.sizeBytes.toString(),
      checksumSha256: attachment.checksumSha256,
      downloadUrl: `/projects/${encodeURIComponent(snapshot.projectSlug)}/releases/${encodeURIComponent(snapshot.version)}/attachments/${encodeURIComponent(attachment.id)}/download`,
    })),
  };
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const match =
      /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
        value,
      );
    if (!match) return null;
    return {
      numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
      prerelease: match[4]?.split(".") ?? [],
    };
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    const difference = a.numbers[index]! - b.numbers[index]!;
    if (difference !== 0) return difference;
  }
  if (a.prerelease.length === 0) return b.prerelease.length === 0 ? 0 : 1;
  if (b.prerelease.length === 0) return -1;
  for (
    let index = 0;
    index < Math.max(a.prerelease.length, b.prerelease.length);
    index += 1
  ) {
    const partA = a.prerelease[index];
    const partB = b.prerelease[index];
    if (partA === undefined) return -1;
    if (partB === undefined) return 1;
    if (partA === partB) continue;
    const numericA = /^\d+$/.test(partA);
    const numericB = /^\d+$/.test(partB);
    if (numericA && numericB) return Number(partA) - Number(partB);
    if (numericA !== numericB) return numericA ? -1 : 1;
    return partA.localeCompare(partB);
  }
  return 0;
}

function isStableVersion(version: string): boolean {
  return /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z.-]+)?$/.test(
    version,
  );
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (character) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      '"': "&quot;",
    };
    return entities[character]!;
  });
}

@Injectable()
export class PublicService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveHost(inputHost: string) {
    const host = inputHost.trim().toLowerCase().replace(/\.$/, "");
    if (
      !host.includes(".") ||
      host.length > 253 ||
      host
        .split(".")
        .some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    )
      throw new NotFoundException("Published custom domain not found");

    const brand = await this.prisma.projectBrand.findUnique({
      where: { customDomain: host },
      select: { projectId: true, settings: true },
    });
    const settings = brand?.settings;
    const verifiedAt =
      settings && typeof settings === "object" && !Array.isArray(settings)
        ? (settings as Record<string, unknown>).customDomainVerifiedAt
        : undefined;
    if (!brand || typeof verifiedAt !== "string")
      throw new NotFoundException("Published custom domain not found");

    const publishedProject = await this.prisma.publicReleaseSnapshot.findFirst({
      where: {
        audienceMode: "PUBLIC",
        publication: {
          is: {
            revokedAt: null,
            release: { is: { projectId: brand.projectId } },
          },
        },
      },
      select: { projectSlug: true },
    });
    if (!publishedProject)
      throw new NotFoundException("Published custom domain not found");
    return { slug: publishedProject.projectSlug };
  }

  async project(slug: string, locale?: string) {
    const [latest, counts] = await Promise.all([
      this.prisma.publicReleaseSnapshot.findFirst({
        where: { ...activeSnapshot, projectSlug: slug },
        select: {
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
          publication: approvedContent,
          locales: {
            select: { locale: true, title: true, summary: true },
          },
        },
        orderBy: { publishedAt: "desc" },
      }),
      this.prisma.$queryRaw<Array<{ releaseCount: number }>>(Prisma.sql`
        SELECT COUNT(DISTINCT s."version")::int AS "releaseCount"
        FROM "PublicReleaseSnapshot" s
        JOIN "ReleasePublication" p ON p."id" = s."publicationId"
        WHERE s."projectSlug" = ${slug}
          AND s."audienceMode" = 'PUBLIC'
          AND p."revokedAt" IS NULL
      `),
    ]);
    if (!latest) throw new NotFoundException("Published project not found");
    const localizedLocale = resolvePublicLocale(
      locale,
      latest.defaultLocale ?? latest.locale ?? "en",
      [
        latest.defaultLocale ?? latest.locale ?? "en",
        ...(latest.locales ?? []).map((item) => item.locale),
      ],
    );
    const localized = latest.locales?.find(
      (item) => item.locale.toLowerCase() === localizedLocale.toLowerCase(),
    );
    const latestReleaseDate =
      approvedReleaseDate(latest)?.toISOString() ?? null;
    return {
      slug: latest.projectSlug,
      name: latest.projectName,
      releaseCount: counts[0]?.releaseCount ?? 0,
      latestPublishedAt: latest.publishedAt,
      latestReleaseDate,
      primaryColor: latest.primaryColor,
      accentColor: latest.accentColor,
      logoUrl: latest.logoUrl,
      defaultLocale: latest.defaultLocale,
      latestRelease: {
        version: latest.version,
        title: localized?.title ?? latest.title,
        summary: localized?.summary ?? latest.summary,
        locale: localizedLocale,
        availableLocales: [
          ...new Set([
            latest.defaultLocale ?? latest.locale ?? "en",
            ...(latest.locales ?? []).map((item) => item.locale),
          ]),
        ],
        publishedAt: latest.publishedAt,
        releaseDate: latestReleaseDate,
      },
    };
  }

  async releases(slug: string) {
    return this.releasePage(slug, 1, 20);
  }

  async releasePage(slug: string, page = 1, pageSize = 20, locale?: string) {
    const safePage = normalizePage(page);
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize) || 20));
    const {
      ids,
      total,
      page: actualPage,
    } = await this.snapshotPage(slug, safePage, safePageSize);
    if (total === 0) throw new NotFoundException("Published project not found");
    const snapshots = await this.loadSnapshotIds(ids, false, locale);
    return {
      page: actualPage,
      pageSize: safePageSize,
      total,
      totalPages: Math.ceil(total / safePageSize),
      results: this.orderSnapshots(ids, snapshots).map((snapshot) =>
        toPublicSnapshot(snapshot, locale),
      ),
    };
  }

  async latest(slug: string, locale?: string) {
    const rows = await this.prisma.$queryRaw<Array<{ version: string }>>(
      Prisma.sql`
        SELECT DISTINCT s."version"
        FROM "PublicReleaseSnapshot" s
        JOIN "ReleasePublication" p ON p."id" = s."publicationId"
        WHERE s."projectSlug" = ${slug}
          AND s."audienceMode" = 'PUBLIC'
          AND p."revokedAt" IS NULL
      `,
    );
    const stableVersion = rows
      .map(({ version }) => version)
      .filter(isStableVersion)
      .sort((a, b) => compareVersions(b, a))[0];
    if (!stableVersion)
      throw new NotFoundException("No published stable release found");
    const stable = await this.prisma.publicReleaseSnapshot.findFirst({
      where: { ...activeSnapshot, projectSlug: slug, version: stableVersion },
      select: snapshotSelectWithLocale(snapshotWithChanges, locale),
      orderBy: { publishedAt: "desc" },
    });
    if (!stable)
      throw new NotFoundException("No published stable release found");
    return toPublicSnapshot(stable as PublicSnapshot, locale);
  }

  async release(slug: string, version: string, locale?: string) {
    const snapshot = await this.prisma.publicReleaseSnapshot.findFirst({
      where: { ...activeSnapshot, projectSlug: slug, version },
      select: snapshotSelectWithLocale(snapshotWithChanges, locale),
      orderBy: { publishedAt: "desc" },
    });
    if (!snapshot) throw new NotFoundException("Published release not found");
    return toPublicSnapshot(snapshot as PublicSnapshot, locale);
  }

  async changelog(slug: string) {
    return this.releases(slug);
  }

  async search(
    slug: string,
    query: string,
    page = 1,
    pageSize = 20,
    locale?: string,
  ) {
    const term = query.trim().slice(0, 100);
    const safePage = normalizePage(page);
    const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize) || 20));
    const projectExists = await this.prisma.publicReleaseSnapshot.findFirst({
      where: { ...activeSnapshot, projectSlug: slug },
      select: { id: true },
    });
    if (!projectExists)
      throw new NotFoundException("Published project not found");
    if (term.length < 2)
      return {
        query: term,
        page: 1,
        pageSize: safePageSize,
        results: [],
        total: 0,
        totalPages: 0,
      };
    const {
      ids,
      total,
      page: actualPage,
    } = await this.snapshotPage(slug, safePage, safePageSize, term, locale);
    const snapshots = await this.loadSnapshotIds(ids, false, locale);
    return {
      query: term,
      page: actualPage,
      pageSize: safePageSize,
      total,
      totalPages: Math.ceil(total / safePageSize),
      results: this.orderSnapshots(ids, snapshots).map((snapshot) =>
        toPublicSnapshot(snapshot, locale),
      ),
    };
  }

  private async snapshotPage(
    slug: string,
    page: number,
    pageSize: number,
    term?: string,
    locale?: string,
  ) {
    const pattern = term ? `%${term}%` : undefined;
    const normalizedLocale = locale ? canonicalizeLocale(locale) : undefined;
    const baseLocale = normalizedLocale?.split("-")[0];
    const matching = pattern
      ? Prisma.sql`AND (
          s."title" ILIKE ${pattern}
          OR s."summary" ILIKE ${pattern}
          OR EXISTS (SELECT 1 FROM "PublicSnapshotChange" c WHERE c."snapshotId" = s."id" AND c."title" ILIKE ${pattern})
          OR EXISTS (SELECT 1 FROM "PublicSnapshotChange" c WHERE c."snapshotId" = s."id" AND c."description" ILIKE ${pattern})
          ${
            normalizedLocale
              ? Prisma.sql`OR EXISTS (
            SELECT 1 FROM "PublicSnapshotLocale" l
            WHERE l."snapshotId" = s."id"
              AND (
                l."locale" = ${normalizedLocale}
                OR l."locale" = ${baseLocale}
                OR l."locale" LIKE ${`${baseLocale}-%`}
              )
              AND (
                l."title" ILIKE ${pattern}
                OR COALESCE(l."summary", s."summary") ILIKE ${pattern}
                OR EXISTS (
                  SELECT 1 FROM "PublicSnapshotChangeLocale" cl
                  JOIN "PublicSnapshotChange" c ON c."id" = cl."snapshotChangeId"
                  WHERE cl."localeId" = l."id" AND c."snapshotId" = s."id"
                    AND cl."description" ILIKE ${pattern}
                )
              )
          )`
              : Prisma.empty
          }
        )`
      : Prisma.empty;
    const canonical = Prisma.sql`
      WITH canonical AS (
        SELECT DISTINCT ON (s."version") s."id", s."version", s."publishedAt"
        FROM "PublicReleaseSnapshot" s
        JOIN "ReleasePublication" p ON p."id" = s."publicationId"
        WHERE s."projectSlug" = ${slug}
          AND s."audienceMode" = 'PUBLIC'
          AND p."revokedAt" IS NULL
        ORDER BY s."version", s."publishedAt" DESC, s."id" DESC
      ), matched AS (
        SELECT c."id", c."version", c."publishedAt"
        FROM canonical c
        JOIN "PublicReleaseSnapshot" s ON s."id" = c."id"
        WHERE TRUE ${matching}
      )`;
    const totals = await this.prisma.$queryRaw<
      Array<{ total: number }>
    >(Prisma.sql`
        ${canonical}
        SELECT COUNT(*)::int AS total FROM matched
      `);
    const total = totals[0]?.total ?? 0;
    const totalPages = Math.ceil(total / pageSize);
    const actualPage = totalPages ? Math.min(page, totalPages) : 1;
    const rows = total
      ? await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          ${canonical}
          SELECT "id" FROM matched
          ORDER BY "publishedAt" DESC, "version" DESC
          LIMIT ${pageSize} OFFSET ${(actualPage - 1) * pageSize}
        `)
      : [];
    return {
      ids: rows.map(({ id }) => id),
      total,
      page: actualPage,
    };
  }

  private async loadSnapshotIds(
    ids: string[],
    includeFullContent = false,
    locale?: string,
  ) {
    if (!ids.length) return [] as PublicSnapshot[];
    return (await this.prisma.publicReleaseSnapshot.findMany({
      where: { id: { in: ids }, ...activeSnapshot },
      select: snapshotSelectWithLocale(
        includeFullContent ? snapshotWithChanges : snapshotWithChangePreviews,
        locale,
      ),
    })) as PublicSnapshot[];
  }

  private orderSnapshots(ids: string[], snapshots: PublicSnapshot[]) {
    const byId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
    return ids
      .map((id) => byId.get(id))
      .filter((item): item is PublicSnapshot => !!item);
  }

  async changes(slug: string, version: string, locale?: string) {
    return (await this.release(slug, version, locale)).changes;
  }

  async shareMetadata(slug: string, version?: string, locale?: string) {
    if (!version) {
      const project = await this.project(slug, locale);
      return {
        title: `${project.name} release notes`,
        description: `Browse ${project.releaseCount} published releases for ${project.name}.`,
        project: { slug: project.slug, name: project.name },
        version: project.latestRelease.version,
        publishedAt: project.latestPublishedAt,
        locale: project.latestRelease.locale,
        path: `/projects/${encodeURIComponent(slug)}${locale ? `?locale=${encodeURIComponent(project.latestRelease.locale)}` : ""}`,
      };
    }
    const snapshot = await this.release(slug, version, locale);
    const description =
      snapshot.summary?.trim() ||
      `Release notes for ${snapshot.projectName} ${snapshot.version}`;
    return {
      title: `${snapshot.title} · ${snapshot.projectName}`,
      description,
      project: { slug: snapshot.projectSlug, name: snapshot.projectName },
      version: snapshot.version,
      publishedAt: snapshot.publishedAt,
      locale: snapshot.locale,
      path: `/projects/${encodeURIComponent(slug)}/releases/${encodeURIComponent(snapshot.version)}${locale ? `?locale=${encodeURIComponent(snapshot.locale)}` : ""}`,
    };
  }

  async rss(slug: string, locale?: string) {
    const project = await this.project(slug, locale);
    const releasePage = await this.releasePage(slug, 1, 50, locale);
    const releases = releasePage.results;
    const baseUrl =
      process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ??
      "http://localhost:5174";
    const apiBaseUrl =
      process.env.PUBLIC_API_BASE_URL?.replace(/\/$/, "") ??
      (process.env.PUBLIC_BASE_URL
        ? `${baseUrl}/api/v1/public`
        : "http://localhost:13001/api/v1/public");
    const items = releases
      .map((release) => {
        const localizedPath = `/projects/${encodeURIComponent(slug)}/releases/${encodeURIComponent(release.version)}${locale ? `?locale=${encodeURIComponent(release.locale)}` : ""}`;
        const link = `${baseUrl}${localizedPath}`;
        const summary =
          release.summary ??
          release.changes.map((change) => change.title).join(" ");
        return `    <item><title>${escapeXml(release.title)}</title><link>${escapeXml(link)}</link><guid isPermaLink="true">${escapeXml(link)}</guid><pubDate>${(release.releaseDate ? new Date(release.releaseDate) : release.publishedAt).toUTCString()}</pubDate><description>${escapeXml(summary)}</description></item>`;
      })
      .join("\n");
    const selfUrl = `${apiBaseUrl}/projects/${encodeURIComponent(slug)}/rss.xml${locale ? `?locale=${encodeURIComponent(locale)}` : ""}`;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${escapeXml(`${project.name} release notes`)}</title><link>${escapeXml(baseUrl || "/")}</link><description>${escapeXml(`Published release notes for ${project.name}`)}</description><atom:link xmlns:atom="http://www.w3.org/2005/Atom" href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml"/>\n${items}\n  </channel></rss>`;
  }
}
