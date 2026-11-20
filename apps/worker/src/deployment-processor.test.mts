import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  createDeploymentProcessor,
  DEPLOYMENT_JOB_DEFAULTS,
} from "./deployment-processor.js";

const job = {
  requestId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  releaseId: "33333333-3333-4333-8333-333333333333",
  environmentId: "44444444-4444-4444-8444-444444444444",
  idempotencyKey: "trigger-key-0001",
  reason: "approved release window",
};
const secret = "test-signing-secret-that-is-at-least-32-chars";

test("dispatch sends minimal identifiers with a verifiable HMAC signature", async () => {
  let sent: RequestInit | undefined;
  const callbacks: unknown[][] = [];
  const processor = createDeploymentProcessor({
    endpoint: "https://runner.example.test/dispatch",
    signingSecret: secret,
    now: () => 1_800_000_000_000,
    fetcher: async (_url, init) => {
      sent = init;
      return new Response('{"accepted":true}', { status: 202 });
    },
    callback: async (...args) => {
      callbacks.push(args);
    },
  });
  await processor({ data: job });
  assert.equal(sent?.redirect, "error");
  assert.equal(
    sent?.headers &&
      (sent.headers as Record<string, string>)["Idempotency-Key"],
    job.idempotencyKey,
  );
  const body = String(sent?.body);
  assert.deepEqual(JSON.parse(body), job);
  const headers = sent?.headers as Record<string, string>;
  const expected = createHmac("sha256", secret)
    .update(`${headers["X-RDPS-Timestamp"]}.${body}`)
    .digest("hex");
  assert.equal(headers["X-RDPS-Signature"], `sha256=${expected}`);
  assert.deepEqual(callbacks, [
    [
      job.requestId,
      "ACCEPTED",
      "RUNNER_ACCEPTED",
      "Deployment runner accepted the request",
    ],
  ]);
});

test("rejects non-HTTPS and credential-bearing configured endpoints", () => {
  for (const endpoint of [
    "http://runner.example.test/dispatch",
    "https://user:password@runner.example.test/dispatch",
  ]) {
    assert.throws(
      () =>
        createDeploymentProcessor({
          endpoint,
          signingSecret: secret,
          callback: async () => undefined,
        }),
      /HTTPS URL/,
    );
  }
});

test("allows HTTP only for the built-in local runner host in development", () => {
  assert.doesNotThrow(() =>
    createDeploymentProcessor({
      endpoint: "http://deployment-runner:3080/dispatch",
      signingSecret: secret,
      allowLocalHttp: true,
      callback: async () => undefined,
    }),
  );
  assert.throws(
    () =>
      createDeploymentProcessor({
        endpoint: "http://127.0.0.1:3080/dispatch",
        signingSecret: secret,
        callback: async () => undefined,
      }),
    /HTTPS URL/,
  );
});

test("rejects redirect responses and bounds runner response bodies", async () => {
  const options = {
    endpoint: "https://runner.example.test/dispatch",
    signingSecret: secret,
    callback: async () => undefined,
  };
  const redirecting = createDeploymentProcessor({
    ...options,
    fetcher: async () => new Response(null, { status: 302 }),
  });
  await assert.rejects(redirecting({ data: job }), /did not accept/);

  const oversized = createDeploymentProcessor({
    ...options,
    maxResponseBytes: 32,
    fetcher: async () => new Response("x".repeat(33), { status: 202 }),
  });
  await assert.rejects(oversized({ data: job }), /size limit/);
});

test("rejects malformed queued data without dispatching", async () => {
  let calls = 0;
  const processor = createDeploymentProcessor({
    endpoint: "https://runner.example.test/dispatch",
    signingSecret: secret,
    fetcher: async () => {
      calls++;
      return new Response(null, { status: 202 });
    },
    callback: async () => undefined,
  });
  await assert.rejects(
    processor({ data: { ...job, requestId: "bad" } }),
    /Invalid deployment job/,
  );
  assert.equal(calls, 0);
});

test("distinguishes a failed RDPS callback after runner acceptance", async () => {
  const processor = createDeploymentProcessor({
    endpoint: "https://runner.example.test/dispatch",
    signingSecret: secret,
    fetcher: async () => new Response(null, { status: 202 }),
    callback: async () => {
      throw new Error("callback unavailable");
    },
  });
  await assert.rejects(processor({ data: job }), (error: any) => {
    assert.equal(error.code, "DEPLOYMENT_CALLBACK_FAILED");
    assert.doesNotMatch(error.message, /callback unavailable/);
    return true;
  });
});

test("uses retry and dead-letter compatible bounded defaults", () => {
  assert.equal(DEPLOYMENT_JOB_DEFAULTS.attempts, 5);
  assert.equal(DEPLOYMENT_JOB_DEFAULTS.backoff.type, "exponential");
});
