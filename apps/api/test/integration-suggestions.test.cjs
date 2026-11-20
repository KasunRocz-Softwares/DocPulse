const assert = require("node:assert/strict");
const test = require("node:test");
const {
  IntegrationSuggestionsService,
} = require("../src/integrations/integration-suggestions.service.ts");

const actor = {
  id: "11111111-1111-4111-8111-111111111111",
  isSystemAdmin: false,
};
const projectId = "22222222-2222-4222-8222-222222222222";
const suggestionId = "33333333-3333-4333-8333-333333333333";
const releaseId = "44444444-4444-4444-8444-444444444444";

function harness(role = "DEVELOPER", overrides = {}) {
  const calls = {
    suggestionUpdates: [],
    references: [],
    audits: [],
    list: null,
  };
  const tx = {
    projectMember: { findUnique: async () => ({ role }) },
    integrationSuggestion: {
      findMany: async (query) => {
        calls.list = query;
        return [];
      },
      findFirst: async () => ({
        id: suggestionId,
        projectId,
        repository: "acme/rdps",
        referenceKind: "pull_request",
        externalId: "42",
        revision: "a".repeat(40),
        action: "opened",
        status: "PENDING",
      }),
      updateMany: async (query) => {
        calls.suggestionUpdates.push(query);
        return { count: 1 };
      },
    },
    release: { findFirst: async () => ({ id: releaseId, projectId }) },
    gitReference: {
      create: async (query) => {
        calls.references.push(query);
        return query.data;
      },
    },
    auditLog: {
      create: async (query) => {
        calls.audits.push(query);
      },
    },
    ...overrides,
  };
  const prisma = {
    ...tx,
    $transaction: async (callback) => callback(tx),
  };
  return { service: new IntegrationSuggestionsService(prisma), calls };
}

test("lists pending suggestions only for an authorized project with a bounded page size", async () => {
  const { service, calls } = harness("REVIEWER");
  await service.list(actor, projectId, 999);
  assert.deepEqual(calls.list, {
    where: { projectId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    take: 250,
  });
});

test("accept creates a validated Git reference and audits the CAS in one transaction", async () => {
  const { service, calls } = harness("DEVELOPER");
  const result = await service.accept(
    actor,
    projectId,
    suggestionId,
    releaseId,
  );
  assert.equal(result.accepted, true);
  assert.equal(calls.suggestionUpdates.length, 1);
  assert.deepEqual(calls.suggestionUpdates[0].where, {
    id: suggestionId,
    projectId,
    status: "PENDING",
  });
  assert.deepEqual(calls.references[0].data, {
    releaseId,
    repository: "acme/rdps",
    kind: "pull_request",
    externalId: "42",
    url: "https://github.com/acme/rdps/pull/42",
    title: null,
  });
  assert.equal(calls.audits[0].data.action, "integration.suggestion.accepted");
  assert.deepEqual(calls.audits[0].data.metadata, {
    releaseId,
    referenceKind: "pull_request",
    externalId: "42",
  });
});

test("accept rejects a release from another project without changing the suggestion", async () => {
  const { service, calls } = harness("RELEASE_MANAGER", {
    release: { findFirst: async () => null },
  });
  await assert.rejects(
    service.accept(actor, projectId, suggestionId, releaseId),
    /Release not found/,
  );
  assert.equal(calls.suggestionUpdates.length, 0);
});

test("dismiss is restricted to Admin and Release Manager and uses a pending status CAS", async () => {
  const { service, calls } = harness("DEVELOPER");
  await assert.rejects(
    service.dismiss(actor, projectId, suggestionId),
    /does not allow/,
  );
  assert.equal(calls.suggestionUpdates.length, 0);
  const admin = harness("ADMIN");
  assert.deepEqual(
    await admin.service.dismiss(actor, projectId, suggestionId),
    { dismissed: true },
  );
  assert.deepEqual(admin.calls.suggestionUpdates[0].where, {
    id: suggestionId,
    projectId,
    status: "PENDING",
  });
  assert.equal(
    admin.calls.audits[0].data.action,
    "integration.suggestion.dismissed",
  );
});

test("returns not found for suggestions outside the requested project and for lost CAS races", async () => {
  const wrongProject = harness("ADMIN", {
    integrationSuggestion: {
      findMany: async () => [],
      findFirst: async () => null,
      updateMany: async () => ({ count: 0 }),
    },
  });
  await assert.rejects(
    wrongProject.service.dismiss(actor, projectId, suggestionId),
    /Integration suggestion not found/,
  );
  const lostRace = harness("ADMIN", {
    integrationSuggestion: {
      findMany: async () => [],
      findFirst: async () => ({
        id: suggestionId,
        projectId,
        repository: "acme/rdps",
        referenceKind: "pull_request",
        externalId: "42",
        status: "PENDING",
      }),
      updateMany: async () => ({ count: 0 }),
    },
  });
  await assert.rejects(
    lostRace.service.dismiss(actor, projectId, suggestionId),
    /no longer pending/,
  );
});

test("validates the GitHub repository and reference before performing a status transition", async () => {
  const malformed = harness("DEVELOPER", {
    integrationSuggestion: {
      findMany: async () => [],
      findFirst: async () => ({
        id: suggestionId,
        projectId,
        repository: "acme/rdps/extra",
        referenceKind: "pull_request",
        externalId: "42",
        revision: null,
        status: "PENDING",
      }),
      updateMany: async () =>
        assert.fail("invalid references must not change status"),
    },
  });
  await assert.rejects(
    malformed.service.accept(actor, projectId, suggestionId, releaseId),
    /repository is invalid/,
  );
  assert.equal(malformed.calls.references.length, 0);
  assert.equal(malformed.calls.audits.length, 0);
});

test("does not expose another project's suggestions and rejects unsupported accept roles", async () => {
  const reviewer = harness("REVIEWER");
  await assert.rejects(
    reviewer.service.accept(actor, projectId, suggestionId, releaseId),
    /does not allow/,
  );
  assert.equal(reviewer.calls.suggestionUpdates.length, 0);
  const outsider = harness(undefined, {
    projectMember: { findUnique: async () => null },
  });
  await assert.rejects(
    outsider.service.list(actor, projectId),
    /Project not found/,
  );
});
