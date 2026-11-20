import assert from "node:assert/strict";
import test from "node:test";
import { firstValueFrom, of } from "rxjs";
import { PublicResponseCacheInterceptor } from "./public-response-cache.interceptor.js";
import { PublicResponseCache } from "./public-response-cache.service.js";

class MemoryRedis {
  values = new Map<string, string>();
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.values.set(key, value);
    return "OK";
  }
  async incr(key: string) {
    const next = Number(this.values.get(key) ?? "0") + 1;
    this.values.set(key, String(next));
    return next;
  }
}

function contextFor(
  request: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({
        setHeader: (name: string, value: string) => {
          headers[name] = value;
        },
      }),
    }),
  } as never;
}

test("anonymous public snapshot GETs use a shared cache header and return hits", async () => {
  const cache = new PublicResponseCache(new MemoryRedis() as never);
  const interceptor = new PublicResponseCacheInterceptor(cache);
  const request = {
    method: "GET",
    originalUrl: "/api/v1/public/projects/rdps/releases?locale=en",
    headers: { host: "releases.example.test" },
  };
  let loads = 0;
  const next = { handle: () => of({ loaded: ++loads }) };
  const firstHeaders: Record<string, string> = {};
  const first = await firstValueFrom(
    interceptor.intercept(contextFor(request, firstHeaders), next as never),
  );
  const secondHeaders: Record<string, string> = {};
  const second = await firstValueFrom(
    interceptor.intercept(contextFor(request, secondHeaders), next as never),
  );

  assert.deepEqual(first, { loaded: 1 });
  assert.deepEqual(second, { loaded: 1 });
  assert.equal(loads, 1);
  assert.equal(
    firstHeaders["Cache-Control"],
    "public, max-age=0, s-maxage=5, must-revalidate",
  );
  assert.equal(firstHeaders["X-RDPS-Cache"], "MISS");
  assert.equal(secondHeaders["X-RDPS-Cache"], "HIT");
});

test("credentialed requests, host resolution, and attachment downloads bypass shared caching", async () => {
  const interceptor = new PublicResponseCacheInterceptor(
    new PublicResponseCache(new MemoryRedis() as never),
  );
  const requests = [
    {
      method: "GET",
      originalUrl: "/api/v1/public/projects/rdps",
      headers: { host: "releases.example.test", authorization: "Bearer token" },
    },
    {
      method: "GET",
      originalUrl: "/api/v1/public/projects/rdps",
      headers: { host: "releases.example.test", cookie: "session=token" },
    },
    {
      method: "GET",
      originalUrl: "/api/v1/public/host?hostname=docs.example.test",
      headers: { host: "api.example.test" },
    },
    {
      method: "GET",
      originalUrl:
        "/api/v1/public/projects/rdps/releases/1.0.0/attachments/file/download",
      headers: { host: "releases.example.test" },
    },
  ];
  let loads = 0;

  for (const request of requests) {
    const headers: Record<string, string> = {};
    const result = await firstValueFrom(
      interceptor.intercept(contextFor(request, headers), {
        handle: () => of(++loads),
      } as never),
    );
    assert.equal(result, loads);
    assert.equal(headers["Cache-Control"], "no-store");
    assert.equal(headers["X-RDPS-Cache"], "BYPASS");
  }
});
