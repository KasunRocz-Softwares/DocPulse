import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function safeEqualHex(expected: string, received: string | undefined): boolean {
  if (!received || !/^[a-f0-9]{64}$/i.test(received)) return false;
  const actual = Buffer.from(received, "hex");
  const wanted = Buffer.from(expected, "hex");
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

export function verifyGitHubSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature?.startsWith("sha256=") || !secret) return false;
  const supplied = signature.slice("sha256=".length);
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqualHex(expected, supplied);
}

export function verifyDeploymentSignature(
  rawBody: Buffer,
  timestamp: string | undefined,
  signature: string | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): boolean {
  if (!timestamp || !/^\d{10}$/.test(timestamp) || !secret) return false;
  const parsedTimestamp = Number(timestamp);
  if (Math.abs(nowSeconds - parsedTimestamp) > toleranceSeconds) return false;
  if (!signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest("hex");
  return safeEqualHex(expected, signature.slice("sha256=".length));
}

export function sha256(rawBody: Buffer): string {
  return createHash("sha256").update(rawBody).digest("hex");
}
