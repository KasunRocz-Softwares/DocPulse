import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const deliveryId = `rdps-runtime-smoke-${randomUUID()}`;
const apiScript = String.raw`
import { createHmac, randomBytes } from "node:crypto";

const secret = process.env.GITHUB_WEBHOOK_SECRET;
if (!secret) throw new Error("GITHUB_WEBHOOK_SECRET is not configured in API");
const deliveryId = ${JSON.stringify(deliveryId)};
const revision = randomBytes(20).toString("hex");
const body = JSON.stringify({
  repository: { full_name: "rdps-runtime-smoke/unmatched-repository" },
  after: revision,
});
const signature = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
const post = () => fetch("http://127.0.0.1:3001/api/v1/integrations/github/webhook", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-hub-signature-256": signature,
    "x-github-delivery": deliveryId,
    "x-github-event": "push",
  },
  body,
});
const first = await post();
const firstText = await first.text();
if (first.status !== 202) throw new Error("First delivery returned " + first.status + ": " + firstText);
const firstResult = JSON.parse(firstText);
const duplicate = await post();
const duplicateText = await duplicate.text();
if (duplicate.status !== 202) throw new Error("Duplicate delivery returned " + duplicate.status + ": " + duplicateText);
const duplicateResult = JSON.parse(duplicateText);
if (firstResult.duplicate !== false || duplicateResult.duplicate !== true || firstResult.eventId !== duplicateResult.eventId) {
  throw new Error("Unexpected duplicate results: " + JSON.stringify({ firstResult, duplicateResult }));
}
process.stdout.write(JSON.stringify({ eventId: firstResult.eventId, duplicateIdempotent: true }));
`;

const apiResult = JSON.parse(
  execFileSync(
    "docker",
    ["compose", "exec", "-T", "api", "node", "--input-type=module"],
    {
      input: apiScript,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "inherit"],
    },
  ),
);

const readStatus = () =>
  execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "rdps",
      "-d",
      "rdps",
      "-Atc",
      `SELECT status FROM "WebhookEvent" WHERE provider = 'github' AND "deliveryId" = '${deliveryId}'`,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();

const deadline = Date.now() + 30_000;
let status = "";
while (Date.now() < deadline) {
  status = readStatus();
  if (["PROCESSED", "UNMATCHED"].includes(status)) break;
  if (status === "FAILED")
    throw new Error(`Worker marked webhook event ${apiResult.eventId} failed`);
  await new Promise((resolve) => setTimeout(resolve, 500));
}

assert.ok(
  ["PROCESSED", "UNMATCHED"].includes(status),
  `Worker did not finish webhook event ${apiResult.eventId}; final database status: ${status || "missing"}`,
);
console.log(
  JSON.stringify({
    deliveryId,
    eventId: apiResult.eventId,
    duplicateIdempotent: apiResult.duplicateIdempotent,
    persistedStatus: status,
    workerCompleted: true,
  }),
);
