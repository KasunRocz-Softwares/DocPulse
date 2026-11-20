import assert from "node:assert/strict";
import test from "node:test";
import {
  createNotificationProcessor,
  NOTIFICATION_JOB_DEFAULTS,
} from "./notification-processor.js";

test("sends only a published snapshot notification and advances delivery state", async () => {
  const calls: unknown[] = [];
  const processor = createNotificationProcessor({
    loadDelivery: async (id) => ({
      id,
      status: "PENDING",
      recipient: "reader@example.test",
      projectName: "Product",
      version: "1.0.0",
      title: "Release",
      summary: "Public summary",
      publicUrl: "https://releases.test/product/1.0.0",
      unsubscribeUrl: "https://releases.test/unsubscribe/safe",
    }),
    send: async (message) => {
      calls.push(message);
    },
    markSent: async (id) => {
      calls.push(`sent:${id}`);
    },
    markFailed: async () => undefined,
  });
  await processor({ data: { deliveryId: "delivery-1" } });
  assert.equal((calls[0] as any).html.includes("Public summary"), true);
  assert.equal((calls[0] as any).html.includes("Internal"), false);
  assert.equal(calls[1], "sent:delivery-1");
});

test("delivery failure persists safe retry state without exposing error messages", async () => {
  let failure: unknown;
  const processor = createNotificationProcessor({
    loadDelivery: async (id) => ({
      id,
      status: "PENDING",
      recipient: "reader@example.test",
      projectName: "P",
      version: "1",
      title: "R",
      publicUrl: "https://example.test",
      unsubscribeUrl: "https://example.test/u",
    }),
    send: async () => {
      throw Object.assign(new Error("unsubscribe-token-secret"), {
        code: "ECONNRESET",
      });
    },
    markSent: async () => undefined,
    markFailed: async (_id, diagnostic) => {
      failure = diagnostic;
    },
  });
  await assert.rejects(
    processor({ data: { deliveryId: "delivery-1" } }),
    /delivery failed/,
  );
  assert.deepEqual(failure, { errorName: "Error", errorCode: "ECONNRESET" });
  assert.equal(
    JSON.stringify(failure).includes("unsubscribe-token-secret"),
    false,
  );
  assert.equal(NOTIFICATION_JOB_DEFAULTS.attempts, 8);
});
