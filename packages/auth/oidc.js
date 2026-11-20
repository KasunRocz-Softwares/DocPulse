"use strict";

const { createHmac, timingSafeEqual } = require("node:crypto");

const OIDC_TRANSACTION_TTL_MS = 5 * 60 * 1000;

function createOidcTransactionCookie(
  transaction,
  signingKey,
  now = Date.now(),
) {
  assertSigningKey(signingKey);
  for (const field of ["state", "nonce", "codeVerifier"]) {
    if (
      typeof transaction?.[field] !== "string" ||
      transaction[field].length < 32
    )
      throw new TypeError(
        `OIDC transaction ${field} must contain at least 32 characters`,
      );
  }
  const payload = Buffer.from(
    JSON.stringify({
      ...transaction,
      expiresAt: now + OIDC_TRANSACTION_TTL_MS,
    }),
  ).toString("base64url");
  const signature = sign(payload, signingKey);
  return `${payload}.${signature}`;
}

function readOidcTransactionCookie(
  cookie,
  signingKey,
  expectedState,
  now = Date.now(),
) {
  try {
    assertSigningKey(signingKey);
    if (typeof cookie !== "string" || cookie.length > 4096) return null;
    const separator = cookie.lastIndexOf(".");
    if (separator < 1) return null;
    const payload = cookie.slice(0, separator);
    const receivedSignature = Buffer.from(
      cookie.slice(separator + 1),
      "base64url",
    );
    const expectedSignature = Buffer.from(
      sign(payload, signingKey),
      "base64url",
    );
    if (
      receivedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(receivedSignature, expectedSignature)
    )
      return null;
    const value = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (
      typeof value.state !== "string" ||
      typeof value.nonce !== "string" ||
      typeof value.codeVerifier !== "string" ||
      !Number.isSafeInteger(value.expiresAt) ||
      value.expiresAt <= now ||
      !constantTimeStringEqual(value.state, expectedState)
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

function resolveOidcCallbackUrl(callbackValue, apiOriginValue) {
  const callback = parseOriginUrl(callbackValue, "OIDC callback URL");
  const apiOrigin = parseOrigin(apiOriginValue, "RDPS API public origin");
  if (
    callback.origin !== apiOrigin ||
    callback.pathname !== "/api/v1/internal/auth/oidc/callback" ||
    callback.search ||
    callback.hash
  )
    throw new Error(
      "OIDC callback URL must be the fixed auth callback on the configured API origin",
    );
  return callback.toString();
}

function resolveOidcAdminRedirect(adminOriginValue, allowedOriginsValue) {
  const adminOrigin = parseOrigin(adminOriginValue, "RDPS admin origin");
  const allowedOrigins = String(allowedOriginsValue ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => parseOrigin(value, "allowed web origin"));
  if (!allowedOrigins.some((origin) => origin === adminOrigin))
    throw new Error(
      "RDPS admin origin must exactly match an origin in WEB_BASE_URL",
    );
  return new URL("/", adminOrigin).toString();
}

function parseOrigin(value, label) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} is required`);
  const url = parseOriginUrl(value, label);
  if (url.pathname !== "/" || url.search || url.hash)
    throw new Error(`${label} must contain only an origin`);
  return url.origin;
}

function parseOriginUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  if (url.username || url.password)
    throw new Error(`${label} cannot contain credentials`);
  const localHttp =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp)
    throw new Error(`${label} must use HTTPS outside loopback development`);
  return url;
}

function assertSigningKey(key) {
  if (typeof key !== "string" || Buffer.byteLength(key) < 32)
    throw new Error(
      "OIDC transaction signing key must contain at least 32 bytes",
    );
}

function sign(value, key) {
  return createHmac("sha256", key).update(value).digest("base64url");
}

function constantTimeStringEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

module.exports = {
  OIDC_TRANSACTION_TTL_MS,
  createOidcTransactionCookie,
  readOidcTransactionCookie,
  resolveOidcCallbackUrl,
  resolveOidcAdminRedirect,
};
