import { z } from "zod";
import { isIP } from "node:net";

const defaults = {
  databaseUrl:
    "postgresql://rdps:rdps_dev_only@localhost:5432/rdps?schema=public",
  redisUrl: "redis://localhost:6379",
  jwtAccessSecret: "development-only-access-secret-change-me",
  bootstrapSecret: "development-only-bootstrap-secret-change-me",
  workerSecret: "development-only-worker-secret-change-me",
  notificationSecret: "development-only-notification-secret-change-me",
  githubWebhookSecret: "development-only-github-webhook-secret-change-me",
  deploymentWebhookSecret:
    "development-only-deployment-webhook-secret-change-me",
} as const;

const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const secret = z.preprocess(emptyToUndefined, z.string().min(32).optional());
const url = (fallback?: string) =>
  z
    .preprocess(emptyToUndefined, z.string().url().optional())
    .transform((value) => value ?? fallback);

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: url(defaults.databaseUrl),
  REDIS_URL: url(defaults.redisUrl),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  JWT_ACCESS_SECRET: secret.transform(
    (value) => value ?? defaults.jwtAccessSecret,
  ),
  JWT_ACCESS_TTL: z.string().min(1).default("15m"),
  BOOTSTRAP_SECRET: secret.transform(
    (value) => value ?? defaults.bootstrapSecret,
  ),
  RDPS_WORKER_SHARED_SECRET: secret.transform(
    (value) => value ?? defaults.workerSecret,
  ),
  NOTIFICATION_WORKER_SECRET: secret.transform(
    (value) => value ?? defaults.notificationSecret,
  ),
  GITHUB_WEBHOOK_SECRET: secret.transform(
    (value) => value ?? defaults.githubWebhookSecret,
  ),
  DEPLOYMENT_WEBHOOK_SECRET: secret.transform(
    (value) => value ?? defaults.deploymentWebhookSecret,
  ),
  PUBLIC_BASE_URL: url("http://localhost:5174"),
  WEB_BASE_URL: z
    .string()
    .default("http://localhost:5173,http://localhost:5174"),
  RDPS_API_URL: url("http://localhost:3001"),
  OIDC_ISSUER: url(),
  OIDC_CLIENT_ID: optionalString,
  OIDC_CLIENT_SECRET: optionalString,
  OIDC_CALLBACK_URL: url(),
  OIDC_STATE_SECRET: secret,
  OIDC_AUTO_PROVISION: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  EMAIL_DELIVERY_URL: url(),
  EMAIL_DELIVERY_TOKEN: optionalString,
  DEPLOYMENT_RUNNER_URL: url(),
  DEPLOYMENT_RUNNER_SIGNING_SECRET: secret,
  GITHUB_APP_WEBHOOK_SECRET: secret,
  GITHUB_APP_ID: optionalString,
  GITHUB_APP_SLUG: optionalString,
  GITHUB_APP_PRIVATE_KEY: optionalString,
  GITHUB_APP_ADMIN_ORIGIN: url("http://localhost:5173"),
  RDPS_API_PUBLIC_ORIGIN: url(),
  RDPS_OIDC_ADMIN_ORIGIN: url(),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
  NOTIFICATION_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
  ANALYTICS_EXPORT_CONCURRENCY: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(2),
  DEPLOYMENT_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(2),
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

export interface Environment {
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  redisUrl: string;
  apiPort: number;
  jwtAccessSecret: string;
  jwtAccessTtl: string;
  bootstrapSecret: string;
  rdpsWorkerSharedSecret: string;
  notificationWorkerSecret: string;
  githubWebhookSecret: string;
  deploymentWebhookSecret: string;
  publicBaseUrl: string;
  webBaseUrls: string[];
  rdpsApiUrl: string;
  oidcIssuer?: string;
  oidcClientId?: string;
  oidcClientSecret?: string;
  oidcCallbackUrl?: string;
  oidcStateSecret?: string;
  oidcAutoProvision: boolean;
  emailDeliveryUrl?: string;
  emailDeliveryToken?: string;
  deploymentRunnerUrl?: string;
  deploymentRunnerSigningSecret?: string;
  githubAppWebhookSecret?: string;
  githubAppId?: string;
  githubAppSlug?: string;
  githubAppPrivateKey?: string;
  githubAppAdminOrigin: string;
  rdpsApiPublicOrigin?: string;
  rdpsOidcAdminOrigin?: string;
  workerConcurrency: number;
  notificationConcurrency: number;
  analyticsExportConcurrency: number;
  deploymentConcurrency: number;
  publicApiRateLimit: number;
  publicApiRateWindowSeconds: number;
  trustedProxyIps: string[];
}

const productionSecretDefaults = [
  ["JWT_ACCESS_SECRET", defaults.jwtAccessSecret],
  ["BOOTSTRAP_SECRET", defaults.bootstrapSecret],
  ["RDPS_WORKER_SHARED_SECRET", defaults.workerSecret],
  ["NOTIFICATION_WORKER_SECRET", defaults.notificationSecret],
  ["GITHUB_WEBHOOK_SECRET", defaults.githubWebhookSecret],
  ["DEPLOYMENT_WEBHOOK_SECRET", defaults.deploymentWebhookSecret],
] as const;

export function parseEnvironment(
  source: Record<string, string | undefined> = process.env,
): Environment {
  const parsed = environmentSchema.safeParse(source);
  if (!parsed.success) {
    const keys = [
      ...new Set(
        parsed.error.issues.map((issue) =>
          String(issue.path[0] ?? "environment"),
        ),
      ),
    ];
    throw new Error(`Invalid environment configuration: ${keys.join(", ")}`);
  }
  const raw = parsed.data;
  const errors: string[] = [];
  if (raw.NODE_ENV === "production") {
    const required = [
      "DATABASE_URL",
      "REDIS_URL",
      "JWT_ACCESS_SECRET",
      "BOOTSTRAP_SECRET",
      "RDPS_WORKER_SHARED_SECRET",
      "NOTIFICATION_WORKER_SECRET",
      "GITHUB_WEBHOOK_SECRET",
      "DEPLOYMENT_WEBHOOK_SECRET",
      "PUBLIC_BASE_URL",
      "WEB_BASE_URL",
    ] as const;
    for (const key of required) if (!source[key]?.trim()) errors.push(key);
    for (const [key, value] of productionSecretDefaults)
      if (source[key] === value)
        errors.push(`${key} must not use the built-in development value`);
  }
  const oidc = [
    raw.OIDC_ISSUER,
    raw.OIDC_CLIENT_ID,
    raw.OIDC_CLIENT_SECRET,
    raw.OIDC_CALLBACK_URL,
    raw.OIDC_STATE_SECRET,
  ];
  if (oidc.some(Boolean) && oidc.some((value) => !value))
    errors.push(
      "OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_CALLBACK_URL, OIDC_STATE_SECRET",
    );
  if (raw.DEPLOYMENT_RUNNER_URL && !raw.DEPLOYMENT_RUNNER_SIGNING_SECRET)
    errors.push(
      "DEPLOYMENT_RUNNER_SIGNING_SECRET (required when DEPLOYMENT_RUNNER_URL is set)",
    );
  const githubApp = [
    raw.GITHUB_APP_ID,
    raw.GITHUB_APP_SLUG,
    raw.GITHUB_APP_PRIVATE_KEY,
    raw.GITHUB_APP_WEBHOOK_SECRET,
  ];
  if (githubApp.some(Boolean) && githubApp.some((value) => !value))
    errors.push(
      "GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_WEBHOOK_SECRET",
    );
  if (errors.length)
    throw new Error(`Invalid environment configuration: ${errors.join(", ")}`);
  const webBaseUrls = raw.WEB_BASE_URL.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    !webBaseUrls.length ||
    webBaseUrls.some((value) => !z.string().url().safeParse(value).success)
  )
    throw new Error("Invalid environment configuration: WEB_BASE_URL");
  const trustedProxyIps = raw.TRUSTED_PROXY_IPS.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    trustedProxyIps.length > 32 ||
    trustedProxyIps.some((value) => !isIP(value))
  )
    throw new Error("Invalid environment configuration: TRUSTED_PROXY_IPS");
  return {
    nodeEnv: raw.NODE_ENV,
    databaseUrl: raw.DATABASE_URL!,
    redisUrl: raw.REDIS_URL!,
    apiPort: raw.API_PORT,
    jwtAccessSecret: raw.JWT_ACCESS_SECRET,
    jwtAccessTtl: raw.JWT_ACCESS_TTL,
    bootstrapSecret: raw.BOOTSTRAP_SECRET,
    rdpsWorkerSharedSecret: raw.RDPS_WORKER_SHARED_SECRET,
    notificationWorkerSecret: raw.NOTIFICATION_WORKER_SECRET,
    githubWebhookSecret: raw.GITHUB_WEBHOOK_SECRET,
    deploymentWebhookSecret: raw.DEPLOYMENT_WEBHOOK_SECRET,
    publicBaseUrl: raw.PUBLIC_BASE_URL!,
    webBaseUrls,
    rdpsApiUrl: raw.RDPS_API_URL!,
    ...(raw.OIDC_ISSUER ? { oidcIssuer: raw.OIDC_ISSUER } : {}),
    ...(raw.OIDC_CLIENT_ID ? { oidcClientId: raw.OIDC_CLIENT_ID } : {}),
    ...(raw.OIDC_CLIENT_SECRET
      ? { oidcClientSecret: raw.OIDC_CLIENT_SECRET }
      : {}),
    ...(raw.OIDC_CALLBACK_URL
      ? { oidcCallbackUrl: raw.OIDC_CALLBACK_URL }
      : {}),
    ...(raw.OIDC_STATE_SECRET
      ? { oidcStateSecret: raw.OIDC_STATE_SECRET }
      : {}),
    oidcAutoProvision: raw.OIDC_AUTO_PROVISION,
    ...(raw.EMAIL_DELIVERY_URL
      ? { emailDeliveryUrl: raw.EMAIL_DELIVERY_URL }
      : {}),
    ...(raw.EMAIL_DELIVERY_TOKEN
      ? { emailDeliveryToken: raw.EMAIL_DELIVERY_TOKEN }
      : {}),
    ...(raw.DEPLOYMENT_RUNNER_URL
      ? { deploymentRunnerUrl: raw.DEPLOYMENT_RUNNER_URL }
      : {}),
    ...(raw.DEPLOYMENT_RUNNER_SIGNING_SECRET
      ? { deploymentRunnerSigningSecret: raw.DEPLOYMENT_RUNNER_SIGNING_SECRET }
      : {}),
    ...(raw.GITHUB_APP_WEBHOOK_SECRET
      ? { githubAppWebhookSecret: raw.GITHUB_APP_WEBHOOK_SECRET }
      : {}),
    ...(raw.GITHUB_APP_ID ? { githubAppId: raw.GITHUB_APP_ID } : {}),
    ...(raw.GITHUB_APP_SLUG ? { githubAppSlug: raw.GITHUB_APP_SLUG } : {}),
    ...(raw.GITHUB_APP_PRIVATE_KEY
      ? { githubAppPrivateKey: raw.GITHUB_APP_PRIVATE_KEY }
      : {}),
    githubAppAdminOrigin: raw.GITHUB_APP_ADMIN_ORIGIN!,
    ...(raw.RDPS_API_PUBLIC_ORIGIN
      ? { rdpsApiPublicOrigin: raw.RDPS_API_PUBLIC_ORIGIN }
      : {}),
    ...(raw.RDPS_OIDC_ADMIN_ORIGIN
      ? { rdpsOidcAdminOrigin: raw.RDPS_OIDC_ADMIN_ORIGIN }
      : {}),
    workerConcurrency: raw.WORKER_CONCURRENCY,
    notificationConcurrency: raw.NOTIFICATION_CONCURRENCY,
    analyticsExportConcurrency: raw.ANALYTICS_EXPORT_CONCURRENCY,
    deploymentConcurrency: raw.DEPLOYMENT_CONCURRENCY,
    publicApiRateLimit: raw.PUBLIC_API_RATE_LIMIT,
    publicApiRateWindowSeconds: raw.PUBLIC_API_RATE_WINDOW_SECONDS,
    trustedProxyIps: [
      ...new Set(
        trustedProxyIps.map((value) =>
          value.toLowerCase().startsWith("::ffff:")
            ? value.toLowerCase().slice(7)
            : value.toLowerCase(),
        ),
      ),
    ],
  };
}

/** Validate startup configuration and materialize only omitted values for legacy env consumers. */
export function applyEnvironment(
  target: Record<string, string | undefined> = process.env,
): Environment {
  const environment = parseEnvironment(target);
  const defaults: Record<string, string | undefined> = {
    NODE_ENV: environment.nodeEnv,
    DATABASE_URL: environment.databaseUrl,
    REDIS_URL: environment.redisUrl,
    API_PORT: String(environment.apiPort),
    JWT_ACCESS_SECRET: environment.jwtAccessSecret,
    JWT_ACCESS_TTL: environment.jwtAccessTtl,
    BOOTSTRAP_SECRET: environment.bootstrapSecret,
    RDPS_WORKER_SHARED_SECRET: environment.rdpsWorkerSharedSecret,
    NOTIFICATION_WORKER_SECRET: environment.notificationWorkerSecret,
    GITHUB_WEBHOOK_SECRET: environment.githubWebhookSecret,
    DEPLOYMENT_WEBHOOK_SECRET: environment.deploymentWebhookSecret,
    PUBLIC_BASE_URL: environment.publicBaseUrl,
    WEB_BASE_URL: environment.webBaseUrls.join(","),
    RDPS_API_URL: environment.rdpsApiUrl,
    OIDC_ISSUER: environment.oidcIssuer,
    OIDC_CLIENT_ID: environment.oidcClientId,
    OIDC_CLIENT_SECRET: environment.oidcClientSecret,
    OIDC_CALLBACK_URL: environment.oidcCallbackUrl,
    OIDC_STATE_SECRET: environment.oidcStateSecret,
    OIDC_AUTO_PROVISION: String(environment.oidcAutoProvision),
    EMAIL_DELIVERY_URL: environment.emailDeliveryUrl,
    EMAIL_DELIVERY_TOKEN: environment.emailDeliveryToken,
    DEPLOYMENT_RUNNER_URL: environment.deploymentRunnerUrl,
    DEPLOYMENT_RUNNER_SIGNING_SECRET: environment.deploymentRunnerSigningSecret,
    GITHUB_APP_WEBHOOK_SECRET: environment.githubAppWebhookSecret,
    GITHUB_APP_ID: environment.githubAppId,
    GITHUB_APP_SLUG: environment.githubAppSlug,
    GITHUB_APP_PRIVATE_KEY: environment.githubAppPrivateKey,
    GITHUB_APP_ADMIN_ORIGIN: environment.githubAppAdminOrigin,
    RDPS_API_PUBLIC_ORIGIN: environment.rdpsApiPublicOrigin,
    RDPS_OIDC_ADMIN_ORIGIN: environment.rdpsOidcAdminOrigin,
    WORKER_CONCURRENCY: String(environment.workerConcurrency),
    NOTIFICATION_CONCURRENCY: String(environment.notificationConcurrency),
    ANALYTICS_EXPORT_CONCURRENCY: String(
      environment.analyticsExportConcurrency,
    ),
    DEPLOYMENT_CONCURRENCY: String(environment.deploymentConcurrency),
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (
      (target[key] === undefined || target[key] === "") &&
      value !== undefined
    )
      target[key] = value;
  }
  return environment;
}
