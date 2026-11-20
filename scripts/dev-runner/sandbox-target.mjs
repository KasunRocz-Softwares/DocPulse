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
import { createServer } from "node:http";
import { join } from "node:path";

const port = Number(process.env.TARGET_PORT ?? 3081);
const host = process.env.TARGET_HOST ?? "127.0.0.1";
const stateDir = process.env.RUNNER_STATE_DIR;
const signingSecret = process.env.DEPLOYMENT_TARGET_SIGNING_SECRET;
const maxBodyBytes = 16_384;
const timestampWindowMs = 5 * 60 * 1000;

if (process.env.NODE_ENV !== "development")
  throw new Error("Sandbox target requires NODE_ENV=development");
if (!Number.isInteger(port) || port < 0 || port > 65_535)
  throw new Error("TARGET_PORT must be a valid TCP port");
if (!stateDir || !signingSecret || signingSecret.length < 32)
  throw new Error(
    "RUNNER_STATE_DIR and a 32-character target secret are required",
  );

mkdirSync(stateDir, { recursive: true });
const stateFile = join(stateDir, "state.json");
const temporaryFile = join(stateDir, "state.tmp");
let projects = {};
const deliveryAttempts = Object.create(null);
let directorySyncPending = false;
try {
  const snapshot = JSON.parse(readFileSync(stateFile, "utf8"));
  projects = snapshot.projects ?? migrateSnapshot(snapshot);
  directorySyncPending = process.platform === "linux";
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        status: "ok",
        activeDeployments: Object.fromEntries(
          Object.entries(projects).map(([id, project]) => [
            id,
            project.activeDeployments,
          ]),
        ),
        deliveryAttempts,
      }),
    );
    return;
  }
  if (request.method !== "POST" || request.url !== "/deploy") {
    response.writeHead(404).end();
    return;
  }

  let body;
  let payload;
  try {
    body = await readBody(request);
    if (!body) {
      response.writeHead(413, { Connection: "close" }).end();
      return;
    }
    if (!verifySignature(body, request.headers)) {
      response.writeHead(401).end();
      return;
    }
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    response.writeHead(400).end();
    return;
  }

  if (
    !payload ||
    ![
      "projectId",
      "releaseId",
      "environmentId",
      "requestId",
      "idempotencyKey",
    ].every(
      (field) =>
        typeof payload[field] === "string" && payload[field].trim().length > 0,
    ) ||
    payload.idempotencyKey !== request.headers["idempotency-key"]
  ) {
    response.writeHead(400).end();
    return;
  }

  try {
    const status = applyDeployment(payload);
    if (status === 200) {
      const projectAttempts = (deliveryAttempts[payload.projectId] ??= {});
      projectAttempts[payload.requestId] =
        (projectAttempts[payload.requestId] ?? 0) + 1;
    }
    response.writeHead(status).end();
  } catch {
    response.writeHead(500).end();
  }
});

function applyDeployment({
  projectId,
  releaseId,
  environmentId,
  requestId,
  idempotencyKey,
}) {
  const project = Object.hasOwn(projects, projectId)
    ? projects[projectId]
    : emptyProject();
  const knownRequest = Object.hasOwn(project.requests, requestId);
  const existing = Object.hasOwn(project.deploymentsByKey, idempotencyKey)
    ? project.deploymentsByKey[idempotencyKey]
    : undefined;
  if (
    (knownRequest && project.requests[requestId] !== idempotencyKey) ||
    (existing &&
      (existing.releaseId !== releaseId ||
        existing.environmentId !== environmentId))
  )
    return 409;

  if (!knownRequest) {
    const next = {
      ...projects,
      [projectId]: {
        activeDeployments: existing
          ? project.activeDeployments
          : { ...project.activeDeployments, [environmentId]: { releaseId } },
        requests: { ...project.requests, [requestId]: idempotencyKey },
        deploymentsByKey: existing
          ? project.deploymentsByKey
          : {
              ...project.deploymentsByKey,
              [idempotencyKey]: { releaseId, environmentId },
            },
      },
    };

    // Keep the write and in-memory update in one synchronous turn.
    writeFileSync(temporaryFile, JSON.stringify({ projects: next }), {
      mode: 0o600,
      flush: true,
    });
    renameSync(temporaryFile, stateFile);
    // Rename has committed the visible snapshot even if directory sync fails.
    projects = next;
    directorySyncPending = process.platform === "linux";
  }
  if (directorySyncPending) {
    syncStateDirectory();
    directorySyncPending = false;
  }
  return 200;
}

function syncStateDirectory() {
  try {
    const directory = openSync(stateDir, "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EOPNOTSUPP"].includes(error.code)) throw error;
  }
}

function emptyProject() {
  return {
    activeDeployments: Object.create(null),
    requests: Object.create(null),
    deploymentsByKey: Object.create(null),
  };
}

function migrateSnapshot(snapshot) {
  const migrated = Object.create(null);
  for (const [key, { projectId, releaseId, environmentId }] of Object.entries(
    snapshot.deploymentsByKey,
  )) {
    const project = (migrated[projectId] ??= emptyProject());
    project.deploymentsByKey[key] = { releaseId, environmentId };
  }
  for (const [requestId, key] of Object.entries(snapshot.requests)) {
    const { projectId } = snapshot.deploymentsByKey[key];
    migrated[projectId].requests[requestId] = key;
  }
  for (const [environmentId, { projectId, releaseId }] of Object.entries(
    snapshot.activeDeployments,
  )) {
    Object.defineProperty(
      migrated[projectId].activeDeployments,
      environmentId,
      {
        value: { releaseId },
        enumerable: true,
      },
    );
  }
  return migrated;
}

function verifySignature(body, headers) {
  const timestamp = headers["x-rdps-timestamp"];
  const signature = headers["x-rdps-signature"];
  if (
    typeof timestamp !== "string" ||
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(Date.now() - Number(timestamp)) > timestampWindowMs ||
    typeof signature !== "string" ||
    !/^sha256=[a-f0-9]{64}$/i.test(signature)
  )
    return false;

  const expected = createHmac("sha256", signingSecret)
    .update(`${timestamp}.`)
    .update(body)
    .digest();
  return timingSafeEqual(Buffer.from(signature.slice(7), "hex"), expected);
}

async function readBody(request) {
  if (Number(request.headers["content-length"]) > maxBodyBytes) return null;
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maxBodyBytes) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

server.listen(port, host, () => {
  console.info(
    JSON.stringify({
      event: "sandbox_target.ready",
      host,
      port: server.address().port,
    }),
  );
});
process.once("SIGINT", () => server.close());
process.once("SIGTERM", () => server.close());
