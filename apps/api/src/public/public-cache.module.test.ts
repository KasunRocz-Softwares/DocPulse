import * as assert from "node:assert/strict";
import "reflect-metadata";
import { test } from "node:test";
import { Test } from "@nestjs/testing";
import { PublicCacheModule } from "./public-cache.module";
import {
  PublicCacheRedisConnection,
  PublicResponseCache,
} from "./public-response-cache.service";

test("public cache module injects its Redis client into the response cache", async () => {
  const injectedParameters = Reflect.getMetadata(
    "self:paramtypes",
    PublicResponseCache,
  ) as Array<{ index: number; param: unknown }> | undefined;
  assert.ok(
    injectedParameters?.some(
      ({ index, param }) => index === 0 && param === PublicCacheRedisConnection,
    ),
  );

  const module = await Test.createTestingModule({
    imports: [PublicCacheModule],
  })
    .overrideProvider(PublicCacheRedisConnection)
    .useValue({
      get: async () => null,
      set: async () => "OK",
      incr: async () => 1,
    })
    .compile();

  assert.ok(module.get(PublicResponseCache));
  await module.close();
});
