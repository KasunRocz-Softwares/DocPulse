import assert from "node:assert/strict";
import test from "node:test";
import {
  createWebhookProcessor,
  failureDiagnostic,
  WEBHOOK_JOB_DEFAULTS,
} from "./webhook-processor.js";

test("dispatches normalized GitHub and deployment jobs to their handlers", async () => {
  const received: string[] = [];
  const processor = createWebhookProcessor({
    processGitHub: async (event) => {
      received.push(`github:${event.reference.externalId}`);
    },
    processDeployment: async (event) => {
      received.push(`deployment:${event.deploymentId}`);
    },
  });
  await processor({
    data: {
      kind: "github",
      eventType: "push",
      repository: "acme/app",
      action: "push",
      reference: { kind: "commit", externalId: "abc", revision: "abc" },
    },
  });
  await processor({
    data: {
      kind: "deployment",
      provider: "rdps",
      deploymentId: "deploy-1",
      projectId: "p1",
      releaseId: "r1",
      environmentId: "e1",
      status: "succeeded",
      occurredAt: "2026-11-10T00:00:00.000Z",
    },
  });
  assert.deepEqual(received, ["github:abc", "deployment:deploy-1"]);
});

test("fails malformed jobs so BullMQ retry policy can retry them", async () => {
  const processor = createWebhookProcessor({
    processGitHub: async () => {},
    processDeployment: async () => {},
  });
  await assert.rejects(
    () => processor({ data: { kind: "github" } }),
    /Invalid webhook job/,
  );
});

test("uses bounded exponential retries and emits failure diagnostics without error messages", () => {
  assert.deepEqual(WEBHOOK_JOB_DEFAULTS, {
    attempts: 8,
    backoff: { type: "exponential", delay: 1000 },
  });
  const diagnostic = failureDiagnostic({
    name: "Error",
    message: "token=do-not-log",
    code: "ECONNRESET",
  });
  assert.deepEqual(diagnostic, { errorName: "Error", errorCode: "ECONNRESET" });
  assert.equal(JSON.stringify(diagnostic).includes("do-not-log"), false);
});
