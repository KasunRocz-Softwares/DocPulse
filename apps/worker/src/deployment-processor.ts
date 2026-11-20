import { createHmac } from "node:crypto";
import type { DeploymentTriggerJob } from "../../api/src/deployment-orchestration/deployment-contracts.js";

export const DEPLOYMENT_JOB_DEFAULTS = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 2_000 },
  removeOnComplete: 1_000,
  removeOnFail: 1_000,
};

export interface DeploymentJobLike {
  data: unknown;
}

export interface DeploymentProcessorOptions {
  endpoint: string;
  signingSecret: string;
  callback: (
    requestId: string,
    outcome: "ACCEPTED" | "FAILED",
    code: string,
    summary: string,
  ) => Promise<void>;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  allowLocalHttp?: boolean;
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 8_192;

export function createDeploymentProcessor(options: DeploymentProcessorOptions) {
  const endpoint = validateEndpoint(
    options.endpoint,
    options.allowLocalHttp === true,
  );
  if (options.signingSecret.length < 32)
    throw codedError(
      "Deployment runner signing secret must be at least 32 characters",
      "DEPLOYMENT_SIGNING_SECRET_INVALID",
    );
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = positiveBoundedInteger(
    options.timeoutMs,
    DEFAULT_TIMEOUT_MS,
  );
  const maxResponseBytes = positiveBoundedInteger(
    options.maxResponseBytes,
    MAX_RESPONSE_BYTES,
  );

  return async (job: DeploymentJobLike): Promise<void> => {
    const payload = parseJob(job.data);
    const body = JSON.stringify(payload);
    const timestamp = String((options.now ?? Date.now)());
    const signature = createHmac("sha256", options.signingSecret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    let response: Response;
    try {
      response = await fetcher(endpoint, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": payload.idempotencyKey,
          "X-RDPS-Timestamp": timestamp,
          "X-RDPS-Signature": `sha256=${signature}`,
        },
        body,
      });
    } catch {
      throw codedError(
        "Deployment runner request failed",
        "RUNNER_REQUEST_FAILED",
      );
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw codedError(
        "Deployment runner did not accept the request",
        `RUNNER_HTTP_${response.status}`,
      );
    }
    await readBoundedResponse(response, maxResponseBytes);
    try {
      await options.callback(
        payload.requestId,
        "ACCEPTED",
        "RUNNER_ACCEPTED",
        "Deployment runner accepted the request",
      );
    } catch {
      throw codedError(
        "Deployment runner accepted the request but RDPS status callback failed",
        "DEPLOYMENT_CALLBACK_FAILED",
      );
    }
  };
}

export function parseDeploymentJob(value: unknown): DeploymentTriggerJob {
  return parseJob(value);
}

function parseJob(value: unknown): DeploymentTriggerJob {
  if (!isRecord(value))
    throw codedError("Invalid deployment job", "DEPLOYMENT_JOB_INVALID");
  const keys = [
    "requestId",
    "projectId",
    "releaseId",
    "environmentId",
  ] as const;
  if (
    keys.some((key) => !isUuid(value[key])) ||
    typeof value.idempotencyKey !== "string" ||
    !/^[A-Za-z0-9._:-]{8,120}$/.test(value.idempotencyKey) ||
    !(
      value.reason === null ||
      (typeof value.reason === "string" &&
        value.reason.length >= 1 &&
        value.reason.length <= 500 &&
        !/[\u0000-\u001f\u007f]/.test(value.reason))
    )
  )
    throw codedError("Invalid deployment job", "DEPLOYMENT_JOB_INVALID");
  return {
    requestId: value.requestId,
    projectId: value.projectId,
    releaseId: value.releaseId,
    environmentId: value.environmentId,
    idempotencyKey: value.idempotencyKey,
    reason: value.reason,
  };
}

function validateEndpoint(value: string, allowLocalHttp: boolean): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw codedError(
      "Deployment runner endpoint is invalid",
      "RUNNER_URL_INVALID",
    );
  }
  const localDevelopmentHttp =
    allowLocalHttp &&
    endpoint.protocol === "http:" &&
    ["localhost", "127.0.0.1", "deployment-runner"].includes(endpoint.hostname);
  if (
    (endpoint.protocol !== "https:" && !localDevelopmentHttp) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash
  )
    throw codedError(
      "Deployment runner endpoint must be a fixed HTTPS URL without embedded credentials",
      "RUNNER_URL_INVALID",
    );
  return endpoint;
}

async function readBoundedResponse(response: Response, maxBytes: number) {
  if (!response.body) return;
  const reader = response.body.getReader();
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw codedError(
          "Deployment runner response exceeded the size limit",
          "RUNNER_RESPONSE_TOO_LARGE",
        );
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function positiveBoundedInteger(value: number | undefined, fallback: number) {
  return Number.isSafeInteger(value) && value! > 0 && value! <= 60_000
    ? value!
    : fallback;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function codedError(message: string, code: string) {
  return Object.assign(new Error(message), { code });
}
