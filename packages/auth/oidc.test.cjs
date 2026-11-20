const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createOidcTransactionCookie,
  readOidcTransactionCookie,
  resolveOidcCallbackUrl,
  resolveOidcAdminRedirect,
} = require("./oidc.js");

const key = "a-test-secret-that-is-at-least-thirty-two-characters";
const input = {
  state: "state-value-that-is-long-enough-for-a-real-random-value",
  nonce: "nonce-value-that-is-long-enough-for-a-real-random-value",
  codeVerifier: "verifier-value-that-is-long-enough-for-a-real-random-value",
};

test("round-trips a signed OIDC transaction only for its original state", () => {
  const cookie = createOidcTransactionCookie(input, key, 1000);
  assert.deepEqual(readOidcTransactionCookie(cookie, key, input.state, 2000), {
    ...input,
    expiresAt: 301000,
  });
  assert.equal(
    readOidcTransactionCookie(cookie, key, "other-state", 2000),
    null,
  );
});

test("rejects tampered and expired OIDC transaction cookies", () => {
  const cookie = createOidcTransactionCookie(input, key, 1000);
  assert.equal(
    readOidcTransactionCookie(`${cookie}x`, key, input.state, 2000),
    null,
  );
  assert.equal(
    readOidcTransactionCookie(cookie, key, input.state, 301000),
    null,
  );
});

test("authenticates the requested login or link purpose in the browser transaction", () => {
  const cookie = createOidcTransactionCookie(
    { ...input, purpose: "link", userId: "rdps-account-id" },
    key,
    1000,
  );
  assert.equal(
    readOidcTransactionCookie(cookie, key, input.state, 2000).userId,
    "rdps-account-id",
  );
  assert.equal(
    readOidcTransactionCookie(cookie, key, input.state, 2000).purpose,
    "link",
  );
});

test("requires a strong transaction signing key", () => {
  assert.throws(() => createOidcTransactionCookie(input, "short", 1000));
});

test("accepts only a fixed callback URL matching the configured API origin", () => {
  assert.equal(
    resolveOidcCallbackUrl(
      "https://api.example.test/api/v1/internal/auth/oidc/callback",
      "https://api.example.test",
    ),
    "https://api.example.test/api/v1/internal/auth/oidc/callback",
  );
  assert.throws(() =>
    resolveOidcCallbackUrl(
      "https://evil.example/callback",
      "https://api.example.test",
    ),
  );
  assert.throws(() =>
    resolveOidcCallbackUrl(
      "https://user:pass@api.example.test/callback",
      "https://api.example.test",
    ),
  );
  assert.throws(() =>
    resolveOidcCallbackUrl(
      "http://api.example.test/callback",
      "http://api.example.test",
    ),
  );
});

test("only redirects back to an explicitly allowed admin origin", () => {
  assert.equal(
    resolveOidcAdminRedirect(
      "https://admin.example.test",
      "https://admin.example.test,https://public.example.test",
    ),
    "https://admin.example.test/",
  );
  assert.throws(() =>
    resolveOidcAdminRedirect(
      "https://evil.example",
      "https://admin.example.test",
    ),
  );
  assert.throws(() =>
    resolveOidcAdminRedirect(
      "https://admin.example.test/path",
      "https://admin.example.test",
    ),
  );
});
