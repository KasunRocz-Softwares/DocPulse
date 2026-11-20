import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const LABEL_OWNER = "rdps.e2e.owner";
const LABEL_RUN = "rdps.e2e.run-id";
const LABEL_ROLE = "rdps.e2e.role";
const DEFAULT_IMAGES = {
  postgres: "postgres:17-alpine",
  redis: "redis:7-alpine",
};
const HEALTH_TIMEOUT_MS = 120_000;
const CHILD_OUTPUT_LIMIT = 2 * 1024 * 1024;

export function buildContainerArgs({ runId, role, image }) {
  const name = containerName(runId, role);
  const args = [
    "run",
    "--detach",
    "--name",
    name,
    "--label",
    `${LABEL_OWNER}=isolated-publish`,
    "--label",
    `${LABEL_RUN}=${runId}`,
    "--label",
    `${LABEL_ROLE}=${role}`,
    "--publish",
    role === "postgres" ? "127.0.0.1::5432/tcp" : "127.0.0.1::6379/tcp",
  ];
  if (role === "postgres") {
    args.push(
      "--tmpfs",
      "/var/lib/postgresql/data:rw,noexec,nosuid,size=512m",
      "--env",
      "POSTGRES_USER=rdps",
      "--env",
      "POSTGRES_DB=rdps",
      "--env",
      "POSTGRES_PASSWORD",
      "--health-cmd",
      "pg_isready -U rdps -d rdps",
    );
  } else if (role === "redis") {
    args.push(
      "--tmpfs",
      "/data:rw,noexec,nosuid,size=64m",
      "--health-cmd",
      "redis-cli ping",
      "--health-interval",
      "2s",
      "--health-timeout",
      "3s",
      "--health-retries",
      "60",
    );
  } else {
    throw new Error(`Unsupported isolated container role: ${role}`);
  }
  args.push(image);
  return args;
}

export function assertOwnedContainerInspection(inspection, { runId, role }) {
  const labels = inspection?.Config?.Labels ?? {};
  const expectedName = `/${containerName(runId, role)}`;
  if (
    labels[LABEL_OWNER] !== "isolated-publish" ||
    labels[LABEL_RUN] !== runId ||
    labels[LABEL_ROLE] !== role ||
    inspection?.Name !== expectedName
  )
    throw new Error(
      `Refusing to act on a container without this run's ownership labels (${role}).`,
    );
  const expectedDestination =
    role === "postgres" ? "/var/lib/postgresql/data" : "/data";
  const tmpfs = inspection.HostConfig?.Tmpfs ?? {};
  const tmpfsEntries = Object.entries(tmpfs);
  const configuredTmpfs =
    tmpfsEntries.length === 1 &&
    tmpfsEntries[0][0] === expectedDestination &&
    String(tmpfsEntries[0][1]).includes("noexec") &&
    String(tmpfsEntries[0][1]).includes("nosuid");
  const mounts = Array.isArray(inspection.Mounts) ? inspection.Mounts : null;
  const expectedMounts =
    mounts !== null &&
    mounts.length <= 1 &&
    mounts.every(
      (mount) =>
        mount?.Type === "tmpfs" && mount?.Destination === expectedDestination,
    );
  const reportedTmpfs = mounts?.some(
    (mount) =>
      mount?.Type === "tmpfs" && mount?.Destination === expectedDestination,
  );
  if (
    mounts === null ||
    !expectedMounts ||
    (!configuredTmpfs && !reportedTmpfs) ||
    inspection.HostConfig?.Binds?.length
  )
    throw new Error(
      `Refusing to use the isolated ${role} container because it lacks its expected tmpfs or has a Docker volume/bind mount.`,
    );
  return true;
}

export function redactOutput(value, secrets) {
  let output = String(value);
  for (const secret of [...secrets]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length))
    output = output.replaceAll(secret, "[REDACTED]");
  return output;
}

function failureDetails(error, secrets) {
  if (error instanceof AggregateError)
    return [...error.errors]
      .map((nested) => failureDetails(nested, secrets))
      .join("; ");
  return redactOutput(error?.message ?? "Unknown failure", secrets);
}

function containerName(runId, role) {
  return `rdps-e2e-${runId}-${role}`;
}

function makeRunId() {
  return `${Date.now().toString(36)}-${process.pid.toString(36)}-${randomBytes(8).toString("hex")}`;
}

function newSecret() {
  return randomBytes(48).toString("base64url");
}

function log(message, secrets = []) {
  process.stdout.write(`${redactOutput(message, secrets)}\n`);
}

function delay(milliseconds, signal) {
  return new Promise((resolveDelay, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(done, milliseconds);
    function done() {
      signal.removeEventListener("abort", aborted);
      resolveDelay();
    }
    function aborted() {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Interrupted"));
    }
    signal.addEventListener("abort", aborted, { once: true });
  });
}

async function command(commandName, args, { env, secrets = [], signal } = {}) {
  if (signal?.aborted) throw signal.reason;
  const isWindows = process.platform === "win32";
  const windowsPnpm = isWindows && commandName === "pnpm";
  const executable = windowsPnpm
    ? (process.env.ComSpec ?? "cmd.exe")
    : commandName;
  const commandArgs = windowsPnpm
    ? ["/d", "/s", "/c", `pnpm ${args.join(" ")}`]
    : args;
  const child = spawn(executable, commandArgs, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: !isWindows,
    shell: false,
  });
  const output = [];
  let outputBytes = 0;
  let truncated = false;
  const capture = (chunk) => {
    const bytes = Buffer.from(chunk);
    outputBytes += bytes.length;
    if (outputBytes <= CHILD_OUTPUT_LIMIT) output.push(bytes);
    else truncated = true;
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  const closed = once(child, "close").then(([code, closeSignal]) => ({
    code,
    closeSignal,
  }));
  const spawnError = once(child, "error").then(([error]) => ({ error }));
  const abortChild = () => void stopChild(child);
  signal?.addEventListener("abort", abortChild, { once: true });
  let result;
  try {
    result = await Promise.race([closed, spawnError]);
  } finally {
    signal?.removeEventListener("abort", abortChild);
  }
  const outputText = redactOutput(
    Buffer.concat(output).toString("utf8"),
    secrets,
  );
  if (outputText.trim())
    process.stdout.write(
      outputText.endsWith("\n") ? outputText : `${outputText}\n`,
    );
  if (truncated) log("[additional child output omitted after 2 MiB]", secrets);
  if (result.error)
    throw new Error(
      `${commandName} could not start (${result.error.code ?? "spawn error"}).`,
    );
  if (signal?.aborted) throw signal.reason;
  if (result.code !== 0)
    throw new Error(
      `${commandName} exited with code ${result.code ?? `signal ${result.closeSignal}`}.`,
    );
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    await Promise.race([
      once(killer, "close"),
      delay(5_000, new AbortController().signal),
    ]).catch(() => {});
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // The process may have exited between the status check and signal.
    }
  }
  await Promise.race([
    once(child, "close"),
    new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        // The process may have exited between the status check and signal.
      }
    }
  }
}

async function docker(args, { env, secrets = [] } = {}) {
  return captureCommand("docker", args, { env, secrets });
}

async function captureCommand(commandName, args, { env, secrets = [] } = {}) {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(commandName, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.once("error", (error) =>
      rejectResult(
        new Error(
          `${commandName} could not start (${error.code ?? "spawn error"}).`,
        ),
      ),
    );
    child.once("close", (code) => {
      const text = redactOutput(
        Buffer.concat(chunks).toString("utf8"),
        secrets,
      ).trim();
      if (code !== 0)
        rejectResult(
          new Error(
            `${commandName} exited with code ${code ?? "unknown"}${text ? `: ${text}` : ""}`,
          ),
        );
      else resolveResult(text);
    });
  });
}

async function inspectContainer(resourceOrId, expected) {
  const reference =
    typeof resourceOrId === "string"
      ? resourceOrId
      : (resourceOrId.id ?? resourceOrId.name);
  const data = await docker(["inspect", reference]);
  const parsed = JSON.parse(data);
  const inspection = parsed[0];
  if (!inspection)
    throw new Error(
      `Docker inspection returned no ${expected.role} container.`,
    );
  assertOwnedContainerInspection(inspection, expected);
  return inspection;
}

async function startContainer({
  runId,
  role,
  image,
  env,
  secrets,
  signal,
  register,
}) {
  const name = containerName(runId, role);
  const args = buildContainerArgs({ runId, role, image });
  const resource = { id: undefined, name, role, runId };
  register(resource);
  log(`Starting isolated ${role} container (${name}).`, secrets);
  const id = await docker(args, { env, secrets });
  if (!/^[a-f0-9]{12,64}$/i.test(id))
    throw new Error(`Docker did not return a valid container ID for ${role}.`);
  resource.id = id;
  await inspectContainer(resource, { runId, role });
  await waitForContainerHealth(resource, secrets, signal);
  const inspection = await inspectContainer(resource, { runId, role });
  const portName = role === "postgres" ? "5432/tcp" : "6379/tcp";
  const binding = inspection.NetworkSettings?.Ports?.[portName]?.[0];
  const port = Number(binding?.HostPort);
  if (
    !binding?.HostIp?.startsWith("127.") ||
    !Number.isInteger(port) ||
    port < 1
  )
    throw new Error(
      `Docker did not publish ${role} on a loopback ephemeral host port.`,
    );
  return { ...resource, port };
}

async function waitForContainerHealth(resource, secrets, signal) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal.aborted) throw signal.reason;
    const inspection = await inspectContainer(resource, resource);
    const state = inspection.State;
    if (state?.Health?.Status === "healthy") return;
    if (state?.Status === "exited" || state?.Status === "dead")
      throw new Error(
        `Isolated ${resource.role} container exited before becoming healthy.`,
      );
    await delay(1_000, signal);
  }
  throw new Error(
    `Isolated ${resource.role} container did not become healthy within ${HEALTH_TIMEOUT_MS / 1_000}s.`,
  );
}

async function availablePort(excluded = []) {
  const server = createServer((_, response) => {
    response.writeHead(204, { connection: "close" }).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  let usable = !excluded.includes(port);
  try {
    if (usable) {
      // Windows can assign ephemeral ports that Fetch blocks by design.
      await fetch(`http://127.0.0.1:${port}`, {
        signal: AbortSignal.timeout(1_500),
      });
    }
  } catch (error) {
    if (error.cause?.message !== "bad port") throw error;
    usable = false;
  } finally {
    await new Promise((resolveClose, rejectClose) =>
      server.close((error) => (error ? rejectClose(error) : resolveClose())),
    );
  }
  return usable ? port : availablePort(excluded);
}

async function waitForHttp(
  url,
  child,
  signal,
  secrets,
  timeoutMs = HEALTH_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal.aborted) throw signal.reason;
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(
        `A required host process exited before becoming ready (${child.spawnfile}).`,
      );
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) return;
    } catch {
      // Connection refused is expected until the service finishes starting.
    }
    await delay(300, signal);
  }
  throw new Error(
    `A required host service did not become ready (${new URL(url).pathname}).`,
  );
}

async function waitForProcessOutput(
  child,
  marker,
  signal,
  timeoutMs = HEALTH_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal.aborted) throw signal.reason;
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(
        `A required host process exited before reporting readiness (${child.spawnfile}).`,
      );
    if (child.rdpsOutput?.includes(marker)) return;
    await delay(100, signal);
  }
  throw new Error(
    `A required host process did not report readiness (${marker}).`,
  );
}

function startProcess(commandName, args, { env, secrets }) {
  const isWindows = process.platform === "win32";
  const executable =
    isWindows && commandName === "pnpm" ? "pnpm.cmd" : commandName;
  const child = spawn(executable, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: !isWindows,
    shell: isWindows && commandName === "pnpm",
  });
  const output = [];
  let bytes = 0;
  child.rdpsOutput = "";
  const capture = (chunk) => {
    child.rdpsOutput = `${child.rdpsOutput}${chunk.toString("utf8")}`.slice(
      -CHILD_OUTPUT_LIMIT,
    );
    if (bytes >= CHILD_OUTPUT_LIMIT) return;
    const value = Buffer.from(chunk);
    const remaining = CHILD_OUTPUT_LIMIT - bytes;
    output.push(value.subarray(0, remaining));
    bytes += Math.min(value.length, remaining);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.once("error", (error) => {
    output.push(
      Buffer.from(`\n[process spawn failed: ${error.code ?? "unknown"}]\n`),
    );
  });
  child.once("close", () => {
    const value = redactOutput(Buffer.concat(output).toString("utf8"), secrets);
    if (value.trim())
      process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
  });
  return child;
}

async function stopAndReportChild(child) {
  if (!child) return;
  await stopChild(child);
}

async function bootstrapAdmin(apiBase, admin, bootstrapSecret, signal) {
  let response;
  try {
    response = await fetch(`${apiBase}/api/v1/internal/auth/bootstrap`, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: admin.email,
        displayName: "RDPS Isolated E2E Administrator",
        password: admin.password,
        bootstrapSecret,
      }),
    });
  } catch {
    throw new Error("Synthetic administrator bootstrap request failed.");
  }
  if (!response.ok)
    throw new Error(
      `Synthetic administrator bootstrap returned HTTP ${response.status}.`,
    );
}

async function removeOwnedContainer(resource, secrets) {
  if (!resource) return;
  let inspection;
  try {
    inspection = await inspectContainer(resource, resource);
  } catch (error) {
    if (/no such object|not found/i.test(String(error))) return;
    throw error;
  }
  const labels = inspection?.Config?.Labels ?? {};
  const expectedName = `/${containerName(resource.runId, resource.role)}`;
  if (
    labels[LABEL_OWNER] !== "isolated-publish" ||
    labels[LABEL_RUN] !== resource.runId ||
    labels[LABEL_ROLE] !== resource.role ||
    inspection?.Name !== expectedName
  )
    throw new Error(
      `Refusing to remove a container without this run's ownership labels (${resource.role}).`,
    );
  await docker(["rm", "--force", inspection.Id], { secrets });
  log(`Removed owned isolated ${resource.role} container.`, secrets);
}

async function run(controller = new AbortController()) {
  const runId = makeRunId();
  const secrets = [];
  const containers = [];
  const children = [];
  const tempRunDir = await mkdtemp(join(tmpdir(), `rdps-e2e-${runId}-`));
  let failure;
  try {
    await chmod(tempRunDir, 0o700).catch(() => {});
    const admin = {
      email: `rdps-e2e-${runId}@example.test`,
      password: `E2e-${newSecret()}!`,
    };
    const databasePassword = newSecret();
    const bootstrapSecret = newSecret();
    const jwtSecret = newSecret();
    const workerSecret = newSecret();
    const notificationSecret = newSecret();
    const githubSecret = newSecret();
    const deploymentWebhookSecret = newSecret();
    const runnerSecret = newSecret();
    const targetSecret = newSecret();
    secrets.push(
      admin.password,
      databasePassword,
      bootstrapSecret,
      jwtSecret,
      workerSecret,
      notificationSecret,
      githubSecret,
      deploymentWebhookSecret,
      runnerSecret,
      targetSecret,
    );

    const postgres = await startContainer({
      runId,
      role: "postgres",
      image: process.env.RDPS_E2E_POSTGRES_IMAGE ?? DEFAULT_IMAGES.postgres,
      env: { POSTGRES_PASSWORD: databasePassword },
      secrets,
      signal: controller.signal,
      register: (resource) => containers.push(resource),
    });
    const redis = await startContainer({
      runId,
      role: "redis",
      image: process.env.RDPS_E2E_REDIS_IMAGE ?? DEFAULT_IMAGES.redis,
      env: {},
      secrets,
      signal: controller.signal,
      register: (resource) => containers.push(resource),
    });

    const databaseUrl = `postgresql://rdps:${databasePassword}@127.0.0.1:${postgres.port}/rdps?schema=public`;
    const redisUrl = `redis://127.0.0.1:${redis.port}`;
    secrets.push(databaseUrl, redisUrl);
    const apiPort = await availablePort();
    const runnerPort = await availablePort([apiPort]);
    const targetPort = await availablePort([apiPort, runnerPort]);
    const apiBase = `http://127.0.0.1:${apiPort}`;
    const targetBase = `http://127.0.0.1:${targetPort}`;
    const apiEnv = {
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      API_PORT: String(apiPort),
      JWT_ACCESS_SECRET: jwtSecret,
      BOOTSTRAP_SECRET: bootstrapSecret,
      RDPS_WORKER_SHARED_SECRET: workerSecret,
      NOTIFICATION_WORKER_SECRET: notificationSecret,
      GITHUB_WEBHOOK_SECRET: githubSecret,
      DEPLOYMENT_WEBHOOK_SECRET: deploymentWebhookSecret,
      DEPLOYMENT_RUNNER_SIGNING_SECRET: runnerSecret,
      DEPLOYMENT_RUNNER_URL: `http://127.0.0.1:${runnerPort}/dispatch`,
      RDPS_API_URL: apiBase,
      RDPS_UPLOAD_DIR: join(tempRunDir, "uploads"),
      PUBLIC_BASE_URL: apiBase,
      WEB_BASE_URL: apiBase,
      OIDC_AUTO_PROVISION: "false",
    };
    const workerEnv = {
      ...apiEnv,
      RDPS_WORKER_SHARED_SECRET: workerSecret,
    };
    const runnerEnv = {
      NODE_ENV: "test",
      RUNNER_HOST: "127.0.0.1",
      RUNNER_PORT: String(runnerPort),
      RDPS_API_URL: apiBase,
      DEPLOYMENT_RUNNER_SIGNING_SECRET: runnerSecret,
      DEPLOYMENT_TARGET_SIGNING_SECRET: targetSecret,
      DEPLOYMENT_TARGET_URL: targetBase,
      RUNNER_STATE_DIR: join(tempRunDir, "runner"),
    };

    log(
      "Building current config and Prisma client, then applying isolated migrations.",
      secrets,
    );
    await command("pnpm", ["--filter", "@rdps/config", "build"], {
      secrets,
      signal: controller.signal,
    });
    await command("pnpm", ["--filter", "@rdps/api", "db:generate"], {
      env: { DATABASE_URL: databaseUrl },
      secrets,
      signal: controller.signal,
    });
    await command("pnpm", ["--filter", "@rdps/api", "db:deploy"], {
      env: { DATABASE_URL: databaseUrl },
      secrets,
      signal: controller.signal,
    });
    await command("pnpm", ["--filter", "@rdps/api", "build"], {
      secrets,
      signal: controller.signal,
    });
    await command("pnpm", ["--filter", "@rdps/worker", "build"], {
      secrets,
      signal: controller.signal,
    });

    const target = startProcess(
      process.execPath,
      ["scripts/dev-runner/sandbox-target.mjs"],
      {
        env: {
          NODE_ENV: "development",
          TARGET_HOST: "127.0.0.1",
          TARGET_PORT: String(targetPort),
          RUNNER_STATE_DIR: join(tempRunDir, "target"),
          DEPLOYMENT_TARGET_SIGNING_SECRET: targetSecret,
        },
        secrets,
      },
    );
    children.push(target);
    await waitForHttp(
      `${targetBase}/health`,
      target,
      controller.signal,
      secrets,
    );

    const runner = startProcess(
      process.execPath,
      ["scripts/dev-runner/server.mjs"],
      { env: runnerEnv, secrets },
    );
    children.push(runner);
    await waitForHttp(
      `http://127.0.0.1:${runnerPort}/health`,
      runner,
      controller.signal,
      secrets,
    );

    const api = startProcess(process.execPath, ["apps/api/dist/main.js"], {
      env: apiEnv,
      secrets,
    });
    children.push(api);
    await waitForHttp(
      `${apiBase}/api/v1/health/ready`,
      api,
      controller.signal,
      secrets,
    );

    const worker = startProcess(
      process.execPath,
      ["apps/worker/dist/worker/src/main.js"],
      {
        env: workerEnv,
        secrets,
      },
    );
    children.push(worker);
    await waitForProcessOutput(worker, '"consumesQueues"', controller.signal);

    await bootstrapAdmin(apiBase, admin, bootstrapSecret, controller.signal);
    log(
      "Synthetic administrator bootstrapped; running the full current-source publish/isolation flow.",
      secrets,
    );
    await command(process.execPath, ["scripts/e2e/full-publish-flow.mjs"], {
      env: {
        RDPS_E2E_API_URL: `${apiBase}/api/v1`,
        RDPS_E2E_ADMIN_EMAIL: admin.email,
        RDPS_E2E_ADMIN_PASSWORD: admin.password,
        RDPS_E2E_SANDBOX_TARGET_URL: targetBase,
      },
      secrets,
      signal: controller.signal,
    });
    log("Isolated publish and authorization E2E passed.", secrets);
  } catch (error) {
    failure = error;
  } finally {
    controller.abort(new Error("Isolated E2E cleanup"));
    const cleanupErrors = [];
    for (const child of [...children].reverse()) {
      try {
        await stopAndReportChild(child);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    for (const resource of [...containers].reverse()) {
      try {
        await removeOwnedContainer(resource, secrets);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await rm(tempRunDir, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length) {
      const cleanupFailure = new Error(
        `Isolated E2E cleanup had ${cleanupErrors.length} failure(s): ${redactOutput(cleanupErrors.map((error) => error.message).join("; "), secrets)}`,
      );
      failure = failure
        ? new AggregateError(
            [failure, cleanupFailure],
            "Isolated E2E and cleanup both failed.",
          )
        : cleanupFailure;
    }
  }
  if (failure)
    throw new Error(redactOutput(failureDetails(failure, secrets), secrets));
}

let activeController;
const handleSignal = (signal) => {
  activeController?.abort(new Error(`Interrupted by ${signal}.`));
};

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  activeController = new AbortController();
  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  run(activeController).then(
    () => (process.exitCode = 0),
    (error) => {
      process.stderr.write(
        `${redactOutput(error?.message ?? "Isolated E2E failed.", [])}\n`,
      );
      process.exitCode = 1;
    },
  );
}
