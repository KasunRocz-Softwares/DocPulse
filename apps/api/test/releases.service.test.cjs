const assert = require("node:assert/strict");
const { test } = require("node:test");
const { UnprocessableEntityException } = require("@nestjs/common");
const { ReleasesService } = require("../src/releases/releases.service");

test("release metadata updates are trimmed, project-scoped and audited", async () => {
  let updateData;
  let auditData;
  const prisma = {
    release: {
      findUnique: async () => ({
        id: "release-1",
        projectId: "project-1",
        status: "DRAFT",
      }),
    },
    projectMember: {
      findUnique: async () => ({ role: "DEVELOPER" }),
    },
    $transaction: async (work) =>
      work({
        release: {
          update: async ({ data }) => {
            updateData = data;
            return { id: "release-1", ...data };
          },
        },
        auditLog: {
          create: async ({ data }) => {
            auditData = data;
          },
        },
      }),
  };

  await new ReleasesService(prisma).update(
    { id: "developer-1", isSystemAdmin: false },
    "release-1",
    { title: "  Spring release  ", internalSummary: "  Internal summary  " },
  );

  assert.equal(updateData.title, "Spring release");
  assert.equal(updateData.internalSummary, "Internal summary");
  assert.equal(auditData.action, "release.updated");
  assert.equal(auditData.projectId, "project-1");
});

test("a release cannot be edited after it enters review", async () => {
  let wrote = false;
  const prisma = {
    release: {
      findUnique: async () => ({
        id: "release-1",
        projectId: "project-1",
        status: "REVIEW",
      }),
    },
    projectMember: {
      findUnique: async () => ({ role: "DEVELOPER" }),
    },
    $transaction: async (work) =>
      work({
        release: {
          update: async () => {
            wrote = true;
          },
        },
        auditLog: { create: async () => undefined },
      }),
  };

  await assert.rejects(
    new ReleasesService(prisma).update(
      { id: "developer-1", isSystemAdmin: false },
      "release-1",
      { title: "Changed after review" },
    ),
    (error) => error instanceof UnprocessableEntityException,
  );
  assert.equal(wrote, false);
});

test("bulk change updates reject IDs outside the release before writing", async () => {
  let updateCalled = false;
  const prisma = {
    release: {
      findUnique: async () => ({
        id: "release-1",
        projectId: "project-1",
        status: "DRAFT",
      }),
    },
    projectMember: {
      findUnique: async () => ({ role: "DEVELOPER" }),
    },
    releaseChange: {
      findMany: async () => [{ id: "change-1" }],
    },
    $transaction: async (work) =>
      work({
        releaseChange: {
          update: async () => {
            updateCalled = true;
          },
        },
        auditLog: { create: async () => undefined },
      }),
  };

  await assert.rejects(
    new ReleasesService(prisma).bulkUpdateChanges(
      { id: "developer-1", isSystemAdmin: false },
      "release-1",
      [
        { id: "change-1", sortOrder: 0 },
        { id: "foreign-change", sortOrder: 1 },
      ],
    ),
  );
  assert.equal(updateCalled, false);
});

test("bulk change updates apply category edits with visibility and ordering", async () => {
  let updateData;
  const prisma = {
    release: {
      findUnique: async () => ({
        id: "release-1",
        projectId: "project-1",
        status: "DRAFT",
      }),
    },
    projectMember: {
      findUnique: async () => ({ role: "DEVELOPER" }),
    },
    releaseChange: {
      findMany: async () => [{ id: "change-1" }],
    },
    $transaction: async (work) =>
      work({
        releaseChange: {
          update: async ({ data }) => {
            updateData = data;
          },
          findMany: async () => [{ id: "change-1" }],
        },
        auditLog: { create: async () => undefined },
      }),
  };

  await new ReleasesService(prisma).bulkUpdateChanges(
    { id: "developer-1", isSystemAdmin: false },
    "release-1",
    [
      {
        id: "change-1",
        sortOrder: 0,
        visibility: "PUBLIC",
        category: "SECURITY",
      },
    ],
  );

  assert.deepEqual(updateData, {
    sortOrder: 0,
    visibility: "PUBLIC",
    category: "SECURITY",
  });
});

test("archiving a published release preserves its record and public snapshot references", async () => {
  let releaseUpdate;
  let audit;
  const prisma = {
    release: {
      findUnique: async () => ({
        id: "release-1",
        projectId: "project-1",
        status: "PUBLISHED",
      }),
    },
    projectMember: {
      findUnique: async () => ({ role: "ADMIN" }),
    },
    $transaction: async (work) =>
      work({
        release: {
          update: async ({ data }) => {
            releaseUpdate = data;
            return { id: "release-1", ...data };
          },
        },
        auditLog: { create: async ({ data }) => (audit = data) },
      }),
  };

  const archived = await new ReleasesService(prisma).archive(
    { id: "admin-1", isSystemAdmin: false },
    "release-1",
  );

  assert.equal(releaseUpdate.status, "ARCHIVED");
  assert.equal(archived.id, "release-1");
  assert.equal(audit.action, "release.archived");
});

test("internal search scopes results to project memberships and bounds pagination", async () => {
  let membershipQuery;
  let releaseQuery;
  let documentQuery = 0;
  const rows = [{ id: "release-1", projectId: "project-a" }];
  const prisma = {
    projectMember: {
      findMany: async (query) => {
        membershipQuery = query;
        return [{ projectId: "project-a" }];
      },
    },
    release: {
      findMany: async (query) => {
        releaseQuery = query;
        return rows;
      },
      count: async () => rows.length,
    },
    $queryRaw: async () => (documentQuery++ === 0 ? [{ total: 0 }] : []),
  };

  const result = await new ReleasesService(prisma).search(
    { id: "member-1", isSystemAdmin: false },
    "  platform  ",
    3,
    500,
  );

  assert.deepEqual(result.items, [{ ...rows[0], type: "release" }]);
  assert.equal(result.total, 1);
  assert.equal(result.pageSize, 100);
  assert.deepEqual(membershipQuery.where, {
    userId: "member-1",
    role: { not: "CLIENT" },
  });
  assert.deepEqual(releaseQuery.where.projectId.in, ["project-a"]);
  assert.equal(releaseQuery.where.OR[0].title.contains, "platform");
  assert.equal(releaseQuery.take, 50);
  assert.equal(releaseQuery.skip, 100);
});

test("internal search for a user with no projects returns without querying releases", async () => {
  let releaseQueried = false;
  const result = await new ReleasesService({
    projectMember: { findMany: async () => [] },
    release: {
      findMany: async () => {
        releaseQueried = true;
        return [];
      },
    },
  }).search({ id: "outsider", isSystemAdmin: false }, "release");

  assert.deepEqual(result, {
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
    pageCount: 1,
  });
  assert.equal(releaseQueried, false);
});

test("internal CSV export is project-authorized, formula-safe, and audited", async () => {
  let audit;
  let changeQuery;
  const csv = await new ReleasesService({
    release: {
      findUnique: async () => ({
        id: "release-1",
        projectId: "project-1",
        version: "1.0.0",
      }),
    },
    projectMember: { findUnique: async () => ({ role: "REVIEWER" }) },
    releaseChange: {
      findMany: async (query) => {
        changeQuery = query;
        return [
          {
            title: '=HYPERLINK("https://bad")',
            category: "FIX",
            visibility: "INTERNAL_ONLY",
            internalDescription: 'Private "detail"',
            publicDescription: null,
            sortOrder: 0,
          },
        ];
      },
    },
    $transaction: async (work) =>
      work({
        auditLog: {
          create: async ({ data }) => {
            audit = data;
          },
        },
      }),
  }).exportCsv({ id: "reviewer-1", isSystemAdmin: false }, "release-1");

  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /"Private ""detail"""/);
  assert.deepEqual(changeQuery.orderBy, { sortOrder: "asc" });
  assert.equal(audit.action, "release.exported");
  assert.equal(audit.metadata.format, "csv");
});
