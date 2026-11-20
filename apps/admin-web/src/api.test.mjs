import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "./api-client.ts";

test("sends bearer authorization and JSON for a mutation", async () => {
  let seen;
  const api = createApiClient(
    "http://rdps.test/api/v1/",
    () => "session-token",
    async (url, init) => {
      seen = { url, init };
      return new Response('{"id":"release-1"}', { status: 201 });
    },
  );

  const release = await api.request("/internal/projects/project-1/releases", {
    method: "POST",
    body: { version: "1.2.0", title: "Release 1.2.0" },
    headers: { "Idempotency-Key": "release-request-123" },
  });

  assert.deepEqual(release, { id: "release-1" });
  assert.equal(
    seen.url,
    "http://rdps.test/api/v1/internal/projects/project-1/releases",
  );
  assert.equal(seen.init.headers.Authorization, "Bearer session-token");
  assert.equal(seen.init.credentials, "include");
  assert.equal(seen.init.headers["Content-Type"], "application/json");
  assert.equal(seen.init.headers["Idempotency-Key"], "release-request-123");
  assert.equal(seen.init.body, '{"version":"1.2.0","title":"Release 1.2.0"}');
});

test("surfaces a useful API message when the server rejects a request", async () => {
  const api = createApiClient(
    "http://rdps.test/api/v1",
    () => null,
    async () =>
      new Response('{"statusCode":409,"message":"Slug already exists"}', {
        status: 409,
      }),
  );

  await assert.rejects(
    api.request("/internal/projects", { method: "POST", body: {} }),
    (error) => error.message === "Slug already exists" && error.status === 409,
  );
});

test("does not attach an authorization header to a signed-out request", async () => {
  let seen;
  const api = createApiClient(
    "http://rdps.test/api/v1",
    () => null,
    async (_url, init) => {
      seen = init;
      return new Response("{}", { status: 200 });
    },
  );

  await api.request("/internal/auth/login", {
    method: "POST",
    body: { email: "operator@example.test", password: "correct horse" },
  });

  assert.equal(seen.headers.Authorization, undefined);
  assert.equal(seen.credentials, "include");
});

test("refreshes an expired access token with the HttpOnly cookie and retries once", async () => {
  const calls = [];
  let token = "expired-token";
  const api = createApiClient(
    "http://rdps.test/api/v1",
    () => token,
    async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/internal/projects")) {
        if (init.headers.Authorization === "Bearer expired-token") {
          return new Response('{"message":"Unauthorized"}', { status: 401 });
        }
        return new Response('[{"id":"project-1"}]', { status: 200 });
      }
      if (url.endsWith("/internal/auth/refresh")) {
        return new Response('{"accessToken":"rotated-token"}', { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
    (nextToken) => {
      token = nextToken;
    },
  );

  assert.deepEqual(await api.request("/internal/projects"), [
    { id: "project-1" },
  ]);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].url, "http://rdps.test/api/v1/internal/auth/refresh");
  assert.equal(calls[1].init.credentials, "include");
  assert.equal(calls[2].init.headers.Authorization, "Bearer rotated-token");
  assert.equal(token, "rotated-token");
});

test("does not recursively refresh a failed refresh request", async () => {
  const paths = [];
  const api = createApiClient(
    "http://rdps.test/api/v1",
    () => "expired-token",
    async (url) => {
      paths.push(url);
      return new Response('{"message":"Unauthorized"}', { status: 401 });
    },
  );

  await assert.rejects(api.request("/internal/projects"), { status: 401 });
  assert.equal(
    paths.filter((path) => path.endsWith("/internal/auth/refresh")).length,
    1,
  );
});

test("passes multipart form data through without JSON encoding or setting its boundary header", async () => {
  let seen;
  const form = new FormData();
  form.set(
    "file",
    new Blob(["private data"], { type: "text/plain" }),
    "report.txt",
  );
  const api = createApiClient(
    "https://rdps.test/api/v1",
    () => "token",
    async (_url, init) => {
      seen = init;
      return new Response("{}", { status: 201 });
    },
  );

  await api.request("/internal/upload", { method: "POST", body: form });
  assert.equal(seen.body, form);
  assert.equal(seen.headers["Content-Type"], undefined);
  assert.equal(seen.credentials, "include");
});

test("downloads private files as blobs and extracts the UTF-8 attachment filename", async () => {
  const api = createApiClient(
    "https://rdps.test/api/v1",
    () => "token",
    async () =>
      new Response("private file", {
        status: 200,
        headers: {
          "Content-Type": "text/plain",
          "Content-Disposition":
            "attachment; filename*=UTF-8''release%20notes.txt",
        },
      }),
  );
  const result = await api.download("/internal/files/1");
  assert.equal(result.filename, "release notes.txt");
  assert.equal(await result.blob.text(), "private file");
});
