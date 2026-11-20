import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { afterEach, test } from "node:test";
import { OpenIdClientProtocol } from "./oidc.protocol";

const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = keyPair.publicKey.export({ format: "jwk" });
const keyId = "rdps-test-signing-key";
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

function makeIdToken(
  claims: Record<string, unknown>,
  signingKey = keyPair.privateKey,
) {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT", kid: keyId }),
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const input = `${header}.${payload}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), signingKey).toString("base64url")}`;
}

async function startProvider(
  options: {
    claims?: (expected: Record<string, unknown>) => Record<string, unknown>;
    signingKey?: typeof keyPair.privateKey;
  } = {},
) {
  let authorizationParams: URLSearchParams | null = null;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    if (url.pathname === "/.well-known/openid-configuration") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          issuer: issuer,
          authorization_endpoint: `${issuer}authorize`,
          token_endpoint: `${issuer}token`,
          jwks_uri: `${issuer}jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: ["client_secret_basic"],
          code_challenge_methods_supported: ["S256"],
          authorization_response_iss_parameter_supported: true,
        }),
      );
      return;
    }
    if (url.pathname === "/jwks") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          keys: [{ ...publicJwk, kid: keyId, use: "sig", alg: "RS256" }],
        }),
      );
      return;
    }
    if (url.pathname === "/authorize") {
      authorizationParams = url.searchParams;
      response.writeHead(302, {
        location: authorizationParams.get("redirect_uri") ?? "/",
      });
      response.end();
      return;
    }
    if (url.pathname === "/token") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const form = new URLSearchParams(body);
      const verifier = form.get("code_verifier") ?? "";
      const challenge = createHash("sha256")
        .update(verifier)
        .digest("base64url");
      if (
        form.get("code") !== "valid-code" ||
        challenge !== authorizationParams?.get("code_challenge")
      ) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      const expected = {
        iss: issuer,
        sub: "idp-subject-1",
        aud: "rdps-test-client",
        iat: now,
        exp: now + 300,
        nonce: authorizationParams?.get("nonce"),
        email: "sso@example.test",
        email_verified: true,
      };
      const claims = options.claims ? options.claims(expected) : expected;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          access_token: "provider-access-token",
          token_type: "Bearer",
          expires_in: 300,
          id_token: makeIdToken(claims, options.signingKey),
        }),
      );
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test provider did not bind a TCP port");
  const issuer = `http://localhost:${address.port}/`;
  return {
    issuer,
    getAuthorizationParams: () => authorizationParams,
    setAuthorizationParams: (params: URLSearchParams) => {
      authorizationParams = params;
    },
  };
}

async function runProtocol(options?: Parameters<typeof startProvider>[0]) {
  const provider = await startProvider(options);
  const protocol = new OpenIdClientProtocol();
  const settings = {
    issuer: provider.issuer,
    clientId: "rdps-test-client",
    clientSecret: "rdps-test-secret",
    callbackUrl: `${provider.issuer}callback`,
  };
  const transaction = await protocol.createTransaction();
  const authorizationUrl = new URL(
    await protocol.authorizationUrl(settings, transaction),
  );
  provider.setAuthorizationParams(authorizationUrl.searchParams);
  const callback = new URL(settings.callbackUrl);
  callback.searchParams.set("code", "valid-code");
  callback.searchParams.set("state", transaction.state);
  callback.searchParams.set("iss", provider.issuer);
  return {
    protocol,
    settings,
    transaction,
    authorizationUrl,
    callback,
    provider,
  };
}

test("discovers provider metadata and validates signed ID token with PKCE, state, and nonce", async () => {
  const flow = await runProtocol();
  assert.equal(
    flow.authorizationUrl.searchParams.get("code_challenge_method"),
    "S256",
  );
  assert.ok(flow.authorizationUrl.searchParams.get("code_challenge"));
  const claims = await flow.protocol.exchange(
    flow.settings,
    flow.callback.toString(),
    flow.transaction,
  );
  assert.equal(claims.iss, flow.settings.issuer);
  assert.equal(claims.sub, "idp-subject-1");
});

test("rejects a validly signed ID token with the wrong nonce", async () => {
  const flow = await runProtocol({
    claims: (claims) => ({ ...claims, nonce: "wrong-nonce" }),
  });
  await assert.rejects(
    flow.protocol.exchange(
      flow.settings,
      flow.callback.toString(),
      flow.transaction,
    ),
  );
});

test("rejects an ID token with an issuer or audience different from discovery/client settings", async () => {
  for (const claims of [
    (value: Record<string, unknown>) => ({
      ...value,
      iss: "http://attacker.example.test/",
    }),
    (value: Record<string, unknown>) => ({ ...value, aud: "another-client" }),
  ]) {
    const flow = await runProtocol({ claims });
    await assert.rejects(
      flow.protocol.exchange(
        flow.settings,
        flow.callback.toString(),
        flow.transaction,
      ),
    );
  }
});

test("rejects an authorization response with an RFC 9207 issuer mismatch", async () => {
  const flow = await runProtocol();
  flow.callback.searchParams.set("iss", "http://attacker.example.test/");
  await assert.rejects(
    flow.protocol.exchange(
      flow.settings,
      flow.callback.toString(),
      flow.transaction,
    ),
  );
});

test("rejects an ID token signed by a key absent from the discovered JWKS", async () => {
  const otherKey = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  }).privateKey;
  const flow = await runProtocol({ signingKey: otherKey });
  await assert.rejects(
    flow.protocol.exchange(
      flow.settings,
      flow.callback.toString(),
      flow.transaction,
    ),
  );
});

test("rejects an expired signed ID token", async () => {
  const flow = await runProtocol({
    claims: (claims) => ({
      ...claims,
      exp: Math.floor(Date.now() / 1000) - 600,
    }),
  });
  await assert.rejects(
    flow.protocol.exchange(
      flow.settings,
      flow.callback.toString(),
      flow.transaction,
    ),
  );
});
