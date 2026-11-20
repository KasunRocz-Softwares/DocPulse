import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeDeploymentWebhook,
  normalizeGitHubWebhook,
} from "./webhook-normalization.js";

test("normalizes supported GitHub webhooks to identifier-only jobs", () => {
  const pullRequest = normalizeGitHubWebhook("pull_request", {
    action: "opened",
    repository: { full_name: "acme/rdps" },
    pull_request: {
      number: 42,
      head: { sha: "a".repeat(40) },
      title: "Do not enqueue text",
    },
  });
  assert.deepEqual(pullRequest, {
    kind: "github",
    eventType: "pull_request",
    repository: "acme/rdps",
    action: "opened",
    reference: {
      kind: "pull_request",
      externalId: "42",
      revision: "a".repeat(40),
    },
  });
  assert.equal(
    JSON.stringify(pullRequest).includes("Do not enqueue text"),
    false,
  );
});

test("normalizes pushes and ignores unknown or malformed event payloads", () => {
  assert.deepEqual(
    normalizeGitHubWebhook("push", {
      repository: { full_name: "acme/rdps" },
      after: "b".repeat(40),
      ref: "refs/heads/main",
    }),
    {
      kind: "github",
      eventType: "push",
      repository: "acme/rdps",
      action: "push",
      reference: {
        kind: "commit",
        externalId: "b".repeat(40),
        revision: "b".repeat(40),
      },
    },
  );
  assert.equal(normalizeGitHubWebhook("ping", {}), undefined);
  assert.equal(
    normalizeGitHubWebhook("pull_request", { repository: {} }),
    undefined,
  );
});

test("normalizes deployment identity and rejects malformed IDs or state", () => {
  assert.deepEqual(
    normalizeDeploymentWebhook("jenkins", {
      deploymentId: "run-42",
      projectId: "11111111-1111-4111-8111-111111111111",
      releaseId: "22222222-2222-4222-8222-222222222222",
      environmentId: "33333333-3333-4333-8333-333333333333",
      status: "succeeded",
      occurredAt: "2026-11-10T00:00:00Z",
      password: "must not be forwarded",
    }),
    {
      kind: "deployment",
      provider: "jenkins",
      deploymentId: "run-42",
      projectId: "11111111-1111-4111-8111-111111111111",
      releaseId: "22222222-2222-4222-8222-222222222222",
      environmentId: "33333333-3333-4333-8333-333333333333",
      status: "succeeded",
      occurredAt: "2026-11-10T00:00:00.000Z",
    },
  );
  assert.equal(
    normalizeDeploymentWebhook("generic", {
      deploymentId: "x",
      status: "unknown",
    }),
    undefined,
  );
});
