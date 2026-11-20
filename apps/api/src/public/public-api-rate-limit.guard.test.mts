import assert from "node:assert/strict";
import test from "node:test";
import { HttpException, HttpStatus } from "@nestjs/common";
import { PublicApiRateLimitGuard } from "./public-api-rate-limit.guard.js";

class MemoryRedisCounter {
  values = new Map<string, number>();
  calls: Array<{ key: string; ttl: number; script: string }> = [];

  async eval(
    _script: string,
    keyCount: number,
    key: string,
    ttl: number,
  ): Promise<[number, number]> {
    assert.equal(keyCount, 1);
    this.calls.push({ key, ttl, script: _script });
    const count = (this.values.get(key) ?? 0) + 1;
    this.values.set(key, count);
    return [count, ttl];
  }
}

function context(
  url: string,
  remoteAddress = "198.51.100.20",
  forwardedFor?: string,
) {
  const headers = forwardedFor ? { "x-forwarded-for": forwardedFor } : {};
  const request = {
    originalUrl: url,
    headers,
    socket: { remoteAddress },
  };
  const response = {
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
  };
  return {
    request,
    response,
    executionContext: {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as never,
  };
}

test("rate limits every public HTTP route and sets Retry-After after the shared limit", async () => {
  const redis = new MemoryRedisCounter();
  const guard = new PublicApiRateLimitGuard(redis as never, {
    limit: 2,
    windowSeconds: 30,
    trustedProxyIps: [],
  });
  const first = context("/api/v1/public/projects");
  const second = context("/api/v1/public/projects/acme/releases");
  const third = context("/api/v1/public/host?hostname=docs.example");

  assert.equal(await guard.canActivate(first.executionContext), true);
  assert.equal(await guard.canActivate(second.executionContext), true);
  await assert.rejects(guard.canActivate(third.executionContext), (error) => {
    assert.ok(error instanceof HttpException);
    assert.equal(error.getStatus(), HttpStatus.TOO_MANY_REQUESTS);
    assert.ok(Number(third.response.headers["Retry-After"]) >= 1);
    assert.ok(Number(third.response.headers["Retry-After"]) <= 30);
    return true;
  });
  assert.equal(redis.calls[0]?.key, redis.calls[1]?.key);
  assert.ok(redis.calls[0]!.ttl > 0 && redis.calls[0]!.ttl <= 30_000);
  assert.match(redis.calls[0]!.script, /INCR/);
  assert.match(redis.calls[0]!.script, /if count == 1 then[\s\S]*PEXPIRE/);
});

test("does not trust forwarded client IP headers without an explicit proxy allowlist", async () => {
  const redis = new MemoryRedisCounter();
  const guard = new PublicApiRateLimitGuard(redis as never, {
    limit: 10,
    windowSeconds: 60,
    trustedProxyIps: [],
  });
  const first = context(
    "/api/v1/public/projects",
    "198.51.100.20",
    "203.0.113.1",
  );
  const spoofed = context(
    "/api/v1/public/projects",
    "198.51.100.20",
    "203.0.113.2",
  );

  await guard.canActivate(first.executionContext);
  await guard.canActivate(spoofed.executionContext);

  assert.equal(redis.calls[0]?.key, redis.calls[1]?.key);
});

test("uses the first untrusted forwarded address only when the socket is a trusted proxy", async () => {
  const redis = new MemoryRedisCounter();
  const guard = new PublicApiRateLimitGuard(redis as never, {
    limit: 10,
    windowSeconds: 60,
    trustedProxyIps: ["10.0.0.8", "10.0.0.9"],
  });
  const request = context(
    "/api/v1/public/projects",
    "10.0.0.8",
    "203.0.113.10, 10.0.0.9",
  );

  await guard.canActivate(request.executionContext);

  const otherClient = context(
    "/api/v1/public/projects",
    "10.0.0.8",
    "203.0.113.11, 10.0.0.9",
  );
  await guard.canActivate(otherClient.executionContext);
  assert.notEqual(redis.calls[0]?.key, redis.calls[1]?.key);
  assert.doesNotMatch(redis.calls[0]!.key, /203\.0\.113\.10/);
});

test("leaves non-public routes outside this limiter", async () => {
  const redis = new MemoryRedisCounter();
  const guard = new PublicApiRateLimitGuard(redis as never, {
    limit: 1,
    windowSeconds: 60,
    trustedProxyIps: [],
  });
  const request = context("/api/v1/projects");

  assert.equal(await guard.canActivate(request.executionContext), true);
  assert.equal(redis.calls.length, 0);
});
