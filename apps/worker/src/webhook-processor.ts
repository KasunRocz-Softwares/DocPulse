import type {
  DeploymentWebhookJob,
  GithubWebhookJob,
} from "../../api/src/integrations/webhook-contracts.js";

export const WEBHOOK_JOB_DEFAULTS = {
  attempts: 8,
  backoff: { type: "exponential" as const, delay: 1_000 },
};

export interface WebhookEventHandlers {
  processGitHub(event: GithubWebhookJob & { eventId?: string }): Promise<void>;
  processDeployment(
    event: DeploymentWebhookJob & { eventId?: string },
  ): Promise<void>;
}

export interface WebhookJobLike {
  data: unknown;
}

export function createWebhookProcessor(handlers: WebhookEventHandlers) {
  return async (job: WebhookJobLike): Promise<void> => {
    const event = job.data;
    if (!isRecord(event))
      throw new Error("Invalid webhook job: expected an object");
    if (event.kind === "github" && isGitHubJob(event)) {
      await handlers.processGitHub(event);
      return;
    }
    if (event.kind === "deployment" && isDeploymentJob(event)) {
      await handlers.processDeployment(event);
      return;
    }
    throw new Error(
      "Invalid webhook job: unsupported kind or malformed contract",
    );
  };
}

export function failureDiagnostic(error: unknown): {
  errorName: string;
  errorCode?: string;
} {
  const fields =
    error !== null && typeof error === "object"
      ? (error as { name?: unknown; code?: unknown })
      : {};
  const name =
    typeof fields.name === "string" &&
    /^[A-Za-z][A-Za-z0-9_.]{0,79}$/.test(fields.name)
      ? fields.name
      : "Error";
  const code =
    typeof fields.code === "string" && /^[A-Z0-9_-]{1,40}$/.test(fields.code)
      ? fields.code
      : undefined;
  return { errorName: name, ...(code ? { errorCode: code } : {}) };
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isGitHubJob(
  value: Record<string, any>,
): value is GithubWebhookJob & { eventId?: string } {
  return (
    typeof value.repository === "string" &&
    typeof value.action === "string" &&
    ["push", "pull_request", "issues", "release"].includes(value.eventType) &&
    isRecord(value.reference) &&
    typeof value.reference.kind === "string" &&
    typeof value.reference.externalId === "string" &&
    (value.eventId === undefined || typeof value.eventId === "string")
  );
}

function isDeploymentJob(
  value: Record<string, any>,
): value is DeploymentWebhookJob & { eventId?: string } {
  return (
    typeof value.provider === "string" &&
    typeof value.deploymentId === "string" &&
    typeof value.projectId === "string" &&
    typeof value.releaseId === "string" &&
    typeof value.environmentId === "string" &&
    ["queued", "in_progress", "succeeded", "failed", "cancelled"].includes(
      value.status,
    ) &&
    typeof value.occurredAt === "string" &&
    Number.isFinite(Date.parse(value.occurredAt)) &&
    (value.eventId === undefined || typeof value.eventId === "string")
  );
}
