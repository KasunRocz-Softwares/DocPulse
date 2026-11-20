import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { ReleaseAudienceMode } from "../generated/prisma/enums";
import { ReleasesService } from "./releases.service";

test("setting client visibility stores project-scoped selected audiences and audits the change", async () => {
  const joinCreates: unknown[] = [];
  const auditEntries: unknown[] = [];
  let releaseLookups = 0;
  const prisma = {
    release: {
      findUnique: async () => {
        releaseLookups += 1;
        return releaseLookups === 1
          ? { id: "release-1", projectId: "project-1", status: "DRAFT" }
          : {
              id: "release-1",
              projectId: "project-1",
              audienceMode: "CLIENTS",
              clientAudiences: [
                {
                  audience: {
                    id: "audience-1",
                    name: "Northwind",
                    slug: "northwind",
                  },
                },
              ],
            };
      },
      update: async () => ({}),
    },
    projectMember: { findUnique: async () => ({ role: "ADMIN" }) },
    clientAudience: { count: async () => 1 },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) =>
      work({
        releaseClientAudience: {
          deleteMany: async () => ({}),
          createMany: async ({ data }: { data: unknown[] }) => {
            joinCreates.push(...data);
            return { count: data.length };
          },
        },
        release: { update: async () => ({}) },
        auditLog: {
          create: async ({ data }: { data: unknown }) => {
            auditEntries.push(data);
            return {};
          },
        },
      }),
  };

  const result = await new ReleasesService(prisma as never).setAudience(
    { id: "admin-1", isSystemAdmin: false },
    "release-1",
    {
      mode: ReleaseAudienceMode.CLIENTS,
      audienceIds: ["audience-1", "audience-1"],
    },
  );

  assert.deepEqual(joinCreates, [
    { releaseId: "release-1", audienceId: "audience-1" },
  ]);
  assert.deepEqual(result, {
    releaseId: "release-1",
    mode: "CLIENTS",
    audiences: [{ id: "audience-1", name: "Northwind", slug: "northwind" }],
  });
  assert.equal(auditEntries.length, 1);
});

test("release localization can be saved only on an editable release and is audited atomically", async () => {
  const saved: unknown[] = [];
  const audits: unknown[] = [];
  const prisma = {
    release: {
      findUnique: async () => ({
        id: "release-1",
        projectId: "project-1",
        status: "DRAFT",
        project: { branding: { defaultLocale: "en" } },
      }),
    },
    projectMember: { findUnique: async () => ({ role: "ADMIN" }) },
    releaseChange: {
      findMany: async () => [{ id: "change-1" }],
    },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) =>
      work({
        releaseTranslation: {
          upsert: async ({ create }: { create: unknown }) => {
            saved.push(create);
            return {
              id: "translation-1",
              locale: "si-LK",
              title: "නිකුතුව",
              summary: "සාරාංශය",
            };
          },
        },
        releaseChangeTranslation: {
          deleteMany: async () => ({}),
          createMany: async ({ data }: { data: unknown[] }) => {
            saved.push(...data);
            return { count: data.length };
          },
        },
        auditLog: {
          create: async ({ data }: { data: unknown }) => {
            audits.push(data);
          },
        },
      }),
  };

  const result = await new ReleasesService(prisma as never).saveTranslation(
    { id: "admin-1", isSystemAdmin: false },
    "release-1",
    "si_lk",
    {
      title: "නිකුතුව",
      summary: "සාරාංශය",
      changes: [{ changeId: "change-1", description: "වෙනස්කම් විස්තරය" }],
    },
  );

  assert.equal(result.locale, "si-LK");
  assert.equal(saved.length, 2);
  assert.equal(audits.length, 1);
});

test("release localization rejects approved or published releases before writing", async () => {
  const prisma = {
    release: {
      findUnique: async () => ({
        id: "release-1",
        projectId: "project-1",
        status: "APPROVED",
        project: { branding: { defaultLocale: "en" } },
      }),
    },
    projectMember: { findUnique: async () => ({ role: "ADMIN" }) },
    $transaction: async () => {
      throw new Error("A locked release must not be modified");
    },
  };

  await assert.rejects(
    new ReleasesService(prisma as never).saveTranslation(
      { id: "admin-1", isSystemAdmin: false },
      "release-1",
      "si-LK",
      { title: "නිකුතුව", changes: [] },
    ),
    { message: /only be edited on draft or rejected/ },
  );
});

test("release comparison export returns CSV and JSON from the authorized internal diff and audits both formats", async () => {
  const audits: Array<Record<string, unknown>> = [];
  const releases = [
    {
      id: "release-1",
      projectId: "project-1",
      version: "1.0.0",
      title: "Previous",
      releaseDate: null,
      changes: [
        {
          title: "Removed item",
          category: "FIX",
          internalDescription: "Internal before",
          publicDescription: null,
          visibility: "INTERNAL",
          sortOrder: 0,
          references: [],
        },
      ],
    },
    {
      id: "release-2",
      projectId: "project-1",
      version: "1.1.0",
      title: "Current",
      releaseDate: null,
      changes: [
        {
          title: "Added item",
          category: "FEATURE",
          internalDescription: "Internal after",
          publicDescription: null,
          visibility: "INTERNAL",
          sortOrder: 0,
          references: [],
        },
      ],
    },
  ];
  const prisma = {
    projectMember: { findUnique: async () => ({ role: "ADMIN" }) },
    release: { findMany: async () => releases },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) =>
      work({
        auditLog: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            audits.push(data);
          },
        },
      }),
  };
  const service = new ReleasesService(prisma as never);
  const actor = { id: "admin-1", isSystemAdmin: false };

  const csv = await service.exportComparison(
    actor,
    "project-1",
    "release-1",
    "release-2",
    "csv",
  );
  const json = await service.exportComparison(
    actor,
    "project-1",
    "release-1",
    "release-2",
    "json",
  );

  assert.equal(
    csv,
    '"From version","To version","Change","Title","Category","Before internal description","After internal description","Before public description","After public description","Visibility","References"\r\n"1.0.0","1.1.0","Added","Added item","FEATURE","","Internal after","","","INTERNAL","[]"\r\n"1.0.0","1.1.0","Removed","Removed item","FIX","Internal before","","","","INTERNAL","[]"',
  );
  assert.deepEqual(JSON.parse(json), {
    from: {
      id: "release-1",
      version: "1.0.0",
      title: "Previous",
      releaseDate: null,
    },
    to: {
      id: "release-2",
      version: "1.1.0",
      title: "Current",
      releaseDate: null,
    },
    changes: {
      added: [releases[1]!.changes[0]],
      removed: [releases[0]!.changes[0]],
      updated: [],
    },
  });
  assert.deepEqual(
    audits.map((entry) => entry.metadata),
    [
      {
        format: "csv",
        rowCount: 2,
        fromReleaseId: "release-1",
        toReleaseId: "release-2",
      },
      {
        format: "json",
        rowCount: 2,
        fromReleaseId: "release-1",
        toReleaseId: "release-2",
      },
    ],
  );
});

test("release comparison export rejects members without internal comparison permission", async () => {
  const prisma = {
    projectMember: { findUnique: async () => ({ role: "CLIENT" }) },
  };
  const service = new ReleasesService(prisma as never);

  await assert.rejects(
    service.exportComparison(
      { id: "client-1", isSystemAdmin: false },
      "project-1",
      "release-1",
      "release-2",
      "json",
    ),
    /Your project role does not allow this action/,
  );
});

function searchPrisma(options: {
  memberships?: Array<string | { projectId: string; role: string }>;
  releases?: unknown[];
  releaseCount?: number;
  documentHits?: unknown[];
  documentCount?: number;
}) {
  const rawQueries: Array<{ sql: string; values: unknown[] }> = [];
  let membershipQuery: unknown;
  let releaseSearchCalls = 0;
  return {
    rawQueries,
    get membershipQuery() {
      return membershipQuery;
    },
    get releaseSearchCalls() {
      return releaseSearchCalls;
    },
    prisma: {
      projectMember: {
        findMany: async (args: unknown) => {
          membershipQuery = args;
          const where = args as { where?: { role?: { not?: string } } };
          return (options.memberships ?? ["project-1"])
            .map((membership) =>
              typeof membership === "string"
                ? { projectId: membership, role: "ADMIN" }
                : membership,
            )
            .filter(
              (membership) =>
                !where.where?.role?.not ||
                membership.role !== where.where.role.not,
            )
            .map(({ projectId }) => ({ projectId }));
        },
      },
      release: {
        findMany: async () => {
          releaseSearchCalls += 1;
          return options.releases ?? [];
        },
        count: async () => options.releaseCount ?? 0,
      },
      $queryRaw: async (query: TemplateStringsArray, ...values: unknown[]) => {
        const sql = query.join("?");
        rawQueries.push({ sql, values });
        return sql.includes("count(*)")
          ? [{ total: options.documentCount ?? 0 }]
          : (options.documentHits ?? []);
      },
    },
  };
}

test("internal search returns document content hits as bounded navigable results", async () => {
  const hit = {
    id: "doc-1",
    title: "Cache invalidation",
    section: "Operations",
    snippet: "…invalidate the release cache…",
    projectId: "project-1",
    projectName: "Alpha",
    projectSlug: "alpha",
    releaseId: "release-1",
    version: "v2.1.0",
    releaseTitle: "Spring release",
    updatedAt: new Date("2026-11-10T12:00:00Z"),
  };
  const { prisma, rawQueries } = searchPrisma({
    documentHits: [hit],
    documentCount: 1,
  });

  const result = await new ReleasesService(prisma as never).search(
    { id: "user-1", isSystemAdmin: false },
    "cache invalidation",
    1,
    8,
  );

  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0], { ...hit, type: "document" });
  assert.equal(result.pageSize, 8);
  assert.equal(result.pageCount, 1);
  assert.ok(rawQueries.some(({ sql }) => sql.includes('"searchVector"')));
  const scopedQuery = rawQueries.find(({ sql }) =>
    sql.includes('"searchVector"'),
  );
  assert.ok(scopedQuery?.sql.includes('"ProjectMember"'));
  assert.ok(scopedQuery?.values.includes("user-1"));
});

test("search pagination covers both document and legacy result streams", async () => {
  const { prisma } = searchPrisma({
    releaseCount: 20,
    documentCount: 1,
    documentHits: [{ id: "doc-1", title: "Only document hit" }],
  });

  const result = await new ReleasesService(prisma as never).search(
    { id: "user-1", isSystemAdmin: false },
    "searchable",
    1,
    8,
  );

  assert.equal(result.total, 21);
  assert.equal(result.pageCount, 5);
  assert.ok(result.items.length <= result.pageSize);
});

test("document title and section are included in the indexed search vector", async () => {
  const { prisma, rawQueries } = searchPrisma({
    documentHits: [],
    documentCount: 0,
  });

  await new ReleasesService(prisma as never).search(
    { id: "user-1", isSystemAdmin: false },
    "operations handbook",
  );

  const projectionSearch = rawQueries.find(({ sql }) =>
    sql.includes('"searchVector"'),
  );
  assert.ok(projectionSearch);
  assert.equal(projectionSearch.values[0], "operations handbook");
  assert.equal(projectionSearch.values[1], false);
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "../../database/prisma/migrations/20261111210000_internal_release_document_search/migration.sql",
    ),
    "utf8",
  );
  assert.match(
    migration,
    /setweight\(to_tsvector\('simple', NEW\."title"\), 'A'\)/,
  );
  assert.match(
    migration,
    /setweight\(to_tsvector\('simple', NEW\."section"\), 'B'\)/,
  );
  assert.match(
    migration,
    /setweight\(to_tsvector\('simple', extracted_content\), 'C'\)/,
  );

  const titleSearch = searchPrisma({
    documentHits: [{ id: "title-doc", title: "Incident response" }],
    documentCount: 1,
  });
  const sectionSearch = searchPrisma({
    documentHits: [
      { id: "section-doc", title: "Runbook", section: "Incident response" },
    ],
    documentCount: 1,
  });
  assert.equal(
    (
      await new ReleasesService(titleSearch.prisma as never).search(
        { id: "user-1", isSystemAdmin: false },
        "incident response",
      )
    ).items[0]?.id,
    "title-doc",
  );
  assert.equal(
    (
      await new ReleasesService(sectionSearch.prisma as never).search(
        { id: "user-1", isSystemAdmin: false },
        "incident response",
      )
    ).items[0]?.id,
    "section-doc",
  );
});

test("document search is isolated to project memberships", async () => {
  const { prisma, rawQueries } = searchPrisma({
    memberships: ["project-allowed"],
    documentHits: [],
  });

  await new ReleasesService(prisma as never).search(
    { id: "user-1", isSystemAdmin: false },
    "secret phrase",
  );

  const searchQuery = rawQueries.find(({ sql }) =>
    sql.includes('"searchVector"'),
  );
  assert.ok(searchQuery);
  assert.match(searchQuery.sql, /EXISTS\s*\(/);
  assert.match(searchQuery.sql, /"ProjectMember"/);
  assert.match(
    searchQuery.sql,
    /JOIN\s+"Release"\s+r\s+ON\s+r\.id\s*=\s*d\."releaseId"/,
  );
  assert.match(searchQuery.sql, /pm\."projectId"\s*=\s*r\."projectId"/);
  assert.match(searchQuery.sql, /pm\."role" <> 'CLIENT'/);
  assert.ok(searchQuery.values.includes("user-1"));
  assert.equal(searchQuery.values[1], false);
});

test("release project reassignment invalidates the document search scope", () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "../../database/prisma/migrations/20261112130000_release_document_project_scope_invalidation/migration.sql",
    ),
    "utf8",
  );

  assert.match(
    migration,
    /CREATE TRIGGER "Release_search_document_project_sync"[\s\S]*AFTER UPDATE OF "projectId" ON "Release"/,
  );
  assert.match(
    migration,
    /UPDATE "ReleaseDocumentSearch"[\s\S]*"projectId"\s*=\s*NEW\."projectId"[\s\S]*"releaseId"\s*=\s*NEW\."id"/,
  );
});

test("CLIENT members cannot search internal release or document content", async () => {
  const fixture = searchPrisma({
    memberships: [{ projectId: "project-client", role: "CLIENT" }],
    releases: [{ id: "release-internal" }],
    documentHits: [{ id: "document-internal" }],
  });

  const result = await new ReleasesService(fixture.prisma as never).search(
    { id: "client-user", isSystemAdmin: false },
    "internal",
  );

  assert.deepEqual(result, {
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
    pageCount: 1,
  });
  assert.deepEqual(fixture.membershipQuery, {
    where: { userId: "client-user", role: { not: "CLIENT" } },
    select: { projectId: true },
  });
  assert.equal(fixture.releaseSearchCalls, 0);
  assert.equal(fixture.rawQueries.length, 0);
});

test("document search reads the current projection after updates and deletes", async () => {
  let currentHits: unknown[] = [
    { id: "doc-1", title: "Old title", section: "Old section" },
  ];
  const { prisma } = searchPrisma({
    documentHits: [],
    documentCount: 0,
  });
  prisma.$queryRaw = async (query: TemplateStringsArray) =>
    query.join("?").includes("count(*)")
      ? [{ total: currentHits.length }]
      : currentHits;
  const service = new ReleasesService(prisma as never);
  const actor = { id: "user-1", isSystemAdmin: false };

  assert.equal(
    (await service.search(actor, "title")).items[0]?.title,
    "Old title",
  );
  currentHits = [
    { id: "doc-1", title: "Updated title", section: "New section" },
  ];
  assert.equal(
    (await service.search(actor, "title")).items[0]?.title,
    "Updated title",
  );
  currentHits = [];
  assert.equal((await service.search(actor, "title")).items.length, 0);

  const migration = readFileSync(
    resolve(
      process.cwd(),
      "../../database/prisma/migrations/20261111210000_internal_release_document_search/migration.sql",
    ),
    "utf8",
  );
  assert.match(
    migration,
    /AFTER INSERT OR UPDATE OR DELETE ON "ReleaseDocument"/,
  );
  assert.match(migration, /ON CONFLICT \("documentId"\) DO UPDATE SET/);
  assert.match(
    migration,
    /DELETE FROM "ReleaseDocumentSearch" WHERE "documentId" = OLD\."id"/,
  );
});
