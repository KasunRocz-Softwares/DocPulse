import * as assert from "node:assert/strict";
import { RequestMethod, type INestApplication } from "@nestjs/common";
import "reflect-metadata";
import { afterEach, test } from "node:test";
import { Test } from "@nestjs/testing";
import { HealthModule, HealthRedisConnection } from "./health.module";
import { PrismaService } from "../prisma/prisma.service";

const applications: INestApplication[] = [];

async function createHealthApp({
  database = true,
  redis = true,
}: { database?: boolean; redis?: boolean } = {}): Promise<string> {
  const module = await Test.createTestingModule({ imports: [HealthModule] })
    .overrideProvider(PrismaService)
    .useValue({
      $queryRaw: database
        ? async () => [{ ready: 1 }]
        : async () => {
            throw new Error("database credentials must not be exposed");
          },
    })
    .overrideProvider(HealthRedisConnection)
    .useValue({
      ping: redis
        ? async () => "PONG"
        : async () => {
            throw new Error("redis credentials must not be exposed");
          },
    })
    .compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix("api/v1", {
    exclude: [{ path: "metrics", method: RequestMethod.GET }],
  });
  await app.listen(0, "127.0.0.1");
  applications.push(app);
  return `${await app.getUrl()}/api/v1/health`;
}

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
});

test("readiness reports PostgreSQL and Redis availability", async () => {
  const baseUrl = await createHealthApp();
  const response = await fetch(`${baseUrl}/ready`);
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.equal(body.status, "ok");
  assert.equal(body.service, "rdps-api");
  assert.deepEqual(body.checks, { database: "ok", redis: "ok" });
  assert.equal(typeof body.timestamp, "string");
  assert.equal(Number.isNaN(Date.parse(body.timestamp as string)), false);
});

test("readiness returns service unavailable when PostgreSQL is down", async () => {
  const baseUrl = await createHealthApp({ database: false });
  const response = await fetch(`${baseUrl}/ready`);
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 503);
  assert.equal(body.status, "error");
  assert.deepEqual(body.checks, { database: "error", redis: "ok" });
  assert.doesNotMatch(JSON.stringify(body), /credentials/);
});

test("readiness returns service unavailable when Redis is down", async () => {
  const baseUrl = await createHealthApp({ redis: false });
  const response = await fetch(`${baseUrl}/ready`);
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 503);
  assert.equal(body.status, "error");
  assert.deepEqual(body.checks, { database: "ok", redis: "error" });
  assert.doesNotMatch(JSON.stringify(body), /credentials/);
});

test("liveness stays healthy when backing services are unavailable", async () => {
  const baseUrl = await createHealthApp({ database: false, redis: false });
  const response = await fetch(baseUrl);

  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "ok");
});
