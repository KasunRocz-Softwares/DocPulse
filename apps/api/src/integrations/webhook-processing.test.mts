import assert from "node:assert/strict";
import test from "node:test";
import { WebhookProcessingService } from "./webhook-processing.service.js";

const eventId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const releaseId = "33333333-3333-4333-8333-333333333333";
const environmentId = "44444444-4444-4444-8444-444444444444";

test("persists a deployment only when release and environment belong to the signed project", async () => {
  const effects: Record<string, unknown[]> = {
    deployments: [],
    eventUpdates: [],
    audits: [],
  };
  const tx = {
    webhookEvent: {
      findUnique: async () => ({ id: eventId, status: "RECEIVED" }),
      updateMany: async () => ({ count: 1 }),
      update: async (input: unknown) => {
        effects.eventUpdates.push(input);
      },
    },
    release: { findUnique: async () => ({ projectId }) },
    projectEnvironment: {
      findUnique: async () => ({ projectId, enabled: true }),
    },
    releaseDeployment: {
      findFirst: async () => null,
      create: async (input: unknown) => {
        effects.deployments.push(input);
      },
      update: async () => assert.fail("should create first deployment record"),
    },
    auditLog: {
      create: async (input: unknown) => {
        effects.audits.push(input);
      },
    },
  };
  const db: {
    $transaction?: (operation: (transaction: any) => unknown) => unknown;
  } = {};
  db.$transaction = async (operation) => operation(tx);
  const service = new WebhookProcessingService(db as never);
  const result = await service.process(eventId, {
    kind: "deployment",
    eventId,
    provider: "jenkins",
    deploymentId: "build-7",
    projectId,
    releaseId,
    environmentId,
    status: "succeeded",
    occurredAt: "2026-11-10T00:00:00.000Z",
  });
  assert.deepEqual(result, { processed: true, outcome: "deployment_recorded" });
  assert.equal(effects.deployments.length, 1);
  assert.equal(effects.eventUpdates.length, 1);
  assert.equal(effects.audits.length, 1);
});

test("records unmatched GitHub refs as terminal diagnostics instead of retrying forever", async () => {
  const updates: unknown[] = [];
  const suggestions: unknown[] = [];
  const tx = {
    webhookEvent: {
      findUnique: async () => ({ id: eventId, status: "RECEIVED" }),
      updateMany: async () => ({ count: 1 }),
      update: async (input: unknown) => {
        updates.push(input);
      },
    },
    projectRepository: { findFirst: async () => null },
    integrationSuggestion: {
      upsert: async (input: unknown) => {
        suggestions.push(input);
      },
    },
    auditLog: { create: async () => undefined },
  };
  const db: {
    $transaction?: (operation: (transaction: any) => unknown) => unknown;
  } = {};
  db.$transaction = async (operation) => operation(tx);
  const service = new WebhookProcessingService(db as never);
  const result = await service.process(eventId, {
    kind: "github",
    eventId,
    eventType: "pull_request",
    repository: "acme/rdps",
    action: "opened",
    reference: {
      kind: "pull_request",
      externalId: "27",
      revision: "a".repeat(40),
    },
  });
  assert.deepEqual(result, {
    processed: true,
    outcome: "repository_not_connected",
  });
  assert.equal(updates.length, 1);
  assert.equal((updates[0] as any).data.status, "UNMATCHED");
  assert.ok((updates[0] as any).data.processedAt instanceof Date);
  assert.equal((suggestions[0] as any).create.projectId, null);
  assert.equal((suggestions[0] as any).create.status, "UNASSIGNED");
});

test("lists only pending suggestions for the requested project with a bounded page size", async () => {
  let query: unknown;
  const db = {
    integrationSuggestion: {
      findMany: async (input: unknown) => {
        query = input;
        return [];
      },
    },
  };
  const service = new WebhookProcessingService(db as never);
  await service.listPendingSuggestions(projectId, 999);
  assert.deepEqual(query, {
    where: { projectId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    take: 250,
  });
});

test("persists project-linked GitHub references as pending review suggestions", async () => {
  const suggestions: unknown[] = [];
  const tx = {
    webhookEvent: {
      findUnique: async () => ({ id: eventId, status: "RECEIVED" }),
      updateMany: async () => ({ count: 1 }),
      update: async () => undefined,
    },
    projectRepository: { findFirst: async () => ({ projectId }) },
    integrationSuggestion: {
      upsert: async (input: unknown) => {
        suggestions.push(input);
      },
    },
    auditLog: { create: async () => undefined },
  };
  const db: {
    $transaction?: (operation: (transaction: any) => unknown) => unknown;
  } = {};
  db.$transaction = async (operation) => operation(tx);
  const service = new WebhookProcessingService(db as never);
  const result = await service.process(eventId, {
    kind: "github",
    eventId,
    eventType: "pull_request",
    repository: "acme/rdps",
    action: "opened",
    reference: {
      kind: "pull_request",
      externalId: "27",
      revision: "a".repeat(40),
    },
  });

  assert.deepEqual(result, {
    processed: true,
    outcome: "reference_requires_release_mapping",
  });
  assert.equal(suggestions.length, 1);
  assert.deepEqual((suggestions[0] as any).create, {
    projectId,
    webhookEventId: eventId,
    repository: "acme/rdps",
    referenceKind: "pull_request",
    externalId: "27",
    revision: "a".repeat(40),
    action: "opened",
    status: "PENDING",
  });
});
