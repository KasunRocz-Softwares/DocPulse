import * as assert from "node:assert/strict";
import { test } from "node:test";
import { PublicService } from "./public.service";

const timestamp = new Date("2026-11-10T12:00:00.000Z");

const snapshot = (version: string) => ({
  id: version,
  projectSlug: "rdps",
  projectName: "RDPS",
  version,
  title: `Release ${version}`,
  summary: null,
  locale: "en",
  contentHash: `hash-${version}`,
  publishedAt: timestamp,
  changes: [],
  attachments: [],
});

test("latest returns the newest stable release using published snapshots only", async () => {
  const queries: unknown[] = [];
  const prisma = new Proxy(
    {
      publicReleaseSnapshot: {
        findFirst: async (query: unknown) => {
          queries.push(query);
          return { ...snapshot("2.10.0"), id: "stable" };
        },
      },
      $queryRaw: async () => [
        { version: "3.0.0-beta.1" },
        { version: "2.9.0" },
        { version: "2.10.0" },
      ],
    },
    {
      get(target, property, receiver) {
        if (property === "publicReleaseSnapshot" || property === "$queryRaw")
          return Reflect.get(target, property, receiver);
        throw new Error(
          `Public delivery attempted a non-snapshot query: ${String(property)}`,
        );
      },
    },
  );

  const result = await new PublicService(prisma as never).latest("rdps");

  assert.equal(result.version, "2.10.0");
  assert.equal(queries.length, 1);
  assert.doesNotMatch(JSON.stringify(queries[0]), /release/);
});

test("latest excludes prerelease versions even when they were published later", async () => {
  const prisma = {
    publicReleaseSnapshot: {
      findFirst: async () => ({ ...snapshot("3.8.2"), id: "stable" }),
    },
    $queryRaw: async () => [{ version: "4.0.0-rc.1" }, { version: "3.8.2" }],
  };

  const result = await new PublicService(prisma as never).latest("rdps");

  assert.equal(result.version, "3.8.2");
});

test("public search filters and paginates canonical snapshots in PostgreSQL", async () => {
  const rawQueries: unknown[] = [];
  const findQueries: unknown[] = [];
  const prisma = {
    publicReleaseSnapshot: {
      findFirst: async () => ({ id: "snapshot-1" }),
      findMany: async (value: unknown) => {
        findQueries.push(value);
        return [{ ...snapshot("1.2.3"), id: "snapshot-1" }];
      },
    },
    $queryRaw: async (query: unknown) => {
      rawQueries.push(query);
      return rawQueries.length === 1 ? [{ total: 1 }] : [{ id: "snapshot-1" }];
    },
  };

  const result = await new PublicService(prisma as never).search(
    "rdps",
    "  billing  ",
    0,
    500,
  );

  assert.equal(result.query, "billing");
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 100);
  assert.equal(result.total, 1);
  assert.equal(result.totalPages, 1);
  assert.equal(result.results[0]?.version, "1.2.3");
  assert.equal(rawQueries.length, 2);
  const sql = rawQueries
    .map((query) => (query as { sql?: string }).sql ?? "")
    .join("\n");
  assert.match(sql, /DISTINCT ON/);
  assert.match(sql, /ILIKE/);
  assert.match(sql, /LIMIT/);
  assert.match(sql, /OFFSET/);
  assert.equal(findQueries.length, 1);
  assert.doesNotMatch(
    JSON.stringify(rawQueries),
    /releaseDocument|internalDescription|ReleaseChange/,
  );
});

test("public search filters against translated title, summary, and change descriptions", async () => {
  const rawQueries: Array<{ sql?: string; values?: unknown[] }> = [];
  const prisma = {
    publicReleaseSnapshot: {
      findFirst: async () => ({ id: "published-project" }),
      findMany: async () => [],
    },
    $queryRaw: async (query: unknown) => {
      const raw = query as { sql?: string; values?: unknown[] };
      rawQueries.push(raw);
      return rawQueries.length === 1
        ? [{ total: 0 }]
        : rawQueries.length === 2
          ? []
          : [{ total: 0 }];
    },
  };

  await new PublicService(prisma as never).search(
    "rdps",
    "billing",
    1,
    20,
    "si-LK",
  );

  const sql = rawQueries.map(({ sql: text }) => text ?? "").join("\n");
  assert.match(sql, /PublicSnapshotLocale/);
  assert.match(sql, /PublicSnapshotChangeLocale/);
  assert.match(sql, /ILIKE/);
  assert.ok(
    rawQueries.some(({ values }) => values?.some((value) => value === "si-LK")),
  );
});

test("project profile returns localized latest release fields with per-field default fallback", async () => {
  const prisma = {
    publicReleaseSnapshot: {
      findFirst: async () => ({
        projectSlug: "rdps",
        projectName: "RDPS",
        version: "1.2.3",
        title: "Default release title",
        summary: "Default summary",
        primaryColor: "#2457c5",
        accentColor: null,
        logoUrl: null,
        locale: "en",
        defaultLocale: "en",
        publishedAt: timestamp,
        locales: [{ locale: "si-LK", title: "සිංහල නිකුතුව", summary: null }],
      }),
    },
    $queryRaw: async () => [{ releaseCount: 1 }],
  };

  const result = await new PublicService(prisma as never).project(
    "rdps",
    "si-LK",
  );

  assert.deepEqual(result.latestRelease, {
    version: "1.2.3",
    title: "සිංහල නිකුතුව",
    summary: "Default summary",
    locale: "si-LK",
    availableLocales: ["en", "si-LK"],
    publishedAt: timestamp,
    releaseDate: null,
  });
  assert.equal("locales" in result.latestRelease, false);
});

test("RSS contains only active snapshot versions and escapes XML content", async () => {
  const escaped = {
    ...snapshot("1.2.3"),
    title: "A <release> & notes",
    summary: "Ships <fast> & safe",
  };
  let rawQuery = 0;
  const prisma = {
    publicReleaseSnapshot: {
      findFirst: async () => escaped,
      findMany: async () => [{ ...escaped, id: "rss-release" }],
    },
    $queryRaw: async () => {
      rawQuery += 1;
      if (rawQuery === 1) return [{ releaseCount: 1 }];
      if (rawQuery === 2) return [{ total: 1 }];
      if (rawQuery === 3) return [{ id: "rss-release" }];
      return [{ total: 1 }];
    },
  };

  const xml = await new PublicService(prisma as never).rss("rdps");

  assert.match(xml, /A &lt;release&gt; &amp; notes/);
  assert.match(xml, /Ships &lt;fast&gt; &amp; safe/);
  assert.match(xml, /<rss version="2.0">/);
  assert.match(
    xml,
    /http:\/\/localhost:13001\/api\/v1\/public\/projects\/rdps\/rss\.xml/,
  );
});

test("project share metadata works when the latest published version is a prerelease", async () => {
  const prisma = {
    publicReleaseSnapshot: {
      findFirst: async () => snapshot("5.0.0-rc.1"),
    },
    $queryRaw: async () => [{ releaseCount: 1 }],
  };

  const metadata = await new PublicService(prisma as never).shareMetadata(
    "rdps",
  );

  assert.equal(metadata.title, "RDPS release notes");
  assert.equal(metadata.version, "5.0.0-rc.1");
  assert.equal(metadata.path, "/projects/rdps");
});

test("search returns not found for projects with no published snapshots", async () => {
  const prisma = {
    publicReleaseSnapshot: { findFirst: async () => null },
  };

  await assert.rejects(
    new PublicService(prisma as never).search("missing", "release"),
    { message: "Published project not found" },
  );
});

test("release history returns a bounded, stable page of public snapshots", async () => {
  const rawQueries: unknown[] = [];
  let snapshotQuery: { select?: Record<string, unknown> } | undefined;
  const prisma = {
    publicReleaseSnapshot: {
      findMany: async (query: unknown) => {
        snapshotQuery = query as typeof snapshotQuery;
        return [{ ...snapshot("2.0.0"), id: "snapshot-2" }];
      },
    },
    $queryRaw: async (query: unknown) => {
      rawQueries.push(query);
      return rawQueries.length === 1 ? [{ total: 41 }] : [{ id: "snapshot-2" }];
    },
  };

  const result = await new PublicService(prisma as never).releasePage(
    "rdps",
    2,
    20,
  );

  assert.deepEqual(
    {
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: result.totalPages,
      versions: result.results.map((release) => release.version),
    },
    {
      page: 2,
      pageSize: 20,
      total: 41,
      totalPages: 3,
      versions: ["2.0.0"],
    },
  );
  const sql = rawQueries
    .map((query) => (query as { sql?: string }).sql)
    .join("\n");
  assert.match(sql, /DISTINCT ON/);
  assert.match(sql, /LIMIT/);
  assert.match(sql, /OFFSET/);
  assert.equal(snapshotQuery?.select?.attachments, undefined);
  assert.equal("id" in result.results[0]!, false);
  assert.deepEqual(result.results[0]?.attachments, []);
  assert.deepEqual(snapshotQuery?.select?.changes, {
    select: { id: true, title: true, category: true, sortOrder: true },
    orderBy: { sortOrder: "asc" },
    take: 3,
  });
});

test("release history clamps pages beyond the result set to the last page", async () => {
  const rawQueries: Array<{ sql?: string; values?: unknown[] }> = [];
  const prisma = {
    publicReleaseSnapshot: {
      findMany: async () => [{ ...snapshot("3.0.0"), id: "snapshot-3" }],
    },
    $queryRaw: async (query: unknown) => {
      const value = query as { sql?: string; values?: unknown[] };
      rawQueries.push(value);
      return value.sql?.includes("COUNT(*)")
        ? [{ total: 41 }]
        : [{ id: "snapshot-3" }];
    },
  };

  const result = await new PublicService(prisma as never).releasePage(
    "rdps",
    900_000,
    20,
  );

  assert.equal(result.page, 3);
  assert.equal(result.totalPages, 3);
  const pageQuery = rawQueries.find(
    (query) => !query.sql?.includes("COUNT(*)"),
  );
  assert.equal(pageQuery?.values?.at(-1), 40);
});

test("custom domains resolve only when verified and backed by a published snapshot", async () => {
  const lookups: unknown[] = [];
  const prisma = {
    projectBrand: {
      findUnique: async (query: unknown) => {
        lookups.push(query);
        return {
          projectId: "project-1",
          settings: { customDomainVerifiedAt: timestamp.toISOString() },
        };
      },
    },
    publicReleaseSnapshot: {
      findFirst: async (query: unknown) => {
        lookups.push(query);
        return { projectSlug: "rdps" };
      },
    },
  };

  const result = await new PublicService(prisma as never).resolveHost(
    "Updates.Example.com.",
  );

  assert.deepEqual(result, { slug: "rdps" });
  assert.deepEqual(lookups[0], {
    where: { customDomain: "updates.example.com" },
    select: { projectId: true, settings: true },
  });
  assert.deepEqual(lookups[1], {
    where: {
      audienceMode: "PUBLIC",
      publication: {
        is: {
          revokedAt: null,
          release: { is: { projectId: "project-1" } },
        },
      },
    },
    select: { projectSlug: true },
  });
});

test("custom domains are not routed before verification", async () => {
  const prisma = {
    projectBrand: {
      findUnique: async () => ({ projectId: "project-1", settings: {} }),
    },
    publicReleaseSnapshot: {
      findFirst: async () => {
        throw new Error("Unverified domain must not query public snapshots");
      },
    },
  };

  await assert.rejects(
    new PublicService(prisma as never).resolveHost("updates.example.com"),
    { message: "Published custom domain not found" },
  );
});

test("custom domains are not routed when they have no active publication", async () => {
  const prisma = {
    projectBrand: {
      findUnique: async () => ({
        projectId: "project-1",
        settings: { customDomainVerifiedAt: timestamp.toISOString() },
      }),
    },
    publicReleaseSnapshot: { findFirst: async () => null },
  };

  await assert.rejects(
    new PublicService(prisma as never).resolveHost("updates.example.com"),
    { message: "Published custom domain not found" },
  );
});

test("public release responses expose snapshot attachment metadata and safe download paths", async () => {
  const prisma = {
    publicReleaseSnapshot: {
      findFirst: async () => ({
        ...snapshot("1.2.3"),
        publicationId: "internal-publication-id",
        contentHash: "private-content-hash",
        audienceMode: "PUBLIC",
        changes: [
          {
            id: "internal-change-id",
            sourceChangeId: "internal-source-change-id",
            title: "Improved reliability",
            category: "IMPROVEMENT",
            description: "Retry handling is clearer.",
            sortOrder: 0,
          },
        ],
        attachments: [
          {
            id: "attachment-1",
            fileName: "guide.pdf",
            contentType: "application/pdf",
            sizeBytes: 25n,
            checksumSha256: "a".repeat(64),
            sourceAttachmentId: "internal-source-attachment-id",
            storageKey: "private/storage/key",
          },
        ],
      }),
    },
  };

  const result = await new PublicService(prisma as never).release(
    "rdps",
    "1.2.3",
  );

  assert.deepEqual(result.attachments, [
    {
      id: "attachment-1",
      fileName: "guide.pdf",
      contentType: "application/pdf",
      sizeBytes: "25",
      checksumSha256: "a".repeat(64),
      downloadUrl:
        "/projects/rdps/releases/1.2.3/attachments/attachment-1/download",
    },
  ]);
  assert.deepEqual(result.changes, [
    {
      title: "Improved reliability",
      category: "IMPROVEMENT",
      description: "Retry handling is clearer.",
      sortOrder: 0,
    },
  ]);
  assert.equal("id" in result, false);
  assert.equal("publicationId" in result, false);
  assert.equal("contentHash" in result, false);
  assert.equal("audienceMode" in result, false);
  assert.equal("sourceAttachmentId" in result.attachments![0]!, false);
});

test("public release selects an immutable requested locale and exposes only public fields", async () => {
  let query: { where?: unknown; select?: Record<string, unknown> } | undefined;
  const prisma = {
    publicReleaseSnapshot: {
      findFirst: async (value: typeof query) => {
        query = value;
        return {
          ...snapshot("1.2.3"),
          title: "Release 1.2.3",
          summary: "Default summary",
          locale: "en",
          defaultLocale: "en",
          locales: [
            {
              locale: "si-LK",
              title: "සිංහල නිකුතුව",
              summary: "සිංහල සාරාංශය",
              changes: [
                {
                  snapshotChangeId: "snapshot-change-1",
                  description: "සිංහල විස්තරය",
                },
              ],
            },
          ],
          changes: [
            {
              id: "snapshot-change-1",
              title: "Improved reliability",
              category: "IMPROVEMENT",
              description: "Default description",
              sortOrder: 0,
            },
          ],
        };
      },
    },
  };

  const result = await new PublicService(prisma as never).release(
    "rdps",
    "1.2.3",
    "si-LK",
  );

  assert.equal(result.locale, "si-LK");
  assert.equal(result.title, "සිංහල නිකුතුව");
  assert.equal(result.summary, "සිංහල සාරාංශය");
  assert.equal(result.changes[0]?.description, "සිංහල විස්තරය");
  assert.equal("id" in result, false);
  assert.equal("locales" in result, false);
  assert.equal("publicationId" in result, false);
  assert.equal("contentHash" in result, false);
  assert.equal("sourceChangeId" in result.changes[0]!, false);
  assert.ok(query?.select?.locales);
});

test("public release falls back to default content when requested locale is unpublished", async () => {
  const prisma = {
    publicReleaseSnapshot: {
      findFirst: async () => ({
        ...snapshot("1.2.3"),
        locale: "en",
        defaultLocale: "en",
        locales: [],
        changes: [
          {
            title: "Improved reliability",
            category: "IMPROVEMENT",
            description: "Default description",
            sortOrder: 0,
          },
        ],
      }),
    },
  };

  const result = await new PublicService(prisma as never).release(
    "rdps",
    "1.2.3",
    "fr-FR",
  );

  assert.equal(result.locale, "en");
  assert.equal(result.title, "Release 1.2.3");
  assert.equal(result.changes[0]?.description, "Default description");
});

test("public release response advertises every published content locale", async () => {
  let query: { select?: Record<string, unknown> } | undefined;
  const service = new PublicService({
    publicReleaseSnapshot: {
      findFirst: async (args: { select?: Record<string, unknown> }) => {
        query = args;
        return {
          ...snapshot("1.2.3"),
          defaultLocale: "en",
          locales: [
            {
              locale: "de-DE",
              title: "Version eins",
              summary: "Zusammenfassung",
              changes: [],
            },
            {
              locale: "fr-CA",
              title: "Version un",
              summary: "Résumé",
              changes: [],
            },
          ],
        };
      },
    },
  } as never);

  const result = await service.release("rdps", "1.2.3", "de-DE");
  assert.equal(result.locale, "de-DE");
  assert.deepEqual(result.availableLocales, ["en", "de-DE", "fr-CA"]);
  assert.equal(result.title, "Version eins");
  assert.ok(
    (query as { select?: Record<string, unknown> } | undefined)?.select
      ?.locales,
  );
});

test("public releases expose the approved release date and RSS uses it", async () => {
  const dated = {
    ...snapshot("1.24.0"),
    publication: {
      revision: { content: { releaseDate: "2026-11-04T10:15:00.000Z" } },
    },
  };
  const undated = {
    ...snapshot("1.23.0"),
    publication: { revision: { content: { releaseDate: "not a date" } } },
  };
  const prisma = {
    publicReleaseSnapshot: {
      findFirst: async ({ where }: { where: { version?: string } }) =>
        where.version === "1.23.0" ? undated : dated,
      findMany: async () => [{ ...dated, id: "rss-release" }],
    },
    $queryRaw: async (query: { sql?: string }) =>
      /COUNT\(DISTINCT/.test(query.sql ?? "")
        ? [{ releaseCount: 1 }]
        : /COUNT\(\*\)/.test(query.sql ?? "")
          ? [{ total: 1 }]
          : [{ id: "rss-release" }],
  };
  const service = new PublicService(prisma as never);

  const release = await service.release("rdps", "1.24.0");
  assert.equal(release.releaseDate, "2026-11-04T10:15:00.000Z");
  assert.equal((await service.release("rdps", "1.23.0")).releaseDate, null);

  const project = await service.project("rdps");
  assert.equal(project.latestReleaseDate, "2026-11-04T10:15:00.000Z");
  assert.equal(project.latestRelease.releaseDate, "2026-11-04T10:15:00.000Z");

  const xml = await service.rss("rdps");
  assert.match(xml, /<pubDate>Wed, 04 Nov 2026 10:15:00 GMT<\/pubDate>/);
});
