import assert from "node:assert/strict";
import test from "node:test";
import { createApiWebhookHandlers } from "./api-webhook-handlers.js";

test("posts persisted webhook jobs to the API with the configured worker credential", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return Response.json({ processed: true, outcome: "tag_linked" });
  };

  try {
    const handlers = createApiWebhookHandlers(
      "http://api:3001",
      "dev-test-worker-secret",
    );
    await handlers.processGitHub({
      kind: "github",
      eventId: "persisted-event-id",
      eventType: "push",
      repository: "acme/app",
      action: "push",
      reference: {
        kind: "commit",
        externalId: "a".repeat(40),
        revision: "a".repeat(40),
      },
    });
    assert.equal(
      requestUrl,
      "http://api:3001/api/v1/integrations/internal/webhook-events/persisted-event-id/process",
    );
    assert.equal(
      new Headers(requestInit?.headers).get("x-rdps-worker-token"),
      "dev-test-worker-secret",
    );
    assert.equal(
      JSON.parse(String(requestInit?.body)).eventId,
      "persisted-event-id",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fails fast when worker API configuration is missing", () => {
  assert.throws(() => createApiWebhookHandlers("", "secret"), /RDPS_API_URL/);
  assert.throws(
    () => createApiWebhookHandlers("http://api:3001", ""),
    /RDPS_WORKER_SHARED_SECRET/,
  );
});
