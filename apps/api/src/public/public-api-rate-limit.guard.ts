import {
  CanActivate,
  ExecutionContext,
  Inject,
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import IORedis from "ioredis";
import {
  normalizeIp,
  PublicApiRateLimitOptions,
} from "./public-api-rate-limit.config";

export const PUBLIC_API_RATE_LIMIT_OPTIONS = Symbol(
  "PUBLIC_API_RATE_LIMIT_OPTIONS",
);

const INCREMENT_WITH_EXPIRY = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return { count, redis.call('PTTL', KEYS[1]) }
`;

interface RedisCounter {
  eval(
    script: string,
    numberOfKeys: number,
    key: string,
    ttlMs: number,
  ): Promise<[number, number]>;
}

@Injectable()
export class PublicApiRateLimitRedisConnection
  implements RedisCounter, OnModuleDestroy
{
  private readonly connection: IORedis;

  constructor() {
    const url = process.env.REDIS_URL;
    if (!url)
      throw new Error("REDIS_URL is required for public API rate limiting");
    this.connection = new IORedis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  }

  eval(script: string, numberOfKeys: number, key: string, ttlMs: number) {
    return this.connection.eval(
      script,
      numberOfKeys,
      key,
      String(ttlMs),
    ) as Promise<[number, number]>;
  }

  async onModuleDestroy() {
    await this.connection.quit();
  }
}

interface RateLimitRequest {
  originalUrl?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress?: string };
}

interface RateLimitResponse {
  setHeader(name: string, value: string): void;
}

@Injectable()
export class PublicApiRateLimitGuard implements CanActivate {
  constructor(
    @Inject(PublicApiRateLimitRedisConnection)
    private readonly redis: RedisCounter,
    @Inject(PUBLIC_API_RATE_LIMIT_OPTIONS)
    private readonly options: PublicApiRateLimitOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<RateLimitRequest>();
    const response = http.getResponse<RateLimitResponse>();
    const path =
      (request.originalUrl ?? request.url ?? "").split("?", 1)[0] ?? "";
    if (!/^\/api\/v1\/public(?:\/|$)/.test(path)) return true;

    const now = Date.now();
    const windowMs = this.options.windowSeconds * 1_000;
    const bucket = Math.floor(now / windowMs);
    const ttlMs = Math.max(1, windowMs - (now % windowMs));
    const address = this.clientAddress(request);
    const addressHash = createHash("sha256").update(address).digest("hex");
    const key = `rdps:public-api-rate-limit:v1:${addressHash}:${bucket}`;

    let count: number;
    let remainingMs: number;
    try {
      [count, remainingMs] = await this.redis.eval(
        INCREMENT_WITH_EXPIRY,
        1,
        key,
        ttlMs,
      );
    } catch {
      throw new ServiceUnavailableException(
        "Public API rate limiting is temporarily unavailable",
      );
    }

    if (count > this.options.limit) {
      response.setHeader(
        "Retry-After",
        String(Math.max(1, Math.ceil(remainingMs / 1_000))),
      );
      throw new HttpException(
        "Public API rate limit exceeded",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private clientAddress(request: RateLimitRequest): string {
    const remoteAddress = normalizeIp(
      request.socket.remoteAddress ?? "unknown",
    );
    if (!this.options.trustedProxyIps.includes(remoteAddress))
      return remoteAddress;

    const forwardedFor = request.headers["x-forwarded-for"];
    if (typeof forwardedFor !== "string") return remoteAddress;
    const chain = forwardedFor.split(",").map(normalizeIp);
    if (!chain.length || chain.some((ip) => !isIP(ip))) return remoteAddress;

    let index = chain.length - 1;
    while (index > 0 && this.options.trustedProxyIps.includes(chain[index]!))
      index -= 1;
    return chain[index]!;
  }
}
