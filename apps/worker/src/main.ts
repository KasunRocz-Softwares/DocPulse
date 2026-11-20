import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { applyEnvironment } from "@rdps/config";
import { createApiWebhookHandlers } from "./api-webhook-handlers.js";
import {
  createWebhookProcessor,
  failureDiagnostic,
  WEBHOOK_JOB_DEFAULTS,
} from "./webhook-processor.js";
import {
  createNotificationProcessor,
  NOTIFICATION_JOB_DEFAULTS,
  type NotificationMessage,
} from "./notification-processor.js";
import {
  createAnalyticsExportProcessor,
  ANALYTICS_EXPORT_JOB_DEFAULTS,
} from "./analytics-processor.js";
import {
  createDeploymentProcessor,
  DEPLOYMENT_JOB_DEFAULTS,
  parseDeploymentJob,
} from "./deployment-processor.js";
import {
  DEPLOYMENT_TRIGGER_JOB,
  DEPLOYMENT_TRIGGER_QUEUE,
} from "../../api/src/deployment-orchestration/deployment-contracts.js";

applyEnvironment();
const redisUrl = process.env.REDIS_URL;
if (!redisUrl)
  throw new Error("REDIS_URL must be configured before starting the worker");

const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
const deadLetterQueue = new Queue("webhooks-dead-letter", { connection });
const notificationDeadLetterQueue = new Queue("notifications-dead-letter", {
  connection,
});
const analyticsDeadLetterQueue = new Queue("analytics-exports-dead-letter", {
  connection,
});
const deploymentDeadLetterQueue = new Queue("deployment-triggers-dead-letter", {
  connection,
});
const webhookWorker = new Worker(
  "webhooks",
  createWebhookProcessor(createApiWebhookHandlers()),
  {
    connection,
    concurrency: positiveInteger(process.env.WORKER_CONCURRENCY, 5),
  },
);
const notificationsWorker = new Worker(
  "notifications",
  createNotificationProcessor({
    loadDelivery: async (_id, data) => {
      if (!isRecord(data) || !isRecord(data.message)) return null;
      const message = data.message;
      if (
        typeof message.to !== "string" ||
        typeof message.subject !== "string" ||
        typeof message.html !== "string" ||
        typeof message.text !== "string"
      )
        return null;
      return {
        id: _id,
        status: "PENDING",
        recipient: message.to,
        projectName: "",
        version: "",
        title: message.subject,
        publicUrl: "",
        unsubscribeUrl: "",
      };
    },
    send: sendEmail,
    markSent: (id) => reportDelivery(id, "sent"),
    markFailed: (id, diagnostic) =>
      reportDelivery(id, "failed", diagnostic.errorCode),
  }),
  {
    connection,
    concurrency: positiveInteger(process.env.NOTIFICATION_CONCURRENCY, 5),
  },
);
const analyticsExportsWorker = new Worker(
  "analytics-exports",
  createAnalyticsExportProcessor({
    processing: (id) => reportAnalyticsExport(id, "processing"),
    complete: (id, artifact) => reportAnalyticsExport(id, "complete", artifact),
    fail: (id, code) => reportAnalyticsExport(id, "failed", { code }),
  }),
  {
    connection,
    concurrency: positiveInteger(process.env.ANALYTICS_EXPORT_CONCURRENCY, 2),
  },
);
const deploymentWorker = new Worker<unknown>(
  DEPLOYMENT_TRIGGER_QUEUE,
  async (job) => {
    if (job.name !== DEPLOYMENT_TRIGGER_JOB)
      throw Object.assign(new Error("Unsupported deployment job"), {
        code: "DEPLOYMENT_JOB_INVALID",
      });
    // Optional runner configuration must not prevent unrelated worker queues
    // from starting while deployment triggers remain disabled.
    return createDeploymentProcessor({
      endpoint: process.env.DEPLOYMENT_RUNNER_URL ?? "",
      signingSecret: process.env.DEPLOYMENT_RUNNER_SIGNING_SECRET ?? "",
      callback: reportDeploymentDispatch,
      allowLocalHttp: ["development", "test"].includes(
        process.env.NODE_ENV ?? "",
      ),
    })(job);
  },
  {
    connection,
    concurrency: positiveInteger(process.env.DEPLOYMENT_CONCURRENCY, 2),
  },
);

analyticsExportsWorker.on("failed", async (job, error) => {
  const attempts = job?.opts.attempts ?? ANALYTICS_EXPORT_JOB_DEFAULTS.attempts;
  const exportId = safeExportId(job?.data);
  console.error(
    JSON.stringify({
      level: "error",
      service: "rdps-worker",
      event: "analytics_export.failed",
      exportId,
      attemptsMade: job?.attemptsMade,
      attempts,
      ...failureDiagnostic(error),
    }),
  );
  if (!job || job.attemptsMade < attempts || !exportId) return;
  try {
    await analyticsDeadLetterQueue.add(
      "failed-analytics-export",
      {
        exportId,
        failedAt: new Date().toISOString(),
        ...failureDiagnostic(error),
      },
      {
        jobId: `dead-${exportId}`,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );
  } catch (deadLetterError) {
    console.error(
      JSON.stringify({
        level: "error",
        service: "rdps-worker",
        event: "analytics_export.dead_letter_enqueue_failed",
        exportId,
        ...failureDiagnostic(deadLetterError),
      }),
    );
  }
});
analyticsExportsWorker.on("error", (error) =>
  console.error(
    JSON.stringify({
      level: "error",
      service: "rdps-worker",
      event: "analytics_export.worker_error",
      ...failureDiagnostic(error),
    }),
  ),
);

deploymentWorker.on("failed", async (job, error) => {
  const attempts = job?.opts.attempts ?? DEPLOYMENT_JOB_DEFAULTS.attempts;
  let requestId: string | undefined;
  try {
    requestId = parseDeploymentJob(job?.data).requestId;
  } catch {
    // Invalid queue data is reported by its safe diagnostic and still dead-lettered.
  }
  console.error(
    JSON.stringify({
      level: "error",
      service: "rdps-worker",
      event: "deployment_trigger.failed",
      requestId,
      attemptsMade: job?.attemptsMade,
      attempts,
      ...failureDiagnostic(error),
    }),
  );
  if (!job || job.attemptsMade < attempts) return;
  const diagnostic = failureDiagnostic(error);
  if (requestId && diagnostic.errorCode !== "DEPLOYMENT_CALLBACK_FAILED") {
    try {
      await reportDeploymentDispatch(
        requestId,
        "FAILED",
        diagnostic.errorCode ?? "RUNNER_REQUEST_FAILED",
        "Deployment runner did not accept the request after retries",
      );
    } catch (callbackError) {
      console.error(
        JSON.stringify({
          level: "error",
          service: "rdps-worker",
          event: "deployment_trigger.failure_callback_failed",
          requestId,
          ...failureDiagnostic(callbackError),
        }),
      );
    }
  }
  try {
    await deploymentDeadLetterQueue.add(
      "failed-deployment-trigger",
      {
        requestId,
        failedAt: new Date().toISOString(),
        ...diagnostic,
      },
      {
        jobId: `dead-${String(job.id)}`,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );
  } catch (deadLetterError) {
    console.error(
      JSON.stringify({
        level: "error",
        service: "rdps-worker",
        event: "deployment_trigger.dead_letter_enqueue_failed",
        requestId,
        ...failureDiagnostic(deadLetterError),
      }),
    );
  }
});
deploymentWorker.on("error", (error) =>
  console.error(
    JSON.stringify({
      level: "error",
      service: "rdps-worker",
      event: "deployment_trigger.worker_error",
      ...failureDiagnostic(error),
    }),
  ),
);

notificationsWorker.on("failed", async (job, error) => {
  const attempts = job?.opts.attempts ?? NOTIFICATION_JOB_DEFAULTS.attempts;
  console.error(
    JSON.stringify({
      level: "error",
      service: "rdps-worker",
      event: "notification.failed",
      deliveryId: safeDeliveryId(job?.data),
      attemptsMade: job?.attemptsMade,
      attempts,
      ...failureDiagnostic(error),
    }),
  );
  if (!job || job.attemptsMade < attempts) return;
  const deliveryId = safeDeliveryId(job.data);
  if (!deliveryId) return;
  try {
    await reportDelivery(deliveryId, "dead");
    await notificationDeadLetterQueue.add(
      "failed-notification",
      {
        deliveryId,
        failedAt: new Date().toISOString(),
        ...failureDiagnostic(error),
      },
      {
        jobId: `dead-${deliveryId}`,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );
  } catch (deadLetterError) {
    console.error(
      JSON.stringify({
        level: "error",
        service: "rdps-worker",
        event: "notification.dead_letter_enqueue_failed",
        deliveryId,
        ...failureDiagnostic(deadLetterError),
      }),
    );
  }
});
notificationsWorker.on("error", (error) =>
  console.error(
    JSON.stringify({
      level: "error",
      service: "rdps-worker",
      event: "notification.worker_error",
      ...failureDiagnostic(error),
    }),
  ),
);

webhookWorker.on("failed", async (job, error) => {
  const attempts = job?.opts.attempts ?? WEBHOOK_JOB_DEFAULTS.attempts;
  console.error(
    JSON.stringify({
      level: "error",
      service: "rdps-worker",
      event: "webhook.failed",
      jobId: job?.id,
      eventId:
        isRecord(job?.data) && typeof job.data.eventId === "string"
          ? job.data.eventId
          : undefined,
      attemptsMade: job?.attemptsMade,
      attempts,
      ...failureDiagnostic(error),
    }),
  );

  if (!job || job.attemptsMade < attempts) return;
  const identity = safeJobIdentity(job.data);
  try {
    await deadLetterQueue.add(
      "failed-webhook",
      {
        sourceJobId: String(job.id),
        ...identity,
        attemptsMade: job.attemptsMade,
        ...failureDiagnostic(error),
        failedAt: new Date().toISOString(),
      },
      {
        jobId: `dead-${String(job.id)}`,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );
  } catch (deadLetterError) {
    console.error(
      JSON.stringify({
        level: "error",
        service: "rdps-worker",
        event: "webhook.dead_letter_enqueue_failed",
        jobId: job.id,
        ...failureDiagnostic(deadLetterError),
      }),
    );
  }
});

webhookWorker.on("error", (error) => {
  console.error(
    JSON.stringify({
      level: "error",
      service: "rdps-worker",
      event: "worker.error",
      ...failureDiagnostic(error),
    }),
  );
});

console.info(
  JSON.stringify({
    level: "info",
    service: "rdps-worker",
    consumesQueues: [
      "webhooks",
      "notifications",
      "analytics-exports",
      DEPLOYMENT_TRIGGER_QUEUE,
    ],
    producesQueues: [
      "webhooks-dead-letter",
      "notifications-dead-letter",
      "analytics-exports-dead-letter",
      "deployment-triggers-dead-letter",
    ],
    deadLetterConsumer: false,
    concurrency: positiveInteger(process.env.WORKER_CONCURRENCY, 5),
  }),
);

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  console.info(
    JSON.stringify({
      level: "info",
      service: "rdps-worker",
      event: "shutdown",
      signal,
    }),
  );
  await Promise.all([
    webhookWorker.close(),
    notificationsWorker.close(),
    analyticsExportsWorker.close(),
    deploymentWorker.close(),
    deadLetterQueue.close(),
    notificationDeadLetterQueue.close(),
    analyticsDeadLetterQueue.close(),
    deploymentDeadLetterQueue.close(),
  ]);
  await connection.quit();
  process.exit(0);
}

async function reportDeploymentDispatch(
  requestId: string,
  outcome: "ACCEPTED" | "FAILED",
  code: string,
  summary: string,
): Promise<void> {
  const baseUrl = process.env.RDPS_API_URL;
  const secret = process.env.RDPS_WORKER_SHARED_SECRET;
  if (!baseUrl || !secret)
    throw Object.assign(new Error("Deployment callback is not configured"), {
      code: "WORKER_CALLBACK_UNCONFIGURED",
    });
  let apiBase: URL;
  try {
    apiBase = new URL(baseUrl);
  } catch {
    throw Object.assign(new Error("Deployment callback URL is invalid"), {
      code: "WORKER_CALLBACK_URL_INVALID",
    });
  }
  if (
    (apiBase.protocol !== "https:" && apiBase.protocol !== "http:") ||
    apiBase.username ||
    apiBase.password ||
    apiBase.search ||
    apiBase.hash
  )
    throw Object.assign(new Error("Deployment callback URL is invalid"), {
      code: "WORKER_CALLBACK_URL_INVALID",
    });
  let response: Response;
  try {
    response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/api/v1/internal/deployment-orchestration/worker/requests/${encodeURIComponent(requestId)}/status`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          "X-RDPS-Worker-Secret": secret,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: outcome,
          resultCode: code,
          resultSummary: summary,
        }),
      },
    );
  } catch {
    throw Object.assign(new Error("Deployment state callback failed"), {
      code: "DEPLOYMENT_CALLBACK_FAILED",
    });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw Object.assign(new Error("Deployment state callback failed"), {
      code: "DEPLOYMENT_CALLBACK_FAILED",
    });
  }
  await response.body?.cancel().catch(() => undefined);
}

async function sendEmail(message: NotificationMessage): Promise<void> {
  const endpoint = process.env.EMAIL_DELIVERY_URL;
  if (!endpoint)
    throw Object.assign(
      new Error("Email delivery transport is not configured"),
      { code: "EMAIL_TRANSPORT_UNCONFIGURED" },
    );
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.EMAIL_DELIVERY_TOKEN
        ? { Authorization: `Bearer ${process.env.EMAIL_DELIVERY_TOKEN}` }
        : {}),
    },
    body: JSON.stringify(message),
  });
  if (!response.ok)
    throw Object.assign(
      new Error("Email delivery provider rejected the message"),
      { code: `EMAIL_HTTP_${response.status}` },
    );
}

async function reportDelivery(
  id: string,
  outcome: "sent" | "failed" | "dead",
  code?: string,
): Promise<void> {
  const baseUrl = process.env.RDPS_API_URL;
  const secret = process.env.NOTIFICATION_WORKER_SECRET;
  if (!baseUrl || !secret)
    throw Object.assign(
      new Error("Notification worker callback is not configured"),
      { code: "WORKER_CALLBACK_UNCONFIGURED" },
    );
  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/api/v1/internal/notifications/worker/deliveries/${encodeURIComponent(id)}/${outcome}`,
    {
      method: "POST",
      headers: {
        "X-RDPS-Worker-Secret": secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(code ? { code } : {}),
    },
  );
  if (!response.ok)
    throw Object.assign(
      new Error("Notification delivery state update failed"),
      { code: `API_HTTP_${response.status}` },
    );
}

async function reportAnalyticsExport(
  id: string,
  outcome: "processing" | "complete" | "failed",
  data?: unknown,
): Promise<void> {
  const baseUrl = process.env.RDPS_API_URL;
  const secret = process.env.RDPS_WORKER_SHARED_SECRET;
  if (!baseUrl || !secret)
    throw Object.assign(
      new Error("Analytics worker callback is not configured"),
      { code: "WORKER_CALLBACK_UNCONFIGURED" },
    );
  const suffix =
    outcome === "complete"
      ? "complete"
      : outcome === "failed"
        ? "failed"
        : "processing";
  const artifact =
    outcome === "complete" && isRecord(data) && typeof data.content === "string"
      ? Buffer.from(data.content, "base64")
      : undefined;
  const headers: Record<string, string> = {
    "X-RDPS-Worker-Secret": secret,
    "Content-Type": artifact ? "application/octet-stream" : "application/json",
    ...(artifact && isRecord(data) && typeof data.contentType === "string"
      ? { "X-Export-Content-Type": data.contentType }
      : {}),
  };
  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/api/v1/internal/analytics/worker/exports/${encodeURIComponent(id)}/${suffix}`,
    {
      method: "POST",
      headers,
      body: artifact ?? JSON.stringify(data ?? {}),
    },
  );
  if (!response.ok)
    throw Object.assign(new Error("Analytics export state update failed"), {
      code: `API_HTTP_${response.status}`,
    });
}

function safeDeliveryId(data: unknown): string | undefined {
  return isRecord(data) &&
    typeof data.deliveryId === "string" &&
    /^[0-9a-f-]{20,64}$/i.test(data.deliveryId)
    ? data.deliveryId
    : undefined;
}
function safeExportId(data: unknown): string | undefined {
  return isRecord(data) &&
    typeof data.exportId === "string" &&
    /^[0-9a-f-]{20,64}$/i.test(data.exportId)
    ? data.exportId
    : undefined;
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = value ? Number(value) : fallback;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeJobIdentity(data: unknown): Record<string, string> {
  if (!isRecord(data)) return {};
  return {
    ...(typeof data.eventId === "string" ? { eventId: data.eventId } : {}),
    ...(data.kind === "github" || data.kind === "deployment"
      ? { kind: data.kind }
      : {}),
  };
}
