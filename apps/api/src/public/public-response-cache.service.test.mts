import assert from "node:assert/strict";
import test from "node:test";
import { PublicResponseCache } from "./public-response-cache.service.js";

class MemoryRedis {
  values = new Map<string, string>();
  writes: Array<{ key: string; ttl: number }> = [];
  failReads = false;
  failWrites = false;
  failIncrements = false;

  async get(key: string) {
    if (this.failReads) throw new Error("redis unavailable");
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, mode: "EX", ttl: number) {
    assert.equal(mode, "EX");
    if (this.failWrites) throw new Error("redis unavailable");
    this.values.set(key, value);
    this.writes.push({ key, ttl });
    return "OK";
  }

  async incr(key: string) {
    if (this.failIncrements) throw new Error("redis unavailable");
    const next = Number(this.values.get(key) ?? "0") + 1;
    this.values.set(key, String(next));
    return next;
  }

  async del(key: string) {
    return this.values.delete(key) ? 1 : 0;
  }
}

test("public responses are cached by project and request key for five seconds", async () => {
  const redis = new MemoryRedis();
  const cache = new PublicResponseCache(redis as never);
  let loads = 0;

  const first = await cache.getOrLoad(
    { kind: "project", slug: "release-a" },
    "releases?locale=en",
    async () => ({ result: ++loads }),
  );
  const second = await cache.getOrLoad(
    { kind: "project", slug: "release-a" },
    "releases?locale=en",
    async () => ({ result: ++loads }),
  );
  const otherHost = await cache.getOrLoad(
    { kind: "project", slug: "release-a" },
    "other.example/releases?locale=en",
    async () => ({ result: ++loads }),
  );

  assert.deepEqual(first, { value: { result: 1 }, state: "MISS" });
  assert.deepEqual(second, { value: { result: 1 }, state: "HIT" });
  assert.deepEqual(otherHost, { value: { result: 2 }, state: "MISS" });
  assert.equal(loads, 2);
  assert.ok(redis.writes.every((write) => write.ttl === 5));
});

test("publication invalidation expires only that project's cache and its directory projection", async () => {
  const redis = new MemoryRedis();
  const cache = new PublicResponseCache(redis as never);
  let alphaLoads = 0;
  let betaLoads = 0;
  let directoryLoads = 0;
  const alphaScope = { kind: "project" as const, slug: "alpha" };
  const betaScope = { kind: "project" as const, slug: "beta" };
  const directoryScope = { kind: "directory" as const };
  const load = async () => ++alphaLoads;

  await cache.getOrLoad(alphaScope, "/projects/alpha", load);
  await cache.getOrLoad(betaScope, "/projects/beta", async () => ++betaLoads);
  await cache.getOrLoad(
    directoryScope,
    "/projects",
    async () => ++directoryLoads,
  );
  await cache.invalidateProject("alpha");

  const alpha = await cache.getOrLoad(alphaScope, "/projects/alpha", load);
  const beta = await cache.getOrLoad(
    betaScope,
    "/projects/beta",
    async () => ++betaLoads,
  );
  const directory = await cache.getOrLoad(
    directoryScope,
    "/projects",
    async () => ++directoryLoads,
  );

  assert.deepEqual(alpha, { value: 2, state: "MISS" });
  assert.deepEqual(beta, { value: 1, state: "HIT" });
  assert.deepEqual(directory, { value: 2, state: "MISS" });
});

test("cache backend failures return fresh data without failing public delivery", async () => {
  const redis = new MemoryRedis();
  const cache = new PublicResponseCache(redis as never);
  redis.failReads = true;
  let loads = 0;

  const result = await cache.getOrLoad(
    { kind: "project", slug: "alpha" },
    "/projects/alpha",
    async () => ++loads,
  );

  assert.deepEqual(result, { value: 1, state: "BYPASS" });
  assert.equal(loads, 1);
});

test("cache invalidation failures are contained so committed publication commands can finish", async () => {
  const redis = new MemoryRedis();
  const cache = new PublicResponseCache(redis as never);
  redis.failIncrements = true;

  await assert.doesNotReject(() => cache.invalidateProject("alpha"));
});

test("uncacheable large responses are returned without storing them", async () => {
  const redis = new MemoryRedis();
  const cache = new PublicResponseCache(redis as never);
  const large = "x".repeat(1_048_577);

  const result = await cache.getOrLoad(
    { kind: "directory" },
    "/projects",
    async () => large,
  );

  assert.deepEqual(result, { value: large, state: "BYPASS" });
  assert.equal(redis.writes.length, 0);
});
