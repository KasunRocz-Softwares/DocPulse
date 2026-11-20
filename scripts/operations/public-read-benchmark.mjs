import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { createServer } from "node:net";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const runLabel = "com.rdps.public-read-benchmark.run";
export const benchmarkPostgresImage = "postgres:17-alpine";
const sleep = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

export function summarizeLatencies(samples) {
  if (!Array.isArray(samples) || samples.length === 0)
    throw new Error("Latency summary requires at least one sample");
  const ordered = samples.toSorted((left, right) => left - right);
  const at = (quantile) =>
    ordered[Math.max(0, Math.ceil(quantile * ordered.length) - 1)];
  return { p50Ms: at(0.5), p95Ms: at(0.95), p99Ms: at(0.99) };
}

export function makeRunId(
  now = Date.now(),
  random = randomBytes(4).toString("hex"),
) {
  const id = `${now.toString(36)}${random}`.toLowerCase();
  if (!/^[a-z0-9]{8,24}$/.test(id))
    throw new Error("Benchmark run identifier is invalid");
  return id;
}

export function resourceInspectArgs(kind, name) {
  if (kind === "container")
    return [
      "inspect",
      "--format",
      `{{ index .Config.Labels "${runLabel}" }}`,
      name,
    ];
  if (kind === "volume")
    return [
      "volume",
      "inspect",
      "--format",
      `{{ index .Labels "${runLabel}" }}`,
      name,
    ];
  throw new Error(`Unsupported Docker resource kind: ${kind}`);
}

function resourceExistsArgs(kind, name) {
  if (kind === "container") return ["inspect", name];
  if (kind === "volume") return ["volume", "inspect", name];
  throw new Error(`Unsupported Docker resource kind: ${kind}`);
}

function command(binary, args, options = {}) {
  const windowsPnpm = process.platform === "win32" && binary === "pnpm";
  const executable = windowsPnpm ? (process.env.ComSpec ?? "cmd.exe") : binary;
  const executableArgs = windowsPnpm
    ? ["/d", "/s", "/c", `${binary} ${args.join(" ")}`]
    : args;
  const result = spawnSync(executable, executableArgs, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input: options.input,
    env: options.env ?? process.env,
    maxBuffer: 24 * 1024 * 1024,
    timeout: options.timeout ?? 30_000,
    windowsHide: true,
  });
  if (result.error)
    throw new Error(`${binary} could not complete: ${result.error.message}`);
  if (result.status !== 0 && !options.allowFailure)
    throw new Error(
      `${binary} exited with status ${result.status}: ${(result.stderr || result.stdout || "no output").trim()}`,
    );
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

function docker(args, options = {}) {
  return command("docker", args, { timeout: 10_000, ...options });
}

function inspectOwnedResource(kind, name, runId) {
  const result = docker(resourceInspectArgs(kind, name), {
    allowFailure: true,
  });
  if (result.status !== 0) {
    if (/no such (object|volume)|not found/i.test(result.stderr)) return false;
    throw new Error(
      `Could not inspect benchmark ${kind} ownership for ${name}`,
    );
  }
  return result.status === 0 && result.stdout === runId;
}

function requireUnusedResource(kind, name) {
  const result = docker(resourceExistsArgs(kind, name), { allowFailure: true });
  if (result.status === 0)
    throw new Error(`Generated benchmark ${kind} name already exists: ${name}`);
  if (!/no such (object|volume)|not found/i.test(result.stderr))
    throw new Error(`Could not verify generated benchmark ${kind}: ${name}`);
}

function removeOwnedResource(kind, name, runId) {
  if (!inspectOwnedResource(kind, name, runId)) {
    const exists = docker(resourceExistsArgs(kind, name), {
      allowFailure: true,
    });
    if (exists.status === 0)
      throw new Error(`Refusing to remove unowned benchmark ${kind}: ${name}`);
    if (!/no such (object|volume)|not found/i.test(exists.stderr))
      throw new Error(
        `Could not verify whether benchmark ${kind} exists: ${name}`,
      );
    return;
  }
  docker(
    kind === "container" ? ["rm", "--force", name] : ["volume", "rm", name],
    { timeout: 30_000 },
  );
}

function createVolume(name, runId, role) {
  docker([
    "volume",
    "create",
    "--label",
    `${runLabel}=${runId}`,
    "--label",
    `com.rdps.public-read-benchmark.role=${role}`,
    name,
  ]);
  if (!inspectOwnedResource("volume", name, runId))
    throw new Error(
      `Created volume does not have this run's ownership label: ${name}`,
    );
}

function publishedPort(container, targetPort) {
  const result = docker(["port", container, `${targetPort}/tcp`]).stdout;
  const match = /127\.0\.0\.1:(\d+)/.exec(result);
  if (!match)
    throw new Error(`Could not read the published port for ${container}`);
  return Number(match[1]);
}

async function waitFor(description, check, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      if (error?.fatal === true) throw error;
      lastError = error;
    }
    await sleep(1000);
  }
  throw new Error(
    `Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ""}`,
  );
}

function portAvailable() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a local API port"));
        return;
      }
      server.close((error) =>
        error ? reject(error) : resolvePromise(address.port),
      );
    });
  });
}

export function buildSeedSql(prefix, runId) {
  if (
    !/^rdps-bench-[a-z0-9]{8,24}$/.test(prefix) ||
    !/^[a-z0-9]{8,24}$/.test(runId)
  )
    throw new Error(
      "Refusing to interpolate an unsafe benchmark identifier into SQL",
    );
  const searchTerm = `rdpsbenchsearch${runId}`;
  return `
BEGIN;
INSERT INTO "User" ("id", "email", "displayName", "status", "updatedAt")
VALUES (md5('${prefix}-user')::uuid, '${prefix}@example.invalid', 'RDPS Benchmark Fixture', 'ACTIVE', CURRENT_TIMESTAMP);

INSERT INTO "Project" ("id", "name", "slug", "description", "status", "updatedAt")
SELECT md5('${prefix}-project-' || n)::uuid,
       'RDPS Benchmark ${runId} project ' || lpad(n::text, 3, '0'),
       '${prefix}-' || lpad(n::text, 3, '0'),
       'Isolated public-read benchmark fixture',
       'ACTIVE', CURRENT_TIMESTAMP
FROM generate_series(1, 100) AS n;

WITH fixture AS (
  SELECT p."id" AS project_id, p."slug" AS project_slug,
         p."name" AS project_name,
         (regexp_replace(p."slug", '^.*-', ''))::int AS project_number,
         n AS release_number,
         md5('${prefix}-release-' || p."slug" || '-' || n)::uuid AS release_id,
         md5('${prefix}-revision-' || p."slug" || '-' || n)::uuid AS revision_id,
         md5('${prefix}-publication-' || p."slug" || '-' || n)::uuid AS publication_id,
         md5('${prefix}-snapshot-' || p."slug" || '-' || n)::uuid AS snapshot_id,
         md5('${prefix}-change-' || p."slug" || '-' || n)::uuid AS change_id
  FROM "Project" p CROSS JOIN generate_series(1, 100) AS n
  WHERE p."slug" LIKE '${prefix}-%'
)
INSERT INTO "Release" ("id", "projectId", "version", "title", "type", "channel", "status", "publicSummary", "audienceMode", "updatedAt")
SELECT release_id, project_id, '1.0.' || release_number,
       'Benchmark release ' || release_number,
       'MINOR', 'STABLE', 'PUBLISHED',
       'Published benchmark ${searchTerm}', 'PUBLIC', CURRENT_TIMESTAMP
FROM fixture;

WITH fixture AS (
  SELECT p."id" AS project_id, p."slug" AS project_slug,
         (regexp_replace(p."slug", '^.*-', ''))::int AS project_number,
         n AS release_number,
         md5('${prefix}-release-' || p."slug" || '-' || n)::uuid AS release_id,
         md5('${prefix}-revision-' || p."slug" || '-' || n)::uuid AS revision_id,
         md5('${prefix}-publication-' || p."slug" || '-' || n)::uuid AS publication_id,
         md5('${prefix}-snapshot-' || p."slug" || '-' || n)::uuid AS snapshot_id,
         md5('${prefix}-change-' || p."slug" || '-' || n)::uuid AS change_id
  FROM "Project" p CROSS JOIN generate_series(1, 100) AS n
  WHERE p."slug" LIKE '${prefix}-%'
)
INSERT INTO "ApprovalRevision" ("id", "releaseId", "revision", "status", "contentHash", "content", "submittedById")
SELECT revision_id, release_id, 1, 'APPROVED', repeat('a', 64),
       jsonb_build_object('title', 'Benchmark release ' || release_number),
       md5('${prefix}-user')::uuid
FROM fixture;

WITH fixture AS (
  SELECT p."id" AS project_id, p."slug" AS project_slug,
         p."name" AS project_name,
         n AS release_number,
         md5('${prefix}-release-' || p."slug" || '-' || n)::uuid AS release_id,
         md5('${prefix}-revision-' || p."slug" || '-' || n)::uuid AS revision_id,
         md5('${prefix}-publication-' || p."slug" || '-' || n)::uuid AS publication_id,
         md5('${prefix}-snapshot-' || p."slug" || '-' || n)::uuid AS snapshot_id,
         md5('${prefix}-change-' || p."slug" || '-' || n)::uuid AS change_id,
         CURRENT_TIMESTAMP - ((100 - n)::text || ' seconds')::interval AS published_at
  FROM "Project" p CROSS JOIN generate_series(1, 100) AS n
  WHERE p."slug" LIKE '${prefix}-%'
)
INSERT INTO "ReleasePublication" ("id", "releaseId", "revisionId", "sequence", "publishedAt")
SELECT publication_id, release_id, revision_id, 1, published_at
FROM fixture;

WITH fixture AS (
  SELECT p."slug" AS project_slug, p."name" AS project_name,
         n AS release_number,
         md5('${prefix}-release-' || p."slug" || '-' || n)::uuid AS release_id,
         md5('${prefix}-publication-' || p."slug" || '-' || n)::uuid AS publication_id,
         md5('${prefix}-snapshot-' || p."slug" || '-' || n)::uuid AS snapshot_id,
         md5('${prefix}-change-' || p."slug" || '-' || n)::uuid AS change_id,
         CURRENT_TIMESTAMP - ((100 - n)::text || ' seconds')::interval AS published_at
  FROM "Project" p CROSS JOIN generate_series(1, 100) AS n
  WHERE p."slug" LIKE '${prefix}-%'
)
INSERT INTO "PublicReleaseSnapshot" ("id", "publicationId", "projectSlug", "projectName", "version", "title", "summary", "contentHash", "publishedAt", "audienceMode")
SELECT snapshot_id, publication_id, project_slug, project_name,
       '1.0.' || release_number, 'Benchmark release ' || release_number,
       'Published benchmark ${searchTerm}', repeat('b', 64), published_at, 'PUBLIC'
FROM fixture;

WITH fixture AS (
  SELECT p."slug" AS project_slug, n AS release_number,
         md5('${prefix}-snapshot-' || p."slug" || '-' || n)::uuid AS snapshot_id,
         md5('${prefix}-change-' || p."slug" || '-' || n)::uuid AS change_id
  FROM "Project" p CROSS JOIN generate_series(1, 100) AS n
  WHERE p."slug" LIKE '${prefix}-%'
)
INSERT INTO "PublicSnapshotChange" ("id", "snapshotId", "title", "category", "description", "sortOrder")
SELECT change_id, snapshot_id, 'Search marker ${searchTerm}', 'IMPROVEMENT',
       'Searchable benchmark change ${searchTerm}', 0
FROM fixture;
COMMIT;
ANALYZE "PublicReleaseSnapshot";
ANALYZE "PublicSnapshotChange";
`;
}

export function benchmarkRateLimitEnvironment(sampleCount) {
  if (!Number.isInteger(sampleCount) || sampleCount < 20 || sampleCount > 1000)
    throw new Error(
      "Benchmark sample count must be an integer from 20 to 1000",
    );
  return {
    PUBLIC_API_RATE_LIMIT: String((sampleCount + 1) * 4),
    PUBLIC_API_RATE_WINDOW_SECONDS: "3600",
  };
}

async function apiMemoryBytes(pid) {
  try {
    if (process.platform === "win32") {
      const value = command(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `(Get-Process -Id ${pid} -ErrorAction Stop).WorkingSet64`,
        ],
        { timeout: 5000 },
      ).stdout;
      return Number(value);
    }
    const value = command("ps", ["-o", "rss=", "-p", String(pid)], {
      timeout: 5000,
    }).stdout;
    return Number(value) * 1024;
  } catch {
    return null;
  }
}

async function getApiPort() {
  return portAvailable();
}

function parseJson(body, endpoint) {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`Public endpoint returned invalid JSON: ${endpoint}`);
  }
}

async function runBenchmark() {
  if (process.platform === "win32" && process.env.WSL_DISTRO_NAME)
    throw new Error(
      "Run this script in the native Windows Node environment, not WSL.",
    );
  docker(["info", "--format", "{{.ServerVersion}}"], { timeout: 8000 });
  const runId = makeRunId();
  const prefix = `rdps-bench-${runId}`;
  const names = {
    postgresContainer: `${prefix}-postgres`,
    redisContainer: `${prefix}-redis`,
    postgresVolume: `${prefix}-postgres-data`,
  };
  for (const [kind, name] of Object.entries(names))
    requireUnusedResource(
      kind.endsWith("Volume") ? "volume" : "container",
      name,
    );

  const tempRoot = await mkdtemp(join(tmpdir(), `${prefix}-`));
  const expectedTempRoot = resolve(tmpdir());
  if (
    !resolve(tempRoot).startsWith(
      `${expectedTempRoot}${process.platform === "win32" ? "\\" : "/"}`,
    )
  )
    throw new Error(
      "Temporary benchmark directory escaped the system temp root",
    );

  let apiProcess;
  let apiPort;
  let databasePassword;
  const ownedContainers = [];
  const ownedVolumes = [];
  const cleanupErrors = [];
  try {
    const dockerLabels = ["--label", `${runLabel}=${runId}`];
    ownedVolumes.push(names.postgresVolume);
    createVolume(names.postgresVolume, runId, "postgres-data");
    databasePassword = randomBytes(24).toString("hex");
    const postgresEnvFile = join(tempRoot, "postgres.env");
    await writeFile(
      postgresEnvFile,
      `POSTGRES_DB=rdps_benchmark\nPOSTGRES_USER=rdps_benchmark\nPOSTGRES_PASSWORD=${databasePassword}\n`,
      { mode: 0o600 },
    );
    command("pnpm", ["--filter", "@rdps/api", "build"], {
      timeout: 180_000,
    });
    ownedContainers.push(names.postgresContainer);
    docker([
      "run",
      "--detach",
      "--name",
      names.postgresContainer,
      ...dockerLabels,
      "--label",
      "com.rdps.public-read-benchmark.role=postgres",
      "--publish",
      "127.0.0.1::5432",
      "--env-file",
      postgresEnvFile,
      "--mount",
      `type=volume,source=${names.postgresVolume},target=/var/lib/postgresql/data`,
      benchmarkPostgresImage,
    ]);
    if (!inspectOwnedResource("container", names.postgresContainer, runId))
      throw new Error(
        "Benchmark PostgreSQL container ownership could not be verified",
      );
    ownedContainers.push(names.redisContainer);
    docker([
      "run",
      "--detach",
      "--name",
      names.redisContainer,
      ...dockerLabels,
      "--label",
      "com.rdps.public-read-benchmark.role=redis",
      "--publish",
      "127.0.0.1::6379",
      "redis:7-alpine",
    ]);
    if (!inspectOwnedResource("container", names.redisContainer, runId))
      throw new Error(
        "Benchmark Redis container ownership could not be verified",
      );

    await waitFor("isolated PostgreSQL", () => {
      const result = docker(
        [
          "exec",
          names.postgresContainer,
          "pg_isready",
          "-U",
          "rdps_benchmark",
          "-d",
          "rdps_benchmark",
        ],
        { allowFailure: true },
      );
      return result.status === 0;
    });
    await waitFor("isolated Redis", () => {
      const result = docker(
        ["exec", names.redisContainer, "redis-cli", "ping"],
        { allowFailure: true },
      );
      return result.status === 0 && result.stdout === "PONG";
    });

    const pgPort = publishedPort(names.postgresContainer, 5432);
    const redisPort = publishedPort(names.redisContainer, 6379);
    const databaseUrl = `postgresql://rdps_benchmark:${databasePassword}@127.0.0.1:${pgPort}/rdps_benchmark?schema=public`;
    const redisUrl = `redis://127.0.0.1:${redisPort}`;
    const apiEnv = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
    };

    command("pnpm", ["--filter", "@rdps/api", "db:deploy"], {
      env: apiEnv,
      timeout: 180_000,
    });
    const seed = docker(
      [
        "exec",
        "-i",
        names.postgresContainer,
        "psql",
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "rdps_benchmark",
        "-d",
        "rdps_benchmark",
      ],
      { input: buildSeedSql(prefix, runId), timeout: 180_000 },
    );
    if (seed.status !== 0) throw new Error("Benchmark fixture seeding failed");

    apiPort = await getApiPort();
    const inheritedEnvironment = [
      "PATH",
      "Path",
      "SystemRoot",
      "WINDIR",
      "TEMP",
      "TMP",
      "USERPROFILE",
      "APPDATA",
      "LOCALAPPDATA",
      "PATHEXT",
      "COMSPEC",
      "HOME",
    ];
    const cleanServerEnv = Object.fromEntries(
      inheritedEnvironment
        .filter((name) => process.env[name] !== undefined)
        .map((name) => [name, process.env[name]]),
    );
    const sampleCount = Number.parseInt(
      process.env.RDPS_BENCHMARK_SAMPLES ?? "100",
      10,
    );
    if (
      !Number.isInteger(sampleCount) ||
      sampleCount < 20 ||
      sampleCount > 1000
    )
      throw new Error(
        "RDPS_BENCHMARK_SAMPLES must be an integer from 20 to 1000",
      );
    const apiEnvForServer = {
      ...cleanServerEnv,
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      ...benchmarkRateLimitEnvironment(sampleCount),
      API_PORT: String(apiPort),
      NODE_ENV: "test",
      WEB_BASE_URL: "http://127.0.0.1:5173",
      JWT_ACCESS_SECRET: randomBytes(32).toString("hex"),
      JWT_REFRESH_SECRET: randomBytes(32).toString("hex"),
      RDPS_UPLOAD_DIR: join(tempRoot, "uploads"),
      PUBLIC_BASE_URL: "http://127.0.0.1:5174",
    };
    await mkdir(apiEnvForServer.RDPS_UPLOAD_DIR, { recursive: true });
    apiProcess = spawn(
      process.execPath,
      [join(repositoryRoot, "apps/api/dist/main.js")],
      {
        cwd: tempRoot,
        env: apiEnvForServer,
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      },
    );
    let apiStderr = "";
    apiProcess.stderr.setEncoding("utf8");
    apiProcess.stderr.on("data", (chunk) => {
      apiStderr = `${apiStderr}${chunk}`.slice(-5000);
    });
    apiProcess.once("error", (error) => {
      apiStderr = `${apiStderr}\n${error.message}`.slice(-5000);
    });
    await waitFor("benchmark API readiness", async () => {
      if (apiProcess.exitCode !== null) {
        const error = new Error(`API exited before readiness: ${apiStderr}`);
        error.fatal = true;
        throw error;
      }
      try {
        const response = await fetch(
          `http://127.0.0.1:${apiPort}/api/v1/health`,
        );
        return response.ok;
      } catch {
        return false;
      }
    });

    const projectSlug = `${prefix}-001`;
    const searchTerm = `rdpsbenchsearch${runId}`;
    const publicBase = `http://127.0.0.1:${apiPort}/api/v1/public`;
    const endpoints = [
      {
        name: "directory",
        path: `/projects?page=1&pageSize=100&q=${encodeURIComponent(`RDPS Benchmark ${runId}`)}`,
        validate: (body) => body.total === 100 && body.results?.length === 100,
      },
      {
        name: "history",
        path: `/projects/${encodeURIComponent(projectSlug)}/releases?page=1&pageSize=100`,
        validate: (body) => body.total === 100 && body.results?.length === 100,
      },
      {
        name: "search",
        path: `/projects/${encodeURIComponent(projectSlug)}/search?q=${encodeURIComponent(searchTerm)}&page=1&pageSize=100`,
        validate: (body) => body.total === 100 && body.results?.length === 100,
      },
      {
        name: "latest",
        path: `/projects/${encodeURIComponent(projectSlug)}/releases/latest`,
        validate: (body) => body.version === "1.0.100",
      },
    ];
    let peakMemoryBytes = await apiMemoryBytes(apiProcess.pid);
    const baselineMemoryBytes = peakMemoryBytes;
    const results = [];
    let totalRequests = 0;
    let totalErrors = 0;
    let totalCacheHits = 0;

    for (const endpoint of endpoints) {
      const warm = await fetch(`${publicBase}${endpoint.path}`);
      const warmText = await warm.text();
      const warmBody = parseJson(warmText, endpoint.name);
      if (!warm.ok || !endpoint.validate(warmBody))
        throw new Error(
          `Warm-up data check failed for ${endpoint.name} (HTTP ${warm.status}): ${warmText.slice(0, 500)}`,
        );
      if (warm.headers.get("x-rdps-cache") !== "MISS")
        throw new Error(
          `Expected an isolated cache miss while warming ${endpoint.name}`,
        );

      const samples = [];
      let errors = 0;
      let cacheHits = 0;
      for (let index = 0; index < sampleCount; index += 1) {
        const started = performance.now();
        try {
          const response = await fetch(`${publicBase}${endpoint.path}`);
          const responseText = await response.text();
          const finished = performance.now();
          samples.push(finished - started);
          if (
            !response.ok ||
            !endpoint.validate(parseJson(responseText, endpoint.name))
          )
            errors += 1;
          if (response.headers.get("x-rdps-cache") === "HIT") cacheHits += 1;
        } catch {
          samples.push(performance.now() - started);
          errors += 1;
        }
        if (index % 10 === 0) {
          const memory = await apiMemoryBytes(apiProcess.pid);
          if (memory !== null)
            peakMemoryBytes = Math.max(peakMemoryBytes ?? 0, memory);
        }
      }
      const summary = summarizeLatencies(samples);
      totalRequests += sampleCount;
      totalErrors += errors;
      totalCacheHits += cacheHits;
      results.push({
        endpoint: endpoint.name,
        requests: sampleCount,
        errors,
        cacheHits,
        cacheHitRate: Number((cacheHits / sampleCount).toFixed(4)),
        warmCacheTargetMet: cacheHits / sampleCount >= 0.99,
        ...summary,
        p95TargetMet: summary.p95Ms < 500,
      });
    }

    const expectedCounts = docker([
      "exec",
      names.postgresContainer,
      "psql",
      "-X",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "rdps_benchmark",
      "-d",
      "rdps_benchmark",
      "-c",
      `SELECT (SELECT COUNT(*) FROM "Project" WHERE "slug" LIKE '${prefix}-%') || '|' || (SELECT COUNT(*) FROM "PublicReleaseSnapshot" WHERE "projectSlug" LIKE '${prefix}-%');`,
    ]).stdout;
    if (expectedCounts !== "100|10000")
      throw new Error(`Unexpected benchmark fixture counts: ${expectedCounts}`);

    const report = {
      result:
        totalErrors === 0 &&
        results.every(
          (result) => result.p95TargetMet && result.warmCacheTargetMet,
        )
          ? "passed"
          : "failed",
      runId,
      fixture: { projects: 100, publishedSnapshots: 10_000 },
      samplesPerEndpoint: sampleCount,
      totalRequests,
      totalErrors,
      errorRate: Number((totalErrors / totalRequests).toFixed(6)),
      totalCacheHits,
      apiProcessMemory: {
        baselineBytes: baselineMemoryBytes,
        peakSampledBytes: peakMemoryBytes,
      },
      runtime: {
        node: process.version,
        platform: process.platform,
        postgresImage: benchmarkPostgresImage,
        redisImage: "redis:7-alpine",
      },
      performanceTarget:
        "cached public p95 < 500 ms; warmed cache hit rate >= 99%",
      performanceTargetMet: results.every(
        (result) => result.p95TargetMet && result.warmCacheTargetMet,
      ),
      endpoints: results,
    };
    console.log(JSON.stringify(report, null, 2));
    if (report.result !== "passed") process.exitCode = 1;
  } finally {
    if (apiProcess && apiProcess.exitCode === null) {
      apiProcess.kill("SIGTERM");
      await Promise.race([
        new Promise((resolvePromise) =>
          apiProcess.once("exit", resolvePromise),
        ),
        sleep(5000),
      ]);
      if (apiProcess.exitCode === null) {
        apiProcess.kill("SIGKILL");
        await Promise.race([
          new Promise((resolvePromise) =>
            apiProcess.once("exit", resolvePromise),
          ),
          sleep(3000),
        ]);
      }
    }
    for (const container of ownedContainers.reverse()) {
      try {
        removeOwnedResource("container", container, runId);
      } catch (error) {
        cleanupErrors.push(error.message);
      }
    }
    for (const volume of ownedVolumes.reverse()) {
      try {
        removeOwnedResource("volume", volume, runId);
      } catch (error) {
        cleanupErrors.push(error.message);
      }
    }
    const resolvedTempRoot = resolve(tempRoot);
    const resolvedSystemTemp = resolve(tmpdir());
    const prefixCheck = `${resolvedSystemTemp}${process.platform === "win32" ? "\\" : "/"}`;
    if (resolvedTempRoot.startsWith(prefixCheck))
      await rm(resolvedTempRoot, { recursive: true, force: true });
    else
      cleanupErrors.push(
        "Refused to remove a temporary directory outside the system temp root",
      );
    if (cleanupErrors.length)
      throw new Error(
        `Benchmark cleanup incomplete: ${cleanupErrors.join("; ")}`,
      );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runBenchmark().catch((error) => {
    console.error(
      `Public read benchmark failed: ${error instanceof Error ? error.stack : String(error)}`,
    );
    process.exitCode = 1;
  });
}
