import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createOidcTransactionCookie } from "@rdps/auth/oidc";
import { OidcService } from "./oidc.service";
import type {
  OidcProtocol,
  OidcSettings,
  OidcTransaction,
} from "./oidc.protocol";

const envNames = [
  "OIDC_ISSUER",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_CALLBACK_URL",
  "OIDC_STATE_SECRET",
  "RDPS_API_PUBLIC_ORIGIN",
  "RDPS_OIDC_ADMIN_ORIGIN",
  "WEB_BASE_URL",
];
const previous = Object.fromEntries(
  envNames.map((key) => [key, process.env[key]]),
);
const config = {
  OIDC_ISSUER: "https://idp.example.test",
  OIDC_CLIENT_ID: "rdps-client",
  OIDC_CLIENT_SECRET: "client-secret",
  OIDC_CALLBACK_URL:
    "https://api.example.test/api/v1/internal/auth/oidc/callback",
  OIDC_STATE_SECRET: "oidc-state-test-signing-key-at-least-32-bytes",
  RDPS_API_PUBLIC_ORIGIN: "https://api.example.test",
  RDPS_OIDC_ADMIN_ORIGIN: "https://admin.example.test",
  WEB_BASE_URL: "https://admin.example.test",
};
Object.assign(process.env, config);
after(() => {
  for (const key of envNames) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
});

const transaction: OidcTransaction = {
  state: "a-state-value-that-is-long-enough-for-production-randomness",
  nonce: "a-nonce-value-that-is-long-enough-for-production-randomness",
  codeVerifier: "a-pkce-verifier-that-is-long-enough-for-production-randomness",
};
const goodClaims = {
  iss: "https://idp.example.test/",
  sub: "subject-123",
  aud: "rdps-client",
  exp: Math.floor(Date.now() / 1000) + 600,
  email: "person@example.test",
  email_verified: true,
  name: "Example Person",
};

function createService(claims: Record<string, unknown> = goodClaims) {
  let exchanged: {
    settings: OidcSettings;
    callbackUrl: string;
    transaction: OidcTransaction;
  } | null = null;
  const protocol: OidcProtocol = {
    async createTransaction() {
      return transaction;
    },
    async authorizationUrl() {
      return "https://idp.example.test/authorize";
    },
    async exchange(settings, callbackUrl, state) {
      exchanged = { settings, callbackUrl, transaction: state };
      return claims;
    },
  };
  const authCalls: unknown[] = [];
  const auth = {
    async loginWithOidc(identity: unknown, client: unknown) {
      authCalls.push({ identity, client });
      return { accessToken: "access", refreshToken: "refresh" };
    },
    async linkOidcIdentity(identity: unknown, userId: string) {
      authCalls.push({ identity, userId, link: true });
      return { linked: true, alreadyLinked: false };
    },
  } as never;
  return {
    service: new OidcService(auth, protocol),
    getExchanged: () => exchanged,
    authCalls,
  };
}

function callback(
  cookie = createOidcTransactionCookie(transaction, config.OIDC_STATE_SECRET),
) {
  return { code: "authorization-code", state: transaction.state, cookie };
}

test("completes only a state-bound callback and passes fixed callback URL to verifier", async () => {
  const fixture = createService();
  const result = await fixture.service.complete(
    { code: callback().code, state: callback().state },
    callback().cookie,
    { ipAddress: "127.0.0.1" },
  );
  assert.equal("accessToken" in result ? result.accessToken : null, "access");
  assert.equal(fixture.authCalls.length, 1);
  const exchanged = fixture.getExchanged()!;
  assert.equal(
    exchanged.callbackUrl,
    `${config.OIDC_CALLBACK_URL}?code=authorization-code&state=${encodeURIComponent(transaction.state)}`,
  );
  assert.equal(exchanged.transaction.nonce, transaction.nonce);
  assert.equal(
    (fixture.authCalls[0] as { identity: { issuer: string; subject: string } })
      .identity.issuer,
    goodClaims.iss,
  );
  assert.equal(
    fixture.service.adminReturnUrl(),
    "https://admin.example.test/?oidc=success",
  );
});

test("rejects mismatched state before exchanging the authorization code", async () => {
  const fixture = createService();
  await assert.rejects(
    fixture.service.complete(
      { code: "code", state: "attacker-state" },
      callback().cookie,
      {},
    ),
    /invalid or expired/,
  );
  assert.equal(fixture.getExchanged(), null);
  assert.equal(fixture.authCalls.length, 0);
});

test("preserves the provider issuer response parameter for RFC 9207 validation", async () => {
  const fixture = createService();
  await fixture.service.complete(
    { code: "code", state: transaction.state, iss: goodClaims.iss },
    callback().cookie,
    {},
  );
  assert.equal(
    new URL(fixture.getExchanged()!.callbackUrl).searchParams.get("iss"),
    goodClaims.iss,
  );
});

test("supports explicit authenticated account linking without issuing a new login", async () => {
  const fixture = createService();
  const start = await fixture.service.startLink("rdps-user-id");
  const result = await fixture.service.complete(
    { code: "code", state: transaction.state, iss: goodClaims.iss },
    start.transactionCookie,
    {},
  );
  assert.deepEqual(result, { linked: true, alreadyLinked: false });
  assert.deepEqual(fixture.authCalls[0], {
    identity: {
      issuer: goodClaims.iss,
      subject: "subject-123",
      email: "person@example.test",
      displayName: "Example Person",
    },
    userId: "rdps-user-id",
    link: true,
  });
});

for (const [label, override] of [
  ["issuer", { iss: "https://attacker.example.test/" }],
  ["audience", { aud: "another-client" }],
  ["expiry", { exp: Math.floor(Date.now() / 1000) - 10 }],
  ["unverified email", { email_verified: false }],
  [
    "authorized party",
    { aud: ["rdps-client", "another-client"], azp: "another-client" },
  ],
  ["missing authorized party", { aud: ["rdps-client", "another-client"] }],
  ["malformed email", { email: "not-an-email" }],
  ["missing subject", { sub: "" }],
] as const) {
  test(`rejects a provider token with invalid ${label} claims`, async () => {
    const fixture = createService({ ...goodClaims, ...override });
    await assert.rejects(
      fixture.service.complete(
        { code: "code", state: transaction.state },
        callback().cookie,
        {},
      ),
    );
    assert.equal(fixture.authCalls.length, 0);
  });
}

test("refuses provider denial or callbacks without an authorization code", async () => {
  const fixture = createService();
  await assert.rejects(
    fixture.service.complete(
      { state: transaction.state, error: "access_denied" },
      callback().cookie,
      {},
    ),
  );
  await assert.rejects(
    fixture.service.complete(
      { state: transaction.state },
      callback().cookie,
      {},
    ),
  );
  assert.equal(fixture.getExchanged(), null);
});

test("reports SSO disabled when required configuration is absent", () => {
  const oldIssuer = process.env.OIDC_ISSUER;
  delete process.env.OIDC_ISSUER;
  try {
    assert.equal(createService().service.isEnabled(), false);
  } finally {
    process.env.OIDC_ISSUER = oldIssuer;
  }
});

test("reports SSO disabled when the transaction signing secret is weak", () => {
  const oldSecret = process.env.OIDC_STATE_SECRET;
  process.env.OIDC_STATE_SECRET = "too-short";
  try {
    assert.equal(createService().service.isEnabled(), false);
  } finally {
    process.env.OIDC_STATE_SECRET = oldSecret;
  }
});

test("builds a same-origin authorization transaction with PKCE cookie material", async () => {
  const fixture = createService();
  const start = await fixture.service.start();
  assert.equal(start.authorizationUrl, "https://idp.example.test/authorize");
  assert.ok(start.transactionCookie.split(".").length === 2);
});
