import { isIP } from "node:net";
import { z } from "zod";

const schema = z.object({
  PUBLIC_API_RATE_LIMIT: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000_000)
    .default(120),
  PUBLIC_API_RATE_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(3_600)
    .default(60),
  TRUSTED_PROXY_IPS: z.string().default(""),
});

export interface PublicApiRateLimitOptions {
  limit: number;
  windowSeconds: number;
  trustedProxyIps: string[];
}

export function parsePublicApiRateLimitOptions(
  source: Record<string, string | undefined> = process.env,
): PublicApiRateLimitOptions {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const keys = [
      ...new Set(parsed.error.issues.map((issue) => String(issue.path[0]))),
    ];
    throw new Error(
      `Invalid public API rate-limit configuration: ${keys.join(", ")}`,
    );
  }

  const trustedProxyIps = parsed.data.TRUSTED_PROXY_IPS.split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
  if (trustedProxyIps.length > 32 || trustedProxyIps.some((ip) => !isIP(ip))) {
    throw new Error(
      "Invalid public API rate-limit configuration: TRUSTED_PROXY_IPS",
    );
  }

  return {
    limit: parsed.data.PUBLIC_API_RATE_LIMIT,
    windowSeconds: parsed.data.PUBLIC_API_RATE_WINDOW_SECONDS,
    trustedProxyIps: [...new Set(trustedProxyIps.map(normalizeIp))],
  };
}

export function normalizeIp(ip: string): string {
  const normalized = ip.trim().toLowerCase();
  return normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
}
