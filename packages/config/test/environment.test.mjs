import assert from "node:assert/strict";
import test from "node:test";

import { applyEnvironment, parseEnvironment } from "../dist/index.js";

test("development config applies safe local defaults", () => {
  const config = parseEnvironment({ NODE_ENV: "development" });

  assert.equal(config.apiPort, 3001);
  assert.equal(config.publicApiRateLimit, 120);
  assert.equal(config.publicApiRateWindowSeconds, 60);
  assert.deepEqual(config.trustedProxyIps, []);
  assert.equal(config.workerConcurrency, 5);
  assert.equal(
    config.databaseUrl,
    "postgresql://rdps:rdps_dev_only@localhost:5432/rdps?schema=public",
  );
  assert.equal(
    config.jwtAccessSecret,
    "development-only-access-secret-change-me",
  );
});

test("entrypoint environment application materializes typed defaults for legacy consumers", () => {
  const target = { NODE_ENV: "test" };
  const config = applyEnvironment(target);
  assert.equal(config.nodeEnv, "test");
  assert.equal(target.DATABASE_URL, config.databaseUrl);
  assert.equal(target.REDIS_URL, config.redisUrl);
  assert.equal(target.JWT_ACCESS_SECRET, config.jwtAccessSecret);
  assert.equal(target.WORKER_CONCURRENCY, "5");
});

test("production config requires strong application and integration secrets", () => {
  assert.throws(
    () => parseEnvironment({ NODE_ENV: "production" }),
    /DATABASE_URL, REDIS_URL, JWT_ACCESS_SECRET, BOOTSTRAP_SECRET/,
  );
});

test("production config accepts a complete set of strong secrets", () => {
  const config = parseEnvironment({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://rdps:secret@db:5432/rdps",
    REDIS_URL: "redis://redis:6379",
    JWT_ACCESS_SECRET: "a-random-production-access-secret-123456",
    BOOTSTRAP_SECRET: "a-random-production-bootstrap-secret-123456",
    RDPS_WORKER_SHARED_SECRET: "a-random-production-worker-secret-123456",
    NOTIFICATION_WORKER_SECRET:
      "a-random-production-notification-secret-123456",
    GITHUB_WEBHOOK_SECRET: "a-random-production-github-webhook-secret-123456",
    DEPLOYMENT_WEBHOOK_SECRET:
      "a-random-production-deploy-webhook-secret-123456",
    PUBLIC_BASE_URL: "https://notes.example",
    WEB_BASE_URL: "https://admin.example,https://notes.example",
  });

  assert.equal(config.nodeEnv, "production");
  assert.deepEqual(config.webBaseUrls, [
    "https://admin.example",
    "https://notes.example",
  ]);
});

test("production parser rejects short secrets without echoing their values", () => {
  const values = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://rdps:secret@db:5432/rdps",
    REDIS_URL: "redis://redis:6379",
    JWT_ACCESS_SECRET: "short",
    BOOTSTRAP_SECRET: "also-short",
    RDPS_WORKER_SHARED_SECRET: "worker-secret-that-is-long-enough-123",
    NOTIFICATION_WORKER_SECRET: "notification-secret-long-enough-123",
    GITHUB_WEBHOOK_SECRET: "github-webhook-secret-long-enough-123",
    DEPLOYMENT_WEBHOOK_SECRET: "deployment-webhook-secret-long-enough-123",
  };

  assert.throws(
    () => parseEnvironment(values),
    (error) => {
      assert.match(error.message, /JWT_ACCESS_SECRET/);
      assert.doesNotMatch(error.message, /also-short/);
      return true;
    },
  );
});

test("production parser rejects built-in development secrets even when explicitly supplied", () => {
  const secrets = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://rdps:password@db:5432/rdps",
    REDIS_URL: "redis://redis:6379",
    JWT_ACCESS_SECRET: "development-only-access-secret-change-me",
    BOOTSTRAP_SECRET: "development-only-bootstrap-secret-change-me",
    RDPS_WORKER_SHARED_SECRET: "development-only-worker-secret-change-me",
    NOTIFICATION_WORKER_SECRET:
      "development-only-notification-secret-change-me",
    GITHUB_WEBHOOK_SECRET: "development-only-github-webhook-secret-change-me",
    DEPLOYMENT_WEBHOOK_SECRET:
      "development-only-deployment-webhook-secret-change-me",
    PUBLIC_BASE_URL: "https://notes.example",
    WEB_BASE_URL: "https://admin.example",
  };
  assert.throws(() => parseEnvironment(secrets), /built-in development value/);
});

test("OIDC credentials must be configured as a complete set", () => {
  assert.throws(
    () =>
      parseEnvironment({
        NODE_ENV: "development",
        OIDC_ISSUER: "https://issuer.example",
      }),
    /OIDC_CLIENT_ID/,
  );
});

test("integer settings reject invalid values and URL settings are validated", () => {
  assert.throws(() => parseEnvironment({ API_PORT: "0" }), /API_PORT/);
  const config = parseEnvironment({
    PUBLIC_BASE_URL: "https://notes.example/",
  });
  assert.equal(config.publicBaseUrl, "https://notes.example/");
});

test("public API rate limits are configurable and validated", () => {
  const config = parseEnvironment({
    PUBLIC_API_RATE_LIMIT: "45",
    PUBLIC_API_RATE_WINDOW_SECONDS: "15",
    TRUSTED_PROXY_IPS: "10.0.0.8, 2001:db8::8",
  });

  assert.equal(config.publicApiRateLimit, 45);
  assert.equal(config.publicApiRateWindowSeconds, 15);
  assert.deepEqual(config.trustedProxyIps, ["10.0.0.8", "2001:db8::8"]);
  assert.throws(
    () => parseEnvironment({ PUBLIC_API_RATE_LIMIT: "0" }),
    /PUBLIC_API_RATE_LIMIT/,
  );
  assert.throws(
    () => parseEnvironment({ PUBLIC_API_RATE_WINDOW_SECONDS: "3601" }),
    /PUBLIC_API_RATE_WINDOW_SECONDS/,
  );
  assert.throws(
    () => parseEnvironment({ TRUSTED_PROXY_IPS: "10.0.0.0/8" }),
    /TRUSTED_PROXY_IPS/,
  );
});

test("GitHub App and deployment runner credentials are all-or-nothing", () => {
  assert.throws(
    () => parseEnvironment({ GITHUB_APP_ID: "123" }),
    /GITHUB_APP_SLUG/,
  );
  assert.throws(
    () =>
      parseEnvironment({
        DEPLOYMENT_RUNNER_URL: "https://runner.example/dispatch",
      }),
    /DEPLOYMENT_RUNNER_SIGNING_SECRET/,
  );
});
