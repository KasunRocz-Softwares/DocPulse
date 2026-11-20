import * as assert from "node:assert/strict";
import { test } from "node:test";
import { NotFoundException } from "@nestjs/common";
import { ClientVisibilityService } from "./client-visibility.service";

test("client release list is scoped to the active member audience and published client snapshots", async () => {
  const queries: unknown[] = [];
  const prisma = {
    projectMember: {
      findFirst: async (query: unknown) => {
        queries.push(query);
        return {
          clientAudience: { id: "audience-1", name: "Northwind" },
        };
      },
    },
    $queryRaw: async (query: unknown) => {
      queries.push(query);
      return query &&
        typeof query === "object" &&
        "sql" in query &&
        String(query.sql).includes("COUNT(*)")
        ? [{ total: 0 }]
        : [];
    },
    publicReleaseSnapshot: {
      findMany: async (query: unknown) => {
        queries.push(query);
        return [];
      },
    },
  };

  const result = await new ClientVisibilityService(
    prisma as never,
    { get: async () => Buffer.alloc(0) } as never,
  ).clientReleases(
    { id: "client-user", isSystemAdmin: false },
    "northwind-app",
  );

  assert.deepEqual(result, {
    audience: { id: "audience-1", name: "Northwind" },
    releases: [],
    pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
  });
  assert.deepEqual(queries[0], {
    where: {
      role: "CLIENT",
      userId: "client-user",
      clientAudience: { isNot: null },
      project: { slug: "northwind-app", status: "ACTIVE" },
      user: { status: "ACTIVE" },
    },
    select: {
      clientAudience: { select: { id: true, name: true } },
      projectId: true,
    },
  });
  assert.equal(queries.length, 3);
  const audienceQuery = queries[1] as { sql: string; values: unknown[] };
  assert.match(audienceQuery.sql, /"PublicSnapshotClientAudience"/);
  assert.match(audienceQuery.sql, /"revokedAt" IS NULL/);
  assert.ok(audienceQuery.values.includes("northwind-app"));
  assert.ok(audienceQuery.values.includes("audience-1"));
  assert.deepEqual(queries[2], {
    where: {
      id: { in: [] },
      audienceMode: "CLIENTS",
      projectSlug: "northwind-app",
      publication: { revokedAt: null },
      clientAudiences: { some: { audienceId: "audience-1" } },
    },
    select: expectSnapshotSelect(),
  });
});

test("client release history pages unique published versions in the active audience", async () => {
  const rawQueries: Array<{ sql: string; values: unknown[] }> = [];
  const hydrationQueries: unknown[] = [];
  const prisma = {
    projectMember: {
      findFirst: async () => ({
        clientAudience: { id: "audience-1", name: "Northwind" },
      }),
    },
    $queryRaw: async (query: { sql: string; values: unknown[] }) => {
      rawQueries.push(query);
      return query.sql.includes("COUNT(*)")
        ? [{ total: 25 }]
        : [{ id: "snapshot-11" }, { id: "snapshot-12" }];
    },
    publicReleaseSnapshot: {
      findMany: async (query: unknown) => {
        hydrationQueries.push(query);
        return [
          {
            id: "snapshot-11",
            projectSlug: "northwind-app",
            projectName: "Northwind App",
            version: "2.0.0",
            title: "Two",
            summary: null,
            primaryColor: "#111111",
            accentColor: "#222222",
            logoUrl: null,
            locale: "en",
            defaultLocale: "en",
            publishedAt: new Date("2026-11-10T00:00:00.000Z"),
            changes: [],
            attachments: [],
          },
          {
            id: "snapshot-12",
            projectSlug: "northwind-app",
            projectName: "Northwind App",
            version: "1.9.0",
            title: "One point nine",
            summary: null,
            primaryColor: "#111111",
            accentColor: "#222222",
            logoUrl: null,
            locale: "en",
            defaultLocale: "en",
            publishedAt: new Date("2026-11-09T00:00:00.000Z"),
            changes: [],
            attachments: [],
          },
        ];
      },
    },
  };

  const result = await new ClientVisibilityService(
    prisma as never,
    { get: async () => Buffer.alloc(0) } as never,
  ).clientReleases(
    { id: "client-user", isSystemAdmin: false },
    "northwind-app",
    2,
    10,
  );

  assert.deepEqual(result.pagination, {
    page: 2,
    pageSize: 10,
    total: 25,
    totalPages: 3,
  });
  assert.deepEqual(
    result.releases.map((release) => release.version),
    ["2.0.0", "1.9.0"],
  );
  assert.equal(rawQueries.length, 2);
  for (const query of rawQueries) {
    assert.match(query.sql, /DISTINCT ON \(s\."version"\)/);
    assert.match(query.sql, /"PublicSnapshotClientAudience"/);
    assert.match(query.sql, /"revokedAt" IS NULL/);
    assert.ok(query.values.includes("northwind-app"));
    assert.ok(query.values.includes("audience-1"));
  }
  assert.match(rawQueries[1]!.sql, /LIMIT/);
  assert.deepEqual(rawQueries[1]!.values.slice(-2), [10, 10]);
  assert.deepEqual(hydrationQueries, [
    {
      where: {
        id: { in: ["snapshot-11", "snapshot-12"] },
        audienceMode: "CLIENTS",
        projectSlug: "northwind-app",
        publication: { revokedAt: null },
        clientAudiences: { some: { audienceId: "audience-1" } },
      },
      select: expectSnapshotSelect(),
    },
  ]);
});

test("client release pagination normalizes the page and caps the page size", async () => {
  let snapshotsQuery: unknown;
  const prisma = {
    projectMember: {
      findFirst: async () => ({
        clientAudience: { id: "audience-1", name: "Northwind" },
      }),
    },
    $queryRaw: async () => [{ total: 0 }],
    publicReleaseSnapshot: {
      findMany: async (query: unknown) => {
        snapshotsQuery = query;
        return [];
      },
    },
  };

  const result = await new ClientVisibilityService(
    prisma as never,
    { get: async () => Buffer.alloc(0) } as never,
  ).clientReleases(
    { id: "client-user", isSystemAdmin: false },
    "northwind-app",
    0,
    1000,
  );

  assert.deepEqual(result.pagination, {
    page: 1,
    pageSize: 100,
    total: 0,
    totalPages: 0,
  });
  assert.deepEqual(snapshotsQuery, {
    where: {
      id: { in: [] },
      audienceMode: "CLIENTS",
      projectSlug: "northwind-app",
      publication: { revokedAt: null },
      clientAudiences: { some: { audienceId: "audience-1" } },
    },
    select: expectSnapshotSelect(),
  });
});

test("client without an assigned audience cannot enumerate or probe client releases", async () => {
  let snapshotsQueried = false;
  const prisma = {
    projectMember: { findFirst: async () => null },
    publicReleaseSnapshot: {
      findMany: async () => {
        snapshotsQueried = true;
        return [];
      },
    },
  };
  const service = new ClientVisibilityService(
    prisma as never,
    { get: async () => Buffer.alloc(0) } as never,
  );

  await assert.rejects(
    service.clientReleases(
      { id: "unassigned-client", isSystemAdmin: false },
      "northwind-app",
    ),
    (error: unknown) => error instanceof NotFoundException,
  );
  assert.equal(snapshotsQueried, false);
});

test("only a project CLIENT member can be assigned to a project audience", async () => {
  let updatedData: unknown;
  const prisma = {
    projectMember: {
      findUnique: async () => ({ role: "ADMIN" }),
      findFirst: async () => ({
        id: "member-1",
        role: "CLIENT",
        clientAudienceId: null,
      }),
    },
    clientAudience: { findFirst: async () => ({ id: "audience-1" }) },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) =>
      work({
        projectMember: {
          update: async ({ data }: { data: unknown }) => {
            updatedData = data;
            return { id: "member-1", clientAudienceId: "audience-1" };
          },
        },
        auditLog: { create: async () => ({}) },
      }),
  };
  const service = new ClientVisibilityService(
    prisma as never,
    { get: async () => Buffer.alloc(0) } as never,
  );

  await service.assignMember(
    { id: "project-admin", isSystemAdmin: false },
    "project-1",
    "member-1",
    "audience-1",
  );

  assert.deepEqual(updatedData, { clientAudienceId: "audience-1" });
});

test("client attachment lookup is bound to the member audience and active publication", async () => {
  let attachmentQuery: unknown;
  let storageRead = false;
  const prisma = {
    projectMember: {
      findFirst: async () => ({
        clientAudience: { id: "audience-1", name: "Northwind" },
        projectId: "project-1",
      }),
    },
    publicSnapshotAttachment: {
      findFirst: async (query: unknown) => {
        attachmentQuery = query;
        return null;
      },
    },
  };
  const service = new ClientVisibilityService(
    prisma as never,
    {
      get: async () => {
        storageRead = true;
        return Buffer.alloc(0);
      },
    } as never,
  );

  await assert.rejects(
    service.downloadClientAttachment(
      { id: "client-user", isSystemAdmin: false },
      "northwind-app",
      "v1.0.0",
      "attachment-1",
    ),
    (error: unknown) => error instanceof NotFoundException,
  );
  assert.deepEqual(attachmentQuery, {
    where: {
      id: "attachment-1",
      snapshot: {
        projectSlug: "northwind-app",
        version: "v1.0.0",
        audienceMode: "CLIENTS",
        publication: { revokedAt: null },
        clientAudiences: { some: { audienceId: "audience-1" } },
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
  assert.equal(storageRead, false);
});

function expectSnapshotSelect() {
  return {
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
  };
}
