import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const bashPath =
  process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rdps-smoke-check-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = path.join(directory, "bin");
  await mkdir(bin);
  await writeFile(
    path.join(bin, "curl"),
    `#!/usr/bin/env bash
set -eu
url=
output=
while (($#)); do
  case "$1" in
    -o|--output) output=$2; shift 2 ;;
    http*) url=$1; shift ;;
    *) shift ;;
  esac
done
if [[ -n "$output" && "$output" != /dev/null ]]; then
  case "$url" in
    *health/ready*)
      if [[ "${"${RDPS_TEST_API_UNHEALTHY:-0}"}" == 1 ]]; then
        printf '%s\\n' '{"status":"error","checks":{"database":"error","redis":"ok"}}' > "$output"
      else
        printf '%s\\n' '{"status":"ok","checks":{"database":"ok","redis":"ok"}}' > "$output"
      fi ;;
    *sitemap.xml*) printf '%s\\n' '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>' > "$output" ;;
    *admin*) printf '%s\\n' '<html><title>RDPS Admin</title></html>' > "$output" ;;
    *) printf '%s\\n' '<html>public</html>' > "$output" ;;
  esac
fi
`,
  );
  await writeFile(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
set -eu
if [[ "$*" == *"ps --format json"* ]]; then
  printf '%s\\n' '{"Health":"healthy"}'
  exit 0
fi
if [[ "$*" == compose* && "$*" == *" ps "* ]]; then exit 0; fi
if [[ "$*" == *"127.0.0.1:9093/-/ready"* || "$*" == *"127.0.0.1:9090/-/ready"* ]]; then exit 0; fi
url="${"${@: -1}"}"
case "$url" in
  *targets?state=active*)
    printf '%s\\n' '{"data":{"activeTargets":[{"labels":{"job":"rdps-api"},"health":"up"},{"labels":{"job":"rdps-api-health"},"health":"up"},{"labels":{"job":"rdps-web-health"},"health":"up"},{"labels":{"job":"postgres-exporter"},"health":"up"},{"labels":{"job":"redis-exporter"},"health":"up"},{"labels":{"job":"node-exporter"},"health":"up"}]}}' ;;
  *query=probe_success*)
    printf '%s\\n' '{"data":{"result":[{"metric":{"job":"rdps-api-health"},"value":[0,"1"]},{"metric":{"job":"rdps-web-health"},"value":[0,"1"]}]}}' ;;
  *query=up%7Bjob%3D%22rdps-api%22%7D*)
    printf '%s\\n' '{"status":"success","data":{"result":[{"value":[0,"1"]}]}}' ;;
  *query=pg_up*|*query=redis_up*)
    printf '%s\\n' '{"status":"success","data":{"result":[{"value":[0,"1"]}]}}' ;;
  *query=rdps_backup*)
    if [[ "${"${RDPS_TEST_BACKUP_METRICS_FAIL:-0}"}" == 1 ]]; then
      printf '%s\\n' '{"status":"success","data":{"result":[]}}'
    else
      printf '%s\\n' '{"status":"success","data":{"result":[{"value":[0,"1"]}]}}'
    fi ;;
  *api/v1/rules*)
    printf '%s\\n' '{"status":"success","data":{"groups":[{"file":"/etc/prometheus/alerts.yml","rules":[{"name":"RdpsApiUnavailable"}]}]}}' ;;
  *) echo "Unexpected mocked Docker command: $*" >&2; exit 90 ;;
esac
`,
  );
  await Promise.all([
    chmod(path.join(bin, "curl"), 0o755),
    chmod(path.join(bin, "docker"), 0o755),
  ]);
  const bashEnv = path.join(directory, "bash-env");
  await writeFile(
    bashEnv,
    'curl() { "$RDPS_TEST_BIN/curl" "$@"; }\ndocker() { "$RDPS_TEST_BIN/docker" "$@"; }\n',
  );
  return { bin, bashEnv };
}

function run(f, overrides = {}) {
  return spawnSync(bashPath, ["scripts/ops/production-smoke-check.sh"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PATH: `${f.bin}${path.delimiter}${process.env.PATH}`,
      BASH_ENV: f.bashEnv,
      RDPS_TEST_BIN: f.bin,
      RDPS_PRODUCTION_API_HEALTH_URL:
        "https://api.example.test/api/v1/health/ready",
      RDPS_PRODUCTION_WEB_HEALTH_URL: "https://releases.example.test/healthz",
      RDPS_PRODUCTION_PUBLIC_URL: "https://releases.example.test/",
      RDPS_PRODUCTION_SITEMAP_URL: "https://releases.example.test/sitemap.xml",
      RDPS_PRODUCTION_ADMIN_URL: "https://admin.example.test/",
      ...overrides,
    },
    encoding: "utf8",
  });
}

test("production smoke check passes healthy routed, dependency, backup, and loaded-rule fixtures", async (t) => {
  const result = run(await fixture(t));
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /API, PostgreSQL, and Redis metrics are healthy/);
  assert.match(result.stdout, /off-site backup upload and retention succeeded/);
  assert.match(result.stdout, /RDPS alert rules are loaded/);
});

test("production smoke check fails for unhealthy API and latest backup metrics", async (t) => {
  const f = await fixture(t);
  const api = run(f, { RDPS_TEST_API_UNHEALTHY: "1" });
  assert.notEqual(api.status, 0);
  assert.match(api.stderr, /API readiness or database\/cache checks/);

  const backup = run(f, { RDPS_TEST_BACKUP_METRICS_FAIL: "1" });
  assert.notEqual(backup.status, 0);
  assert.match(backup.stderr, /backup upload\/retention metrics are missing/);
});
