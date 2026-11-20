import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const bashPath =
  process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const digest = (value) => `sha256:${value.repeat(64)}`;
const manifestDirectory = mkdtempSync(
  path.join(os.tmpdir(), "rdps-preflight-manifest-"),
);
const manifestPath = path.join(
  manifestDirectory,
  "rdps-production-images.json",
);
const validEnvironment = {
  RDPS_RELEASE_MANIFEST: manifestPath,
  RDPS_IMAGE_TAG: "v1.2.3",
  RDPS_GHCR_OWNER: "example",
  POSTGRES_DB: "rdps",
  POSTGRES_USER: "rdps",
  POSTGRES_PASSWORD: "synthetic-postgres-password-32-bytes",
  POSTGRES_EXPORTER_USER: "rdps_exporter",
  POSTGRES_EXPORTER_PASSWORD: "synthetic-exporter-password-32-bytes",
  DATABASE_URL:
    "postgresql://rdps:synthetic-password@postgres.production.example.test:5432/rdps?sslmode=require",
  RESTIC_REPOSITORY: "s3:https://backup.example.test/rdps/production",
  RESTIC_PASSWORD: "synthetic-restic-repository-password-with-entropy",
  RDPS_BACKUP_METRICS_FILE:
    "/var/lib/node_exporter/textfile_collector/rdps-backup.prom",
  RDPS_BACKUP_EXPECTED_INTERVAL_SECONDS: "86400",
  RDPS_BACKUP_METRICS_FILE:
    "/var/lib/node_exporter/textfile_collector/rdps-backup.prom",
  RDPS_BACKUP_EXPECTED_INTERVAL_SECONDS: "86400",
  REDIS_PASSWORD: "synthetic-redis-password-32-bytes",
  REDIS_URL:
    "redis://:synthetic-redis-password-32-bytes@redis.production.example.test:6379",
  JWT_ACCESS_SECRET: "synthetic-jwt-access-secret-32-bytes",
  BOOTSTRAP_SECRET: "synthetic-bootstrap-secret-32-bytes",
  GITHUB_WEBHOOK_SECRET: "synthetic-github-webhook-secret-32-bytes",
  DEPLOYMENT_WEBHOOK_SECRET: "synthetic-deployment-webhook-secret-32-bytes",
  RDPS_WORKER_SHARED_SECRET: "synthetic-worker-shared-secret-32-bytes",
  NOTIFICATION_WORKER_SECRET: "synthetic-notification-secret-32-bytes",
  PUBLIC_BASE_URL: "https://releases.example.test",
  WEB_BASE_URL: "https://admin.example.test",
  RDPS_ALERT_WEBHOOK_URL: "https://alerts.example.test/rdps",
  RDPS_PRODUCTION_API_HEALTH_URL:
    "https://api.production.example.test/api/v1/health/ready",
  RDPS_PRODUCTION_WEB_HEALTH_URL:
    "https://releases.production.example.test/healthz",
  RDPS_PRODUCTION_PUBLIC_URL: "https://releases.production.example.test/",
  RDPS_PRODUCTION_SITEMAP_URL:
    "https://releases.production.example.test/sitemap.xml",
  RDPS_PRODUCTION_ADMIN_URL: "https://admin.production.example.test/",
  CLAMAV_IMAGE: `ghcr.io/example/clamav@${digest("a")}`,
  CLAMAV_IMAGE_REPOSITORY: "ghcr.io/example/clamav",
  RDPS_API_IMAGE: `ghcr.io/example/rdps-api@${digest("b")}`,
  RDPS_WORKER_IMAGE: `ghcr.io/example/rdps-worker@${digest("c")}`,
  RDPS_MIGRATE_IMAGE: `ghcr.io/example/rdps-migrate@${digest("d")}`,
  RDPS_WEB_IMAGE: `ghcr.io/example/rdps-web@${digest("e")}`,
  RDPS_ALERTMANAGER_IMAGE: `ghcr.io/example/rdps-alertmanager@${digest("f")}`,
  POSTGRES_IMAGE: `docker.io/library/postgres@${digest("1")}`,
  REDIS_IMAGE: `docker.io/library/redis@${digest("2")}`,
  PROMETHEUS_IMAGE: `quay.io/prometheus/prometheus@${digest("3")}`,
  POSTGRES_EXPORTER_IMAGE: `quay.io/prometheuscommunity/postgres-exporter@${digest("4")}`,
  REDIS_EXPORTER_IMAGE: `ghcr.io/oliver006/redis_exporter@${digest("5")}`,
  BLACKBOX_EXPORTER_IMAGE: `quay.io/prometheus/blackbox-exporter@${digest("6")}`,
  NODE_EXPORTER_IMAGE: `quay.io/prometheus/node-exporter@${digest("7")}`,
};

function writeManifest(overrides = {}) {
  const images = Object.fromEntries(
    ["api", "worker", "migrate", "web", "alertmanager"].map((name) => [
      name,
      validEnvironment[`RDPS_${name.toUpperCase()}_IMAGE`],
    ]),
  );
  writeFileSync(
    manifestPath,
    JSON.stringify({
      release_tag: "v1.2.3",
      source_commit: "a".repeat(40),
      images,
      ...overrides,
    }),
  );
}

function runPreflight(overrides = {}) {
  writeManifest();
  const environment = { ...process.env, ...validEnvironment };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete environment[name];
    else environment[name] = value;
  }
  return spawnSync(bashPath, ["scripts/ops/production-preflight.sh"], {
    cwd: projectRoot,
    env: environment,
    encoding: "utf8",
  });
}

after(() => rmSync(manifestDirectory, { recursive: true, force: true }));

test("production preflight accepts complete digest-pinned image references", () => {
  const result = runPreflight();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Compose validation passed/);
});

test("production preflight requires a complete manifest matching tag and runtime image overrides", () => {
  const wrongTag = runPreflight({ RDPS_IMAGE_TAG: "v9.9.9" });
  assert.equal(wrongTag.status, 64);
  assert.match(wrongTag.stderr, /RDPS_RELEASE_MANIFEST/);

  const wrongDigest = runPreflight({
    RDPS_API_IMAGE: `ghcr.io/example/rdps-api@${digest("9")}`,
  });
  assert.equal(wrongDigest.status, 64);
  assert.match(wrongDigest.stderr, /RDPS_API_IMAGE.*RDPS_RELEASE_MANIFEST/);

  const missingManifest = runPreflight({ RDPS_RELEASE_MANIFEST: undefined });
  assert.equal(missingManifest.status, 64);
  assert.match(missingManifest.stderr, /RDPS_RELEASE_MANIFEST/);

  writeManifest({ source_commit: "not-a-commit" });
  const malformed = spawnSync(
    bashPath,
    ["scripts/ops/production-preflight.sh"],
    {
      cwd: projectRoot,
      env: { ...process.env, ...validEnvironment },
      encoding: "utf8",
    },
  );
  assert.equal(malformed.status, 64);
  assert.match(malformed.stderr, /RDPS_RELEASE_MANIFEST/);
});

test("production preflight rejects a missing or mutable ClamAV image", () => {
  for (const clamavImage of [undefined, "clamav/clamav:1.5.4"]) {
    const result = runPreflight({ CLAMAV_IMAGE: clamavImage });
    assert.equal(result.status, 64);
    assert.match(result.stderr, /CLAMAV_IMAGE/);
  }
});

test("production preflight rejects mutable RDPS runtime and migration images", () => {
  const imageVariables = [
    "RDPS_API_IMAGE",
    "RDPS_WORKER_IMAGE",
    "RDPS_MIGRATE_IMAGE",
    "RDPS_WEB_IMAGE",
    "RDPS_ALERTMANAGER_IMAGE",
  ];
  for (const name of imageVariables) {
    const result = runPreflight({ [name]: "ghcr.io/example/rdps:latest" });
    assert.equal(result.status, 64, `${name} must be rejected`);
    assert.match(result.stderr, new RegExp(name));
  }
});

test("production preflight requires digest-pinned infrastructure images", () => {
  for (const name of [
    "POSTGRES_IMAGE",
    "REDIS_IMAGE",
    "PROMETHEUS_IMAGE",
    "POSTGRES_EXPORTER_IMAGE",
    "REDIS_EXPORTER_IMAGE",
    "BLACKBOX_EXPORTER_IMAGE",
  ]) {
    const result = runPreflight({ [name]: "postgres:17-alpine" });
    assert.equal(result.status, 64, `${name} must be rejected`);
    assert.match(result.stderr, new RegExp(name));
  }
});

test("production preflight requires a digest-pinned node exporter", () => {
  for (const image of [undefined, "prom/node-exporter:v1.9.1"]) {
    const result = runPreflight({ NODE_EXPORTER_IMAGE: image });
    assert.equal(result.status, 64);
    assert.match(result.stderr, /NODE_EXPORTER_IMAGE/);
  }
});

test("production preflight requires HTTPS smoke-check URLs before rollout", () => {
  const urlVariables = [
    "RDPS_PRODUCTION_API_HEALTH_URL",
    "RDPS_PRODUCTION_WEB_HEALTH_URL",
    "RDPS_PRODUCTION_PUBLIC_URL",
    "RDPS_PRODUCTION_SITEMAP_URL",
    "RDPS_PRODUCTION_ADMIN_URL",
  ];

  for (const name of urlVariables) {
    const missing = runPreflight({ [name]: undefined });
    assert.equal(missing.status, 64);
    assert.match(missing.stderr, new RegExp(name));

    const insecure = runPreflight({
      [name]: "http://production.example.test/",
    });
    assert.equal(insecure.status, 64);
    assert.match(insecure.stderr, new RegExp(name));
  }
});

test("production preflight requires an S3 Restic repository and strong repository password", () => {
  for (const [name, value] of [
    ["RESTIC_REPOSITORY", undefined],
    ["RESTIC_REPOSITORY", "/var/backups/rdps"],
    ["RESTIC_PASSWORD", undefined],
    ["RESTIC_PASSWORD", "too-short"],
  ]) {
    const result = runPreflight({ [name]: value });
    assert.equal(result.status, 64, `${name} value must be rejected`);
    assert.match(result.stderr, new RegExp(name));
  }
});

test("production preflight validates the Node Exporter backup metrics path and cadence", () => {
  for (const [name, value] of [
    ["RDPS_BACKUP_METRICS_FILE", undefined],
    ["RDPS_BACKUP_METRICS_FILE", "/tmp/rdps-backup.prom"],
    ["RDPS_BACKUP_EXPECTED_INTERVAL_SECONDS", undefined],
    ["RDPS_BACKUP_EXPECTED_INTERVAL_SECONDS", "0"],
    ["RDPS_BACKUP_EXPECTED_INTERVAL_SECONDS", "daily"],
  ]) {
    const result = runPreflight({ [name]: value });
    assert.equal(result.status, 64, `${name} value must be rejected`);
    assert.match(result.stderr, new RegExp(name));
  }
});

test("production preflight binds RDPS and ClamAV digests to their approved repositories", () => {
  const wrongRdpsOwner = runPreflight({
    RDPS_API_IMAGE: `ghcr.io/other/rdps-api@${digest("b")}`,
  });
  assert.equal(wrongRdpsOwner.status, 64);
  assert.match(wrongRdpsOwner.stderr, /RDPS_API_IMAGE.*RDPS_GHCR_OWNER/);

  const wrongClamavRepository = runPreflight({
    CLAMAV_IMAGE: `ghcr.io/other/clamav@${digest("a")}`,
  });
  assert.equal(wrongClamavRepository.status, 64);
  assert.match(
    wrongClamavRepository.stderr,
    /CLAMAV_IMAGE.*CLAMAV_IMAGE_REPOSITORY/,
  );
});
