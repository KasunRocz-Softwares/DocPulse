import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const bashPath =
  process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const snapshotId = "a".repeat(64);

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "rdps-production-backup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const backupRoot = path.join(root, "backups");
  const bin = path.join(root, "bin");
  const log = path.join(root, "commands.log");
  const attachmentArchive = path.join(root, "empty-attachments.tar.gz");
  const metricsDirectory = path.join(root, "metrics");
  const metricsFile = path.join(metricsDirectory, "rdps-backup.prom");
  await mkdir(backupRoot);
  await mkdir(bin);
  await mkdir(metricsDirectory);
  await writeFile(attachmentArchive, gzipSync(Buffer.alloc(1024)));
  const commands = {
    docker: `#!/usr/bin/env bash
set -eu
printf 'docker %s\\n' "$*" >> "$RDPS_TEST_LOG"
if [[ "$1" == compose && "$*" == *"--entrypoint pg_restore"* ]]; then exit 0; fi
if [[ "$1" == compose && "$*" == *"--entrypoint sh"* ]]; then printf 'synthetic-postgres-archive'; exit 0; fi
if [[ "$1" == compose && "$*" == *"ps -q postgres"* ]]; then printf 'synthetic-postgres-id\n'; exit 0; fi
if [[ "$1" == compose && "$*" == *"ps -q redis"* ]]; then printf 'synthetic-redis-id\n'; exit 0; fi
if [[ "$1" == inspect && "$*" == *"State.Status"* ]]; then
  if [[ "${"${RDPS_TEST_POSTGRES_UNHEALTHY:-0}"}" == 1 && "$*" == *synthetic-postgres-id* ]]; then
    printf 'running unhealthy\n'
  else
    printf 'running healthy\n'
  fi
  exit 0
fi
if [[ "$1" == volume && "$*" == *"com.docker.compose.project"* ]]; then printf '%s\\n' rdps-production; exit 0; fi
if [[ "$1" == volume && "$*" == *"com.docker.compose.volume"* ]]; then printf '%s\\n' rdps_production_attachments; exit 0; fi
if [[ "$1" == run ]]; then cat "$RDPS_TEST_ATTACHMENT_ARCHIVE"; exit 0; fi
exit 0
`,
    sha256sum: `#!/usr/bin/env bash
set -eu
if [[ "$1" == --check ]]; then exit 0; fi
file=${"${@: -1}"}
printf '%064d  %s\\n' 0 "$file"
`,
    pg_restore: "#!/usr/bin/env bash\nexit 0\n",
    tar: "#!/usr/bin/env bash\nexit 0\n",
    restic: `#!/usr/bin/env bash
set -eu
printf 'restic %s\\n' "$*" >> "$RDPS_TEST_LOG"
if [[ "$1" == backup ]]; then
  [[ "${"${RDPS_TEST_RESTIC_FAIL:-0}"}" != 1 ]] || exit 77
  printf '{"message_type":"summary","snapshot_id":"${snapshotId}"}\\n'
elif [[ "$1" == forget ]]; then
  [[ "${"${RDPS_TEST_RETENTION_FAIL:-0}"}" != 1 ]] || exit 78
fi
`,
    jq: `#!/usr/bin/env bash
printf '%s\\n' '${snapshotId}'
`,
    flock: `#!/usr/bin/env bash
printf 'flock %s\\n' "$*" >> "$RDPS_TEST_LOG"
[[ "${"${RDPS_TEST_LOCK_FAIL:-0}"}" != 1 ]]
`,
  };
  for (const [name, content] of Object.entries(commands)) {
    const commandPath = path.join(bin, name);
    await writeFile(commandPath, content);
    await chmod(commandPath, 0o755);
  }
  const environment = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    RDPS_BACKUP_DIRECTORY: backupRoot,
    RDPS_BACKUP_METRICS_FILE: metricsFile,
    RDPS_BACKUP_EXPECTED_INTERVAL_SECONDS: "86400",
    RDPS_TEST_LOG: log,
    RDPS_TEST_ATTACHMENT_ARCHIVE: attachmentArchive,
    RESTIC_REPOSITORY: "s3:https://objects.example.test/rdps/backups",
    RESTIC_PASSWORD: "synthetic-restic-password-with-enough-entropy",
    DATABASE_URL:
      "postgresql://rdps:synthetic-password@postgres:5432/rdps?sslmode=require",
    RDPS_ATTACHMENTS_VOLUME_NAME: "rdps-production-attachments",
    COMPOSE_PROJECT_NAME: "rdps-production",
  };
  return { root, backupRoot, bin, log, metricsFile, environment };
}

function run(environment, overrides = {}, args = []) {
  return spawnSync(bashPath, ["scripts/ops/backup-production.sh", ...args], {
    cwd: projectRoot,
    env: { ...environment, ...overrides },
    encoding: "utf8",
  });
}

test("production backup creates a unique coordinated bundle and records the off-site snapshot", async (t) => {
  const f = await fixture(t);
  const result = run(f.environment);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const entries = await readdir(f.backupRoot, { withFileTypes: true });
  const runDirectories = entries.filter((entry) => entry.isDirectory());
  assert.equal(runDirectories.length, 1);
  const runDirectory = path.join(f.backupRoot, runDirectories[0].name);
  const files = await readdir(runDirectory);
  assert.equal(files.filter((file) => file.endsWith(".dump")).length, 1);
  assert.equal(files.filter((file) => file.endsWith(".tar.gz")).length, 1);
  const manifest = await readFile(
    path.join(runDirectory, "manifest.txt"),
    "utf8",
  );
  assert.match(manifest, new RegExp(`^snapshot_id=${snapshotId}$`, "m"));
  assert.match(manifest, /^retention_status=applied$/m);
  assert.match(manifest, /^postgres_sha256=[a-f0-9]{64}$/m);
  assert.match(manifest, /^attachments_sha256=[a-f0-9]{64}$/m);
  const jobStatus = await readFile(
    path.join(runDirectory, "job-status.txt"),
    "utf8",
  );
  assert.match(jobStatus, /^status=completed$/m);
  const metrics = await readFile(f.metricsFile, "utf8");
  assert.match(metrics, /^rdps_backup_last_run_success 1$/m);
  assert.match(
    metrics,
    /^rdps_backup_last_success_timestamp_seconds [1-9][0-9]*$/m,
  );
  assert.match(metrics, /^rdps_backup_retention_success 1$/m);
  assert.match(metrics, /^rdps_backup_expected_interval_seconds 86400$/m);
  const calls = await readFile(f.log, "utf8");
  assert.ok(calls.indexOf("docker compose") < calls.indexOf("docker volume"));
  assert.ok(calls.indexOf("restic backup") < calls.indexOf("restic forget"));
  assert.match(calls, /--tag rdps/);
  assert.match(calls, /docker compose .*ps -q postgres/);
  assert.match(calls, /docker compose .*ps -q redis/);
  assert.match(calls, /docker inspect .*State\.Status/);
  assert.doesNotMatch(calls, /docker compose .* up /);
  assert.match(calls, /--env DATABASE_URL/);
  assert.match(calls, /PGDATABASE=\"\$DATABASE_URL\"/);
  assert.doesNotMatch(calls, /PGDATABASE=\"\$POSTGRES_DB\"/);
  assert.doesNotMatch(manifest, /synthetic-restic-password/);
});

test("production backup refuses an unhealthy running database before archive or upload", async (t) => {
  const f = await fixture(t);
  const result = run(f.environment, { RDPS_TEST_POSTGRES_UNHEALTHY: "1" });
  assert.notEqual(result.status, 0);
  const calls = await readFile(f.log, "utf8");
  assert.match(calls, /ps -q postgres/);
  assert.doesNotMatch(calls, /restic backup/);
  const runDirectories = (
    await readdir(f.backupRoot, { withFileTypes: true })
  ).filter((entry) => entry.isDirectory());
  assert.equal(runDirectories.length, 1);
  const metrics = await readFile(f.metricsFile, "utf8");
  assert.match(metrics, /^rdps_backup_last_run_success 0$/m);
});

test("production backup preserves local artifacts and skips retention when upload fails", async (t) => {
  const f = await fixture(t);
  const result = run(f.environment, { RDPS_TEST_RESTIC_FAIL: "1" });
  assert.notEqual(result.status, 0);
  const runDirectories = (
    await readdir(f.backupRoot, { withFileTypes: true })
  ).filter((entry) => entry.isDirectory());
  assert.equal(runDirectories.length, 1);
  const files = await readdir(path.join(f.backupRoot, runDirectories[0].name));
  assert.ok(files.some((file) => file.endsWith(".dump")));
  assert.ok(files.some((file) => file.endsWith(".tar.gz")));
  const jobStatus = await readFile(
    path.join(f.backupRoot, runDirectories[0].name, "job-status.txt"),
    "utf8",
  );
  assert.match(jobStatus, /^status=failed$/m);
  const metrics = await readFile(f.metricsFile, "utf8");
  assert.match(metrics, /^rdps_backup_last_run_success 0$/m);
  assert.match(metrics, /^rdps_backup_last_success_timestamp_seconds 0$/m);
  assert.match(metrics, /^rdps_backup_retention_success 0$/m);
  const calls = await readFile(f.log, "utf8");
  assert.match(calls, /restic backup/);
  assert.doesNotMatch(calls, /restic forget/);
});

test("production backup lock prevents a second local or deployment run", async (t) => {
  const f = await fixture(t);
  const result = run(f.environment, { RDPS_TEST_LOCK_FAIL: "1" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already running|lock/i);
  const calls = await readFile(f.log, "utf8");
  assert.match(calls, /^flock /m);
  assert.doesNotMatch(calls, /docker compose/);
  const metrics = await readFile(f.metricsFile, "utf8");
  assert.match(metrics, /^rdps_backup_last_run_success 0$/m);
  assert.match(metrics, /^rdps_backup_last_upload_success 0$/m);
});

test("deployment-owned lock is reused without acquiring a nested backup lock", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.backupRoot, ".rdps-backup.lock"), "");
  const result = run(f.environment, {}, ["--lock-held"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = await readFile(f.log, "utf8");
  assert.doesNotMatch(calls, /^flock /m);
  assert.match(calls, /restic backup/);
});

test("systemd timer runs the hardened host backup service on a persistent UTC schedule", async () => {
  const [service, timer] = await Promise.all([
    readFile(
      new URL("../ops/systemd/rdps-backup.service", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../ops/systemd/rdps-backup.timer", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(service, /^Type=oneshot$/m);
  assert.match(service, /^User=rdps$/m);
  assert.match(service, /^SupplementaryGroups=docker$/m);
  assert.match(service, /^EnvironmentFile=\/etc\/rdps\/production\.env$/m);
  assert.match(service, /^UMask=0077$/m);
  assert.match(service, /^TimeoutStartSec=6h$/m);
  assert.doesNotMatch(service, /^TimeoutStartSec=infinity$/m);
  assert.match(service, /^NoNewPrivileges=yes$/m);
  assert.match(service, /scripts\/ops\/backup-production\.sh/);
  assert.match(timer, /^OnCalendar=\*-\*-\* 02:15:00 UTC$/m);
  assert.match(timer, /^Persistent=true$/m);
  assert.match(timer, /^Unit=rdps-backup\.service$/m);
});

test("failed uploads preserve the timestamp of the most recent successful snapshot", async (t) => {
  const f = await fixture(t);
  const first = run(f.environment);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const previousMetrics = await readFile(f.metricsFile, "utf8");
  const previousSuccess = Number(
    previousMetrics.match(
      /^rdps_backup_last_success_timestamp_seconds (\d+)$/m,
    )?.[1],
  );
  assert.ok(previousSuccess > 0);

  const second = run(f.environment, { RDPS_TEST_RESTIC_FAIL: "1" });
  assert.notEqual(second.status, 0);
  const metrics = await readFile(f.metricsFile, "utf8");
  assert.match(metrics, /^rdps_backup_last_run_success 0$/m);
  assert.match(
    metrics,
    new RegExp(
      `^rdps_backup_last_success_timestamp_seconds ${previousSuccess}$`,
      "m",
    ),
  );
});

test("uploaded snapshots remain marked successful when retention pruning fails", async (t) => {
  const f = await fixture(t);
  const result = run(f.environment, { RDPS_TEST_RETENTION_FAIL: "1" });
  assert.notEqual(result.status, 0);
  const metrics = await readFile(f.metricsFile, "utf8");
  assert.match(metrics, /^rdps_backup_last_run_success 0$/m);
  assert.match(
    metrics,
    /^rdps_backup_last_success_timestamp_seconds [1-9][0-9]*$/m,
  );
  assert.match(metrics, /^rdps_backup_retention_success 0$/m);
});
