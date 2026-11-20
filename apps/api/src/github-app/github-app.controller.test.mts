import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import { GitHubAppWebhookController } from "./github-app.controller.js";

const secret = "github-app-test-webhook-secret-with-sufficient-length";
const revision = "a".repeat(40);

test("signed GitHub App reference events reach ingestion only for linked repositories", async () => {
  const previousSecret = process.env.GITHUB_APP_WEBHOOK_SECRET;
  process.env.GITHUB_APP_WEBHOOK_SECRET = secret;
  const ingested: unknown[] = [];
  let linked = true;
  const controller = new GitHubAppWebhookController(
    {
      isRepositoryLinked: async (installationId: string, repository: string) =>
        linked && installationId === "42" && repository === "acme/app",
    } as never,
    {
      ingest: async (input: unknown) => {
        ingested.push(input);
        return { accepted: true, duplicate: false, eventId: "event-1" };
      },
    } as never,
  );
  const payload = {
    installation: { id: 42 },
    repository: { full_name: "acme/app" },
    after: revision,
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;

  try {
    const result = await controller.webhook(
      { rawBody },
      signature,
      "delivery-1",
      "push",
    );
    assert.deepEqual(result, {
      accepted: true,
      duplicate: false,
      eventId: "event-1",
    });
    assert.deepEqual(ingested, [
      {
        provider: "github",
        deliveryId: "delivery-1",
        eventType: "push",
        payloadHash: createHash("sha256").update(rawBody).digest("hex"),
        job: {
          kind: "github",
          eventType: "push",
          repository: "acme/app",
          action: "push",
          reference: {
            kind: "commit",
            externalId: revision,
            revision,
          },
        },
      },
    ]);

    linked = false;
    const ignored = await controller.webhook(
      { rawBody },
      signature,
      "delivery-2",
      "push",
    );
    assert.deepEqual(ignored, { accepted: true, ignored: true });
    assert.equal(ingested.length, 1);
  } finally {
    if (previousSecret === undefined)
      delete process.env.GITHUB_APP_WEBHOOK_SECRET;
    else process.env.GITHUB_APP_WEBHOOK_SECRET = previousSecret;
  }
});
