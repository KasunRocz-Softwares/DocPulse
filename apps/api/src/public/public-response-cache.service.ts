import { Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { createHash } from "node:crypto";
import IORedis from "ioredis";

export type PublicCacheScope =
  { kind: "directory" } | { kind: "project"; slug: string };

export type PublicCacheState = "HIT" | "MISS" | "BYPASS";

export interface PublicCacheResult<T> {
  value: T;
  state: PublicCacheState;
}

interface RedisCacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
  incr(key: string): Promise<number>;
  del?(key: string): Promise<number>;
}

const CACHE_PREFIX = "rdps:public-response:v1";
export const PUBLIC_RESPONSE_CACHE_TTL_SECONDS = 5;
const MAX_CACHE_ENTRY_BYTES = 1_048_576;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

@Injectable()
export class PublicCacheRedisConnection
  implements RedisCacheClient, OnModuleDestroy
{
  private readonly connection: IORedis;

  constructor() {
    const url = process.env.REDIS_URL;
    if (!url)
      throw new Error("REDIS_URL is required for public response caching");
    this.connection = new IORedis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  }

  get(key: string) {
    return this.connection.get(key);
  }

  set(key: string, value: string, mode: "EX", ttl: number) {
    return this.connection.set(key, value, mode, ttl);
  }

  incr(key: string) {
    return this.connection.incr(key);
  }

  del(key: string) {
    return this.connection.del(key);
  }

  async onModuleDestroy() {
    await this.connection.quit();
  }
}

@Injectable()
export class PublicResponseCache {
  private readonly logger = new Logger(PublicResponseCache.name);

  constructor(
    @Inject(PublicCacheRedisConnection)
    private readonly redis: RedisCacheClient,
  ) {}

  async getOrLoad<T>(
    scope: PublicCacheScope,
    keyMaterial: string,
    load: () => Promise<T>,
  ): Promise<PublicCacheResult<T>> {
    const scopeName = this.scopeName(scope);
    const generationKey = this.generationKey(scopeName);
    let cacheKey: string;

    try {
      const generation = (await this.redis.get(generationKey)) ?? "0";
      cacheKey = `${CACHE_PREFIX}:${digest(scopeName)}:${generation}:${digest(keyMaterial)}`;
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) {
        try {
          return { value: JSON.parse(cached) as T, state: "HIT" };
        } catch {
          await this.redis.del?.(cacheKey).catch(() => undefined);
        }
      }
    } catch (error) {
      this.logger.warn(
        `Public response cache read failed: ${this.errorMessage(error)}`,
      );
      return { value: await load(), state: "BYPASS" };
    }

    const value = await load();
    try {
      const serialized = JSON.stringify(value);
      if (
        serialized === undefined ||
        Buffer.byteLength(serialized, "utf8") > MAX_CACHE_ENTRY_BYTES
      )
        return { value, state: "BYPASS" };
      await this.redis.set(
        cacheKey,
        serialized,
        "EX",
        PUBLIC_RESPONSE_CACHE_TTL_SECONDS,
      );
      return { value, state: "MISS" };
    } catch (error) {
      this.logger.warn(
        `Public response cache write failed: ${this.errorMessage(error)}`,
      );
      return { value, state: "BYPASS" };
    }
  }

  async invalidateProject(slug: string): Promise<void> {
    try {
      await Promise.all([
        this.redis.incr(
          this.generationKey(this.scopeName({ kind: "project", slug })),
        ),
        this.redis.incr(
          this.generationKey(this.scopeName({ kind: "directory" })),
        ),
      ]);
    } catch (error) {
      this.logger.error(
        `Public response cache invalidation failed for project ${slug}: ${this.errorMessage(error)}`,
      );
    }
  }

  private scopeName(scope: PublicCacheScope): string {
    return scope.kind === "directory"
      ? "directory"
      : `project:${scope.slug.trim().toLowerCase()}`;
  }

  private generationKey(scopeName: string): string {
    return `${CACHE_PREFIX}:generation:${digest(scopeName)}`;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "unknown cache error";
  }
}
