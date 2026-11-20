import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  verifyDeploymentSignature,
  verifyGitHubSignature,
} from "./webhook-security.js";

const body = Buffer.from('{"action":"published"}');
const secret = "unit-test-secret";

test("accepts a valid GitHub SHA-256 signature over the exact raw body", () => {
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  assert.equal(verifyGitHubSignature(body, signature, secret), true);
  assert.equal(
    verifyGitHubSignature(Buffer.from(`${body} `), signature, secret),
    false,
  );
});

test("rejects malformed, missing, and non-constant-time-comparable GitHub signatures", () => {
  assert.equal(verifyGitHubSignature(body, undefined, secret), false);
  assert.equal(verifyGitHubSignature(body, "sha1=abcd", secret), false);
  assert.equal(verifyGitHubSignature(body, "sha256=xyz", secret), false);
});

test("deployment signature binds timestamp and raw body and enforces replay window", () => {
  const now = 1_800_000_000;
  const timestamp = String(now);
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(body)
    .digest("hex");
  assert.equal(
    verifyDeploymentSignature(
      body,
      timestamp,
      `sha256=${signature}`,
      secret,
      now,
    ),
    true,
  );
  assert.equal(
    verifyDeploymentSignature(
      body,
      String(now - 301),
      `sha256=${signature}`,
      secret,
      now,
    ),
    false,
  );
  assert.equal(
    verifyDeploymentSignature(
      body,
      timestamp,
      `sha256=${signature}`,
      secret,
      now + 301,
    ),
    false,
  );
});
