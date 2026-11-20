import { createHmac, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import { createServer } from "node:http";

const port = Number(process.env.RUNNER_PORT ?? 3080);
const host = process.env.RUNNER_HOST ?? "0.0.0.0";
const apiUrl = parseServiceUrl(process.env.RDPS_API_URL, "RDPS_API_URL");
const signingSecret = process.env.DEPLOYMENT_RUNNER_SIGNING_SECRET;
const callbackTimeoutMs = 5_000;
const targetTimeoutMs = 2_000;
const healthDeadlineMs = 5_000;
const maxHealthBytes = 1024 * 1024;
const targetSecret = process.env.DEPLOYMENT_TARGET_SIGNING_SECRET;
const targetUrl = parseServiceUrl(
  process.env.DEPLOYMENT_TARGET_URL,
  "DEPLOYMENT_TARGET_URL",
);
const stateDir = process.env.RUNNER_STATE_DIR;
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
  throw new Error("RUNNER_PORT must be a valid TCP port");
if (
  !signingSecret ||
  signingSecret.length < 32 ||
  !targetSecret ||
  targetSecret.length < 32
)
  throw new Error(
    "Runner and target signing secrets must contain at least 32 characters",
  );
if (!stateDir) throw new Error("RUNNER_STATE_DIR is required");
mkdirSync(stateDir, { recursive: true });
const journalFile = join(stateDir, "accepted-dispatches.json");
const journalTempFile = join(stateDir, "accepted-dispatches.tmp");
const jobs = new Map();
try {
  const saved = JSON.parse(readFileSync(journalFile, "utf8"));
  for (const job of saved.jobs ?? []) jobs.set(job.deployment.requestId, job);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
let journalDirectorySyncPending = process.platform === "linux";

const targetFields = [
  "requestId",
  "projectId",
  "releaseId",
  "environmentId",
  "idempotencyKey",
];
const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end('{"status":"ok"}');
    return;
  }
  if (request.method !== "POST" || request.url !== "/dispatch") {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = await readBody(request, 16_384);
    const timestamp = request.headers["x-rdps-timestamp"];
    const signature = request.headers["x-rdps-signature"];
    const idempotencyKey = request.headers["idempotency-key"];
    if (!verifySignature(body, timestamp, signature)) {
      response.writeHead(401).end();
      return;
    }
    const payload = JSON.parse(body.toString("utf8"));
    if (
      !isRecord(payload) ||
      !targetFields.every(
        (field) => typeof payload[field] === "string" && payload[field].trim(),
      ) ||
      payload.idempotencyKey !== idempotencyKey
    ) {
      response.writeHead(400).end();
      return;
    }

    const existing = jobs.get(payload.requestId);
    if (
      existing &&
      existing.deployment.idempotencyKey !== payload.idempotencyKey
    ) {
      response.writeHead(409).end();
      return;
    }
    if (!existing) {
      const deployment = Object.fromEntries(
        targetFields.map((field) => [field, payload[field]]),
      );
      const job = { deployment, phase: "ACCEPTED", terminalStatus: null };
      const candidateJobs = new Map(jobs);
      candidateJobs.set(payload.requestId, job);
      persistJournal(candidateJobs);
      jobs.set(payload.requestId, job);
    }
    response.writeHead(202, { "Content-Type": "application/json" });
    response.end('{"accepted":true}');
    if (!existing) void processJob(jobs.get(payload.requestId));
  } catch (error) {
    response.writeHead(error?.statusCode === 413 ? 413 : 400).end();
  }
});

server.listen(port, host, () => {
  console.info(JSON.stringify({ event: "local_runner.ready", host, port }));
  for (const job of jobs.values())
    if (job.phase !== "COMPLETE") void processJob(job);
});

async function processJob(job) {
  if (job.runningReported !== true) {
    await retryUntilSuccessful(() =>
      reportStatus(
        job.deployment.requestId,
        "RUNNING",
        "LOCAL_RUNNER_STARTED",
        "Local development runner started the deployment",
      ),
    );
    job.runningReported = true;
    job.phase = "RUNNING";
    persistJournal();
  }

  if (!job.terminalStatus && job.phase !== "APPLIED") {
    const { deployment } = job;
    try {
      const applied = await fetch(new URL("/deploy", targetUrl), {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(targetTimeoutMs),
        ...signedJson(deployment, targetSecret, {
          "Idempotency-Key": deployment.idempotencyKey,
        }),
      });
      await applied.body?.cancel();
      if (!applied.ok) {
        await completeJob(
          job,
          "FAILED",
          "LOCAL_TARGET_APPLY_FAILED",
          "Local sandbox deployment could not be verified",
        );
        return;
      }
      job.phase = "APPLIED";
      persistJournal();
    } catch {
      await completeJob(
        job,
        "FAILED",
        "LOCAL_TARGET_APPLY_FAILED",
        "Local sandbox deployment could not be verified",
      );
      return;
    }
  }

  if (!job.terminalStatus) {
    let verified = false;
    try {
      verified = await verifyDeployment(job.deployment);
    } catch {
      verified = false;
    }
    if (!verified) {
      await completeJob(
        job,
        "FAILED",
        "LOCAL_TARGET_VERIFY_FAILED",
        "Local sandbox deployment could not be verified",
      );
      return;
    }
    await completeJob(
      job,
      "SUCCEEDED",
      "LOCAL_RUNNER_SUCCEEDED",
      "Local development runner completed the deployment",
    );
  } else {
    await deliverTerminalCallback(job);
  }
}

async function completeJob(job, status, resultCode, resultSummary) {
  job.terminalStatus = { status, resultCode, resultSummary };
  job.phase = "TERMINAL";
  persistJournal();
  await deliverTerminalCallback(job);
}

async function deliverTerminalCallback(job) {
  const { status, resultCode, resultSummary } = job.terminalStatus;
  await retryUntilSuccessful(() =>
    reportStatus(job.deployment.requestId, status, resultCode, resultSummary),
  );
  job.phase = "COMPLETE";
  persistJournal();
}

async function retryUntilSuccessful(operation) {
  let delayMs = 100;
  for (;;) {
    try {
      await operation();
      return;
    } catch {
      await delay(delayMs);
      delayMs = Math.min(delayMs * 2, 2_000);
    }
  }
}

async function verifyDeployment({ projectId, environmentId, releaseId }) {
  const deadline = Date.now() + healthDeadlineMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL("/health", targetUrl), {
        redirect: "error",
        signal: AbortSignal.timeout(
          Math.min(targetTimeoutMs, deadline - Date.now()),
        ),
      });
      if (!response.ok) {
        await response.body?.cancel();
      } else {
        const health = await readHealth(response);
        if (
          health?.status === "ok" &&
          health.activeDeployments?.[projectId]?.[environmentId]?.releaseId ===
            releaseId
        )
          return true;
      }
    } catch {
      // Network, timeout, and malformed JSON probe failures are transient until deadline.
    }
    await delay(Math.min(150, Math.max(0, deadline - Date.now())));
  }
  return false;
}

async function readHealth(response) {
  if (!response.body) return null;
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > maxHealthBytes) {
      await response.body.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
  } catch {
    return null;
  }
}

function parseServiceUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid absolute URL`);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(`${name} must use HTTP or HTTPS without credentials`);
  if (url.protocol === "http:" && !isTrustedLocalHost(url.hostname))
    throw new Error(
      `${name} cleartext HTTP is allowed only for trusted local hosts`,
    );
  return url;
}

function isTrustedLocalHost(hostname) {
  const hostName = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (["localhost", "api", "sandbox-target"].includes(hostName)) return true;
  const ipVersion = isIP(hostName);
  return ipVersion === 4
    ? hostName.startsWith("127.")
    : ipVersion === 6 && hostName === "::1";
}

function persistJournal(candidateJobs = jobs) {
  writeFileSync(
    journalTempFile,
    JSON.stringify({ jobs: [...candidateJobs.values()] }),
    {
      mode: 0o600,
      flush: true,
    },
  );
  renameSync(journalTempFile, journalFile);
  journalDirectorySyncPending = process.platform === "linux";
  if (journalDirectorySyncPending) {
    const directory = openSync(stateDir, "r");
    try {
      fsyncSync(directory);
      journalDirectorySyncPending = false;
    } finally {
      closeSync(directory);
    }
  }
}

async function reportStatus(requestId, status, resultCode, resultSummary) {
  const response = await fetch(
    new URL(
      `/api/v1/internal/deployment-orchestration/runner/requests/${encodeURIComponent(requestId)}/status`,
      apiUrl,
    ),
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(callbackTimeoutMs),
      ...signedJson({ status, resultCode, resultSummary }, signingSecret),
    },
  );
  await response.body?.cancel();
  if (!response.ok) throw new Error("Local runner callback failed");
}

function signedJson(payload, secret, headers = {}) {
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return {
    body,
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "X-RDPS-Timestamp": timestamp,
      "X-RDPS-Signature": `sha256=${signature}`,
    },
  };
}

function verifySignature(body, timestamp, signature) {
  if (
    typeof timestamp !== "string" ||
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000 ||
    typeof signature !== "string" ||
    !/^sha256=[a-f0-9]{64}$/i.test(signature)
  )
    return false;
  const expected = createHmac("sha256", signingSecret)
    .update(`${timestamp}.${body.toString("utf8")}`)
    .digest();
  const supplied = Buffer.from(signature.slice(7), "hex");
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

function readBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(
          Object.assign(new Error("Request body too large"), {
            statusCode: 413,
          }),
        );
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

process.once("SIGINT", () => server.close(() => process.exit(0)));
process.once("SIGTERM", () => server.close(() => process.exit(0)));
