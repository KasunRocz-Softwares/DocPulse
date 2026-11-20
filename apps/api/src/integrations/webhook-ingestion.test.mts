import assert from "node:assert/strict";
import test from "node:test";
import { WebhookIngestionService } from "./webhook-ingestion.service.js";

const job = {
  kind: "github" as const,
  eventType: "push" as const,
  repository: "acme/rdps",
  action: "push",
  reference: {
    kind: "commit" as const,
    externalId: "a".repeat(40),
    revision: "a".repeat(40),
  },
};

test("persists an idempotency record and enqueues only normalized webhook data", async () => {
  const calls: unknown[][] = [];
  const prisma = {
    webhookEvent: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async () => ({ id: "event-1", status: "RECEIVED" }),
    },
  };
  (prisma as any).$transaction = async (
    operation: (tx: typeof prisma) => unknown,
  ) => operation(prisma);
  const queue = {
    add: async (...args: unknown[]) => {
      calls.push(args);
    },
  };
  const service = new WebhookIngestionService(prisma as never, queue as never);
  const result = await service.ingest({
    provider: "github",
    deliveryId: "delivery-1",
    eventType: "push",
    payloadHash: "f".repeat(64),
    job,
  });
  assert.deepEqual(result, {
    accepted: true,
    duplicate: false,
    eventId: "event-1",
  });
  assert.equal(calls.length, 1);
  assert.equal((calls[0][1] as Record<string, unknown>).eventId, "event-1");
  assert.equal(JSON.stringify(calls).includes("rawBody"), false);
  assert.equal(JSON.stringify(calls).includes("secret"), false);
});

test("requeues an already-recorded delivery after a transient queue failure using the same job ID", async () => {
  let persisted = false;
  let queueAttempts = 0;
  const prisma = {
    webhookEvent: {
      findUnique: async () =>
        persisted ? { id: "event-2", status: "RECEIVED" } : null,
      findFirst: async () => null,
      create: async () => {
        persisted = true;
        return { id: "event-2", status: "RECEIVED" };
      },
    },
  };
  (prisma as any).$transaction = async (
    operation: (tx: typeof prisma) => unknown,
  ) => operation(prisma);
  const queue = {
    add: async (_name: string, _data: unknown, options: { jobId: string }) => {
      queueAttempts += 1;
      if (queueAttempts === 1) throw new Error("redis unavailable");
      assert.equal(options.jobId, "webhook-event-2");
    },
  };
  const service = new WebhookIngestionService(prisma as never, queue as never);
  const input = {
    provider: "github" as const,
    deliveryId: "delivery-2",
    eventType: "push",
    payloadHash: "e".repeat(64),
    job,
  };
  await assert.rejects(() => service.ingest(input), /redis unavailable/);
  const retry = await service.ingest(input);
  assert.equal(retry.duplicate, true);
  assert.equal(queueAttempts, 2);
});

test("deduplicates replayed payloads even when an unsigned GitHub delivery header changes", async () => {
  const queueCalls: unknown[] = [];
  const prisma = {
    webhookEvent: {
      findUnique: async () => null,
      findFirst: async () => ({ id: "original-event", status: "PROCESSED" }),
      create: async () => assert.fail("must not create a second event"),
    },
  };
  (prisma as any).$transaction = async (
    operation: (tx: typeof prisma) => unknown,
  ) => operation(prisma);
  const service = new WebhookIngestionService(
    prisma as never,
    { add: async (...args: unknown[]) => queueCalls.push(args) } as never,
  );
  const result = await service.ingest({
    provider: "github",
    deliveryId: "forged-new-id",
    eventType: "push",
    payloadHash: "d".repeat(64),
    job,
  });
  assert.equal(result.duplicate, true);
  assert.equal(result.eventId, "original-event");
  assert.equal(queueCalls.length, 0);
});
