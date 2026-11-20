import assert from "node:assert/strict";
import { after, test } from "node:test";
import { AuthController } from "./auth.controller";
import { createOidcTransactionCookie } from "@rdps/auth/oidc";
import { OidcService } from "./oidc.service";
import type {
  OidcProtocol,
  OidcSettings,
  OidcTransaction,
} from "./oidc.protocol";

const env = {
  OIDC_ISSUER: "https://idp.example.test/",
  OIDC_CLIENT_ID: "rdps-client",
  OIDC_CLIENT_SECRET: "provider-secret",
  OIDC_CALLBACK_URL:
    "https://api.example.test/api/v1/internal/auth/oidc/callback",
  OIDC_STATE_SECRET: "controller-test-oidc-state-secret-32-bytes-minimum",
  RDPS_API_PUBLIC_ORIGIN: "https://api.example.test",
  RDPS_OIDC_ADMIN_ORIGIN: "https://admin.example.test",
  WEB_BASE_URL: "https://admin.example.test",
};
const savedEnv = Object.fromEntries(
  Object.keys(env).map((key) => [key, process.env[key]]),
);
Object.assign(process.env, env);
after(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const transaction: OidcTransaction = {
  state: "controller-state-value-which-is-long-enough-for-production",
  nonce: "controller-nonce-value-which-is-long-enough-for-production",
  codeVerifier:
    "controller-pkce-verifier-long-enough-for-production-randomness",
};
const claims = {
  iss: env.OIDC_ISSUER,
  sub: "controller-subject",
  aud: env.OIDC_CLIENT_ID,
  exp: Math.floor(Date.now() / 1000) + 600,
  email: "controller@example.test",
  email_verified: true,
  name: "Controller User",
};

function fixture() {
  const protocol: OidcProtocol = {
    async createTransaction() {
      return transaction;
    },
    async authorizationUrl(_settings: OidcSettings) {
      return "https://idp.example.test/authorize";
    },
    async exchange() {
      return claims;
    },
  };
  const auth = {
    async loginWithOidc() {
      return {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        user: {
          id: "user-id",
          email: claims.email,
          displayName: claims.name,
          isSystemAdmin: false,
        },
      };
    },
    async linkOidcIdentity() {
      return { linked: true, alreadyLinked: false };
    },
  } as never;
  const oidc = new OidcService(auth, protocol);
  return new AuthController(auth, oidc);
}

function response() {
  return {
    headers: new Map<string, string | string[]>(),
    status: 0,
    location: "",
    setHeader(name: string, value: string | string[]) {
      this.headers.set(name, value);
    },
    redirect(status: number, url: string) {
      this.status = status;
      this.location = url;
    },
  };
}

test("OIDC browser flow sets a bound transaction cookie, then RDPS refresh cookie and fixed redirect", async () => {
  const controller = fixture();
  const startResponse = response();
  await controller.startOidc(startResponse);
  assert.equal(startResponse.status, 302);
  assert.equal(startResponse.location, "https://idp.example.test/authorize");
  const startCookie = startResponse.headers.get("Set-Cookie");
  assert.equal(typeof startCookie, "string");
  assert.match(
    startCookie as string,
    /HttpOnly; SameSite=Lax; Path=\/api\/v1\/internal\/auth\/oidc; Max-Age=300/,
  );
  const cookieValue = decodeURIComponent(
    (startCookie as string).split(";")[0]!.split("=").slice(1).join("="),
  );

  const callbackResponse = response();
  await controller.completeOidc(
    {
      ip: "127.0.0.1",
      headers: {
        cookie: `rdps_oidc_transaction=${encodeURIComponent(cookieValue)}`,
        "user-agent": "test-agent",
      },
      query: { code: "one-time-code", state: transaction.state },
    },
    callbackResponse,
  );
  assert.equal(callbackResponse.status, 302);
  assert.equal(
    callbackResponse.location,
    "https://admin.example.test/?oidc=success",
  );
  const callbackCookies = callbackResponse.headers.get("Set-Cookie");
  assert.ok(Array.isArray(callbackCookies));
  assert.match(
    callbackCookies[0]!,
    /^rdps_refresh=refresh-token; HttpOnly; SameSite=Strict/,
  );
  assert.match(callbackCookies[1]!, /^rdps_oidc_transaction=;.*Max-Age=0/);
});

test("invalid callback state is cleared and never issues an RDPS refresh session", async () => {
  const controller = fixture();
  const cookie = createOidcTransactionCookie(
    transaction,
    env.OIDC_STATE_SECRET,
  );
  const callbackResponse = response();
  await controller.completeOidc(
    {
      headers: {
        cookie: `rdps_oidc_transaction=${encodeURIComponent(cookie)}`,
      },
      query: { code: "attacker-code", state: "wrong-state" },
    },
    callbackResponse,
  );
  assert.equal(
    callbackResponse.location,
    "https://admin.example.test/?oidc_error=authentication_failed",
  );
  const cookies = callbackResponse.headers.get("Set-Cookie");
  assert.equal(typeof cookies, "string");
  assert.match(cookies as string, /^rdps_oidc_transaction=;.*Max-Age=0/);
});

test("authenticated account-link flow uses a bound target account and returns without refreshing the session", async () => {
  const controller = fixture();
  const startResponse = response();
  const started = await controller.startOidcLink(
    { user: { id: "rdps-user-id" } } as never,
    startResponse,
  );
  assert.equal(started.authorizationUrl, "https://idp.example.test/authorize");
  const startCookie = startResponse.headers.get("Set-Cookie") as string;
  const cookieValue = decodeURIComponent(
    startCookie.split(";")[0]!.split("=").slice(1).join("="),
  );

  const callbackResponse = response();
  await controller.completeOidc(
    {
      headers: {
        cookie: `rdps_oidc_transaction=${encodeURIComponent(cookieValue)}`,
      },
      query: {
        code: "one-time-code",
        state: transaction.state,
        iss: env.OIDC_ISSUER,
      },
    },
    callbackResponse,
  );
  assert.equal(
    callbackResponse.location,
    "https://admin.example.test/?oidc=linked",
  );
  const callbackCookies = callbackResponse.headers.get("Set-Cookie");
  assert.equal(typeof callbackCookies, "string");
  assert.match(
    callbackCookies as string,
    /^rdps_oidc_transaction=;.*Max-Age=0/,
  );
});
