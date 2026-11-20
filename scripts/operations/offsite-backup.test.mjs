import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
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
  const root = await mkdtemp(path.join(os.tmpdir(), "rdps-offsite-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = path.join(root, "input");
  const bin = path.join(root, "bin");
  await mkdir(input);
  await mkdir(bin);
  const postgres = path.join(input, "rdps-postgres-20261112T000000Z.dump");
  const attachments = path.join(
    input,
    "rdps-attachments-20261112T000000Z.tar.gz",
  );
  await writeFile(postgres, "synthetic postgres archive");
  await writeFile(attachments, gzipSync(Buffer.alloc(1024)));
  for (const archive of [postgres, attachments]) {
    const name = path.basename(archive);
    const bytes = await readFile(archive);
    const digest = createHash("sha256").update(bytes).digest("hex");
    await writeFile(`${archive}.sha256`, `${digest}  ${name}\n`);
  }
  await writeFile(
    path.join(bin, "sha256sum"),
    `#!/usr/bin/env bash
set -eu
if [[ "$1" == --check ]]; then
  sidecar=${"${@: -1}"}
  read -r expected filename < "$sidecar"
  actual=$(node -e 'const fs=require("node:fs");const c=require("node:crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$filename")
  [[ "$actual" == "$expected" ]]
else
  file=${"${@: -1}"}
  actual=$(node -e 'const fs=require("node:fs");const c=require("node:crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$file")
  printf '%s  %s\\n' "$actual" "$(basename -- "$file")"
fi
`,
  );
  await writeFile(
    path.join(bin, "pg_restore"),
    '#!/usr/bin/env bash\n[[ "$1" == --list ]]\n',
  );
  await writeFile(
    path.join(bin, "restic"),
    `#!/usr/bin/env bash
set -eu
[[ -n "${"${RESTIC_REPOSITORY:-}"}" && -n "${"${RESTIC_PASSWORD:-}"}" ]] || exit 91
printf '%s\\n' "$*" >> "$RDPS_RESTIC_LOG"
if [[ "$1" == backup ]]; then
  printf '{"message_type":"summary","snapshot_id":"${snapshotId}"}\\n'
  [[ "${"${RDPS_TEST_RESTIC_FAIL:-0}"}" != 1 ]] || exit 77
elif [[ "$1" == forget ]]; then
  [[ "${"${RDPS_TEST_RETENTION_FAIL:-0}"}" != 1 ]]
fi
`,
  );
  await writeFile(
    path.join(bin, "jq"),
    `#!/usr/bin/env bash
printf '%s\\n' '${snapshotId}'
`,
  );
  for (const name of ["sha256sum", "pg_restore", "restic", "jq"]) {
    await chmod(path.join(bin, name), 0o755);
  }
  const log = path.join(root, "restic.log");
  const environment = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    RESTIC_REPOSITORY: "s3:https://objects.example.test/rdps-backups",
    RESTIC_PASSWORD: "synthetic-test-repository-password",
    RDPS_RESTIC_LOG: log,
  };
  return { root, input, postgres, attachments, log, environment };
}

function run(input, environment, overrides = {}) {
  return spawnSync(bashPath, ["scripts/operations/backup-offsite.sh", input], {
    cwd: projectRoot,
    env: { ...environment, ...overrides },
    encoding: "utf8",
  });
}

test("offsite backup verifies both artifacts before encrypted upload and retention", async (t) => {
  const f = await fixture(t);
  const result = run(f.input, f.environment);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = await readFile(f.log, "utf8");
  assert.match(calls, /backup .*--group-by host .*--tag rdps/);
  assert.match(calls, /rdps-postgres-20261112T000000Z\.dump/);
  assert.match(calls, /rdps-attachments-20261112T000000Z\.tar\.gz/);
  assert.match(calls, /rdps-postgres-20261112T000000Z\.dump\.sha256/);
  assert.match(calls, /rdps-attachments-20261112T000000Z\.tar\.gz\.sha256/);
  assert.match(
    calls,
    /forget .*--group-by host .*--host rdps-production .*--tag rdps .*--keep-daily 7 .*--keep-weekly 4 .*--keep-monthly 12 .*--prune/,
  );
  assert.ok(calls.indexOf("backup ") < calls.indexOf("forget "));
  const manifest = await readFile(path.join(f.input, "manifest.txt"), "utf8");
  assert.match(manifest, new RegExp(`^snapshot_id=${snapshotId}$`, "m"));
  assert.match(manifest, /^postgres_sha256=[a-f0-9]{64}$/m);
  assert.match(manifest, /^attachments_sha256=[a-f0-9]{64}$/m);
  assert.match(manifest, /^retention_status=applied$/m);
});

test("offsite backup rejects a valid checksum sidecar naming another archive", async (t) => {
  const f = await fixture(t);
  const attachmentSidecar = await readFile(`${f.attachments}.sha256`, "utf8");
  await writeFile(`${f.postgres}.sha256`, attachmentSidecar);
  const result = run(f.input, f.environment);
  assert.notEqual(result.status, 0);
  await assert.rejects(readFile(f.log, "utf8"), { code: "ENOENT" });
});

test("offsite backup rejects a non-S3 repository before invoking Restic", async (t) => {
  const f = await fixture(t);
  const result = run(f.input, f.environment, {
    RESTIC_REPOSITORY: path.join(f.root, "local-repository"),
  });
  assert.equal(result.status, 64);
  await assert.rejects(readFile(f.log, "utf8"), { code: "ENOENT" });
});

test("offsite backup rejects unsafe retention values before invoking Restic", async (t) => {
  const f = await fixture(t);
  const result = run(f.input, f.environment, { RDPS_RESTIC_KEEP_DAILY: "0" });
  assert.equal(result.status, 64);
  await assert.rejects(readFile(f.log, "utf8"), { code: "ENOENT" });
});

test("offsite backup requires a non-empty strong repository password", async (t) => {
  const f = await fixture(t);
  const result = run(f.input, f.environment, { RESTIC_PASSWORD: "" });
  assert.equal(result.status, 64);
  assert.match(result.stderr, /RESTIC_PASSWORD/);
  await assert.rejects(readFile(f.log, "utf8"), { code: "ENOENT" });
});

test("offsite backup refuses corrupted local archives before upload", async (t) => {
  const f = await fixture(t);
  await writeFile(f.postgres, "corrupted archive");
  const result = run(f.input, f.environment);
  assert.notEqual(result.status, 0);
  await assert.rejects(readFile(f.log, "utf8"), { code: "ENOENT" });
});

test("offsite retention is never applied when the upload fails", async (t) => {
  const f = await fixture(t);
  const restic = path.join(
    path.dirname(f.environment.PATH.split(path.delimiter)[0]),
    "bin",
    "restic",
  );
  await writeFile(
    restic,
    '#!/usr/bin/env bash\nset -eu\nprintf \'%s\\n\' "$*" >> "$RDPS_RESTIC_LOG"\n[[ "$1" != backup ]]\n',
  );
  await chmod(restic, 0o755);
  const result = run(f.input, f.environment);
  assert.notEqual(result.status, 0);
  const calls = await readFile(f.log, "utf8");
  assert.match(calls, /^backup /);
  assert.doesNotMatch(calls, /^forget /m);
});

test("offsite manifest records when uploaded snapshot retention failed", async (t) => {
  const f = await fixture(t);
  const result = run(f.input, f.environment, { RDPS_TEST_RETENTION_FAIL: "1" });
  assert.notEqual(result.status, 0);
  const manifest = await readFile(path.join(f.input, "manifest.txt"), "utf8");
  assert.match(manifest, new RegExp(`^snapshot_id=${snapshotId}$`, "m"));
  assert.match(manifest, /^retention_status=failed$/m);
});
