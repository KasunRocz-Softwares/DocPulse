import assert from "node:assert/strict";
import test from "node:test";

test("latency summaries use nearest-rank p50, p95, and p99 milliseconds", async () => {
  const benchmark = await import("./public-read-benchmark.mjs").catch(
    () => null,
  );
  assert.ok(
    benchmark?.summarizeLatencies,
    "public read benchmark must expose latency summaries",
  );
  assert.deepEqual(benchmark.summarizeLatencies([40, 10, 30, 20]), {
    p50Ms: 20,
    p95Ms: 40,
    p99Ms: 40,
  });
});

test("latency summaries reject an empty sample set", async () => {
  const benchmark = await import("./public-read-benchmark.mjs").catch(
    () => null,
  );
  assert.ok(
    benchmark?.summarizeLatencies,
    "public read benchmark must expose latency summaries",
  );
  assert.throws(() => benchmark.summarizeLatencies([]), /at least one sample/);
});

test("Docker ownership inspection uses the correct command for containers and volumes", async () => {
  const benchmark = await import("./public-read-benchmark.mjs").catch(
    () => null,
  );
  assert.ok(
    benchmark?.resourceInspectArgs,
    "public read benchmark must expose ownership inspection arguments",
  );
  assert.deepEqual(benchmark.resourceInspectArgs("container", "rdps-bench-a"), [
    "inspect",
    "--format",
    '{{ index .Config.Labels "com.rdps.public-read-benchmark.run" }}',
    "rdps-bench-a",
  ]);
  assert.deepEqual(benchmark.resourceInspectArgs("volume", "rdps-bench-b"), [
    "volume",
    "inspect",
    "--format",
    '{{ index .Labels "com.rdps.public-read-benchmark.run" }}',
    "rdps-bench-b",
  ]);
});

test("benchmark run identifiers are deterministic and restricted to safe characters", async () => {
  const benchmark = await import("./public-read-benchmark.mjs").catch(
    () => null,
  );
  assert.ok(
    benchmark?.makeRunId,
    "public read benchmark must expose safe run identifiers",
  );
  assert.equal(benchmark.makeRunId(123456789, "a1b2c3d4"), "21i3v9a1b2c3d4");
  assert.throws(
    () => benchmark.makeRunId(123456789, "abc'); DROP TABLE"),
    /invalid/,
  );
});

test("seed SQL fixes the fixture at 100 projects by 100 published snapshots", async () => {
  const benchmark = await import("./public-read-benchmark.mjs").catch(
    () => null,
  );
  assert.ok(
    benchmark?.buildSeedSql,
    "public read benchmark must expose its fixture SQL for verification",
  );
  const sql = benchmark.buildSeedSql("rdps-bench-abcdefgh", "abcdefgh");
  assert.equal((sql.match(/generate_series\(1, 100\)/g) ?? []).length, 6);
  assert.match(sql, /INSERT INTO "Project"/);
  assert.match(sql, /INSERT INTO "PublicReleaseSnapshot"/);
  assert.match(sql, /rdpsbenchsearchabcdefgh/);
  assert.throws(
    () => benchmark.buildSeedSql("rdps-bench-bad';--", "abcdefgh"),
    /unsafe/,
  );
});

test("benchmark API rate limit permits every configured warm-up and sample", async () => {
  const benchmark = await import("./public-read-benchmark.mjs").catch(
    () => null,
  );
  assert.ok(
    benchmark?.benchmarkRateLimitEnvironment,
    "public read benchmark must expose its isolated rate-limit configuration",
  );
  assert.deepEqual(benchmark.benchmarkRateLimitEnvironment(100), {
    PUBLIC_API_RATE_LIMIT: "404",
    PUBLIC_API_RATE_WINDOW_SECONDS: "3600",
  });
});

test("benchmark report identifies the PostgreSQL image used by its fixture", async () => {
  const benchmark = await import("./public-read-benchmark.mjs").catch(
    () => null,
  );
  assert.equal(benchmark?.benchmarkPostgresImage, "postgres:17-alpine");
});
