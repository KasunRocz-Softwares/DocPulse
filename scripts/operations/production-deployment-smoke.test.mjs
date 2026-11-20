import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = new URL("../../", import.meta.url);
const repositoryPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const bashPath =
  process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";

test("production deployment runs routed and service smoke checks after rollout", async () => {
  const [deploy, smoke, compose] = await Promise.all([
    readFile(
      new URL("scripts/ops/deploy-production.sh", repositoryRoot),
      "utf8",
    ),
    readFile(
      new URL("scripts/ops/production-smoke-check.sh", repositoryRoot),
      "utf8",
    ),
    readFile(new URL("docker-compose.production.yml", repositoryRoot), "utf8"),
  ]);

  assert.match(deploy, /production-smoke-check\.sh/);
  assert.match(deploy, /command -v curl/);
  assert.match(deploy, /command -v jq/);
  assert.match(smoke, /RDPS_PRODUCTION_API_HEALTH_URL/);
  assert.match(smoke, /RDPS_PRODUCTION_PUBLIC_URL/);
  assert.match(smoke, /RDPS_PRODUCTION_SITEMAP_URL/);
  assert.match(smoke, /RDPS_PRODUCTION_ADMIN_URL/);
  assert.match(smoke, /\.checks\.database == "ok"/);
  assert.match(smoke, /<title>RDPS/);
  assert.match(smoke, /https:\/\//);
  assert.match(smoke, /--location/);
  assert.match(smoke, /worker.*prometheus.*alertmanager/s);
  assert.match(smoke, /--slurp/);
  assert.doesNotMatch(smoke, /jq[^\n]*--silent/);
  assert.match(smoke, /--exit-status/);
  assert.match(smoke, /all\(\.\[\]; \.Health == "healthy"\)/);
  assert.match(smoke, /exec --no-TTY alertmanager/);
  assert.match(smoke, /exec --no-TTY prometheus/);
  assert.match(smoke, /activeTargets/);
  assert.match(smoke, /probe_success/);
  assert.match(smoke, /rdps-api"/);
  assert.match(smoke, /pg_up/);
  assert.match(smoke, /redis_up/);
  assert.match(smoke, /rdps_backup_last_run_success/);
  assert.match(smoke, /rdps_backup_last_upload_success/);
  assert.match(smoke, /rdps_backup_retention_success/);
  assert.match(
    smoke,
    /postgres-exporter.*redis-exporter.*rdps-api-health.*rdps-web-health/s,
  );
  assert.match(compose, /worker:[\s\S]*?healthcheck:/);

  const syntax = spawnSync(
    bashPath,
    ["-n", "scripts/ops/production-smoke-check.sh"],
    { cwd: repositoryPath, encoding: "utf8" },
  );
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);
});

test("production deployment completes encrypted backup before database migration", async () => {
  const deploy = await readFile(
    new URL("scripts/ops/deploy-production.sh", repositoryRoot),
    "utf8",
  );
  const backupCall = deploy.indexOf("backup-production.sh");
  const releaseState = deploy.indexOf("release-state.json");
  const migrationCall = deploy.indexOf("run --rm migrate");

  assert.notEqual(
    backupCall,
    -1,
    "deployment invokes the shared backup entrypoint",
  );
  assert.notEqual(migrationCall, -1, "deployment applies migrations");
  assert.ok(
    backupCall < migrationCall,
    "off-site backup completes before migration",
  );
  assert.ok(
    releaseState > backupCall && releaseState < migrationCall,
    "previous runtime image set and verified backup snapshot are recorded before migration",
  );
});

test("production deployment holds the backup lock through the post-rollout smoke gate", async () => {
  const deploy = await readFile(
    new URL("scripts/ops/deploy-production.sh", repositoryRoot),
    "utf8",
  );
  const lockCall = deploy.indexOf("flock --nonblock 9");
  const imagePull = deploy.indexOf(" pull");
  const backupCall = deploy.indexOf("backup-production.sh");
  const migrationCall = deploy.indexOf("run --rm migrate");
  const serviceRollout = deploy.indexOf("up -d --remove-orphans");
  const smokeCheck = deploy.indexOf("production-smoke-check.sh", backupCall);

  assert.ok(lockCall >= 0, "deployment must acquire the shared project lock");
  assert.ok(lockCall < imagePull);
  assert.ok(imagePull < backupCall);
  assert.ok(backupCall < migrationCall);
  assert.ok(migrationCall < serviceRollout);
  assert.ok(serviceRollout < smokeCheck);
  assert.match(deploy, /RDPS_INITIAL_DEPLOYMENT:-NO/);
  assert.match(deploy, /backup-production\.sh" --lock-held/);
  assert.match(deploy, /up --detach --wait postgres redis/);
  assert.match(deploy, /prometheus check config/);
  assert.match(deploy, /--config\.check/);
  assert.match(deploy, /check-config \/tmp\/alertmanager\.yml/);
  assert.match(deploy, /--force-recreate/);
  assert.match(deploy, /no-deps prometheus alertmanager blackbox-exporter/);
});

test("application rollback restores only the prior digest-pinned runtime images under the shared lock", async () => {
  const rollback = await readFile(
    new URL("scripts/ops/rollback-production.sh", repositoryRoot),
    "utf8",
  );
  assert.match(rollback, /flock --nonblock 9/);
  assert.match(rollback, /\.previous_images\.api/);
  assert.match(rollback, /\.previous_images\.worker/);
  assert.match(rollback, /\.previous_images\.web/);
  assert.match(rollback, /\.previous_images\.alertmanager/);
  assert.match(rollback, /restic_snapshot_id == \$snapshot/);
  assert.match(
    rollback,
    /up --detach --wait --no-deps api worker web alertmanager/,
  );
  assert.match(rollback, /production-smoke-check\.sh/);
  assert.doesNotMatch(rollback, /run --rm migrate/);

  const syntax = spawnSync(
    bashPath,
    ["-n", "scripts/ops/rollback-production.sh"],
    {
      cwd: repositoryPath,
      encoding: "utf8",
    },
  );
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);
});
