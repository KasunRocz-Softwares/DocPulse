import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const runnerSecret = "rdps-runner-integration-secret-32-characters";
const targetSecret = "rdps-target-integration-secret-32-characters";
const deployment = {
  requestId: randomUUID(),
  projectId: randomUUID(),
  releaseId: randomUUID(),
  environmentId: randomUUID(),
  idempotencyKey: randomUUID(),
};

function sign(body, timestamp, secret) {
  return (
    "sha256=" +
    createHmac("sha256", secret)
      .update(timestamp + "." + body)
      .digest("hex")
  );
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function unusedPort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function serve(t, handler) {
  const server = createServer(handler);
  const port = await listen(server);
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  return "http://127.0.0.1:" + port;
}

// Cleanup hooks run in the order they were registered, so a state folder registered for removal before
// its runner would be deleted while the runner is still writing its journal. Track every runner a test
// starts and stop them all before removing a folder.
const runners = new WeakMap();
function removeAfterRunnersStop(t, dir) {
  t.after(async () => {
    await Promise.all([...(runners.get(t) ?? [])].map((stop) => stop()));
    await rm(dir, { recursive: true, force: true });
  });
}

async function start(t, script, env) {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL(script, import.meta.url))],
    {
      env: { ...process.env, NODE_ENV: "development", ...env },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const closed = once(child, "close");
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await closed;
  };
  t.after(stop);
  if (!runners.has(t)) runners.set(t, new Set());
  runners.get(t).add(stop);
  const lines = createInterface({ input: child.stdout });
  const [line] = await Promise.race([
    once(lines, "line"),
    closed.then(([code]) => {
      throw new Error("Service exited: " + code);
    }),
  ]);
  return {
    url: "http://127.0.0.1:" + JSON.parse(line).port,
    stop,
    closed,
  };
}

async function fixture(t, targetHandler, options = {}) {
  const events = [];
  const journalDir =
    options.journalDir ??
    (await mkdtemp(join(tmpdir(), "rdps-runner-journal-")));
  if (!options.journalDir) removeAfterRunnersStop(t, journalDir);
  const callbacks = [];
  const api = await serve(t, async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const callback = JSON.parse(body);
    const callbackRecord = {
      body,
      headers: request.headers,
      path: request.url,
      acknowledged: false,
    };
    callbacks.push(callbackRecord);
    events.push(callback.status);
    if (options.callbackHandler)
      await options.callbackHandler(request, response, callback);
    else response.writeHead(204).end();
    callbackRecord.acknowledged =
      response.statusCode >= 200 && response.statusCode < 300;
  });
  const target = await serve(t, (request, response) => {
    events.push(request.url);
    void targetHandler(request, response);
  });
  const reservation = createServer();
  const port = await listen(reservation);
  await new Promise((resolve) => reservation.close(resolve));
  const runnerProcess = await start(t, "./server.mjs", {
    RUNNER_PORT: String(port),
    RUNNER_HOST: "127.0.0.1",
    RDPS_API_URL: api,
    DEPLOYMENT_RUNNER_SIGNING_SECRET: runnerSecret,
    DEPLOYMENT_TARGET_URL: target,
    DEPLOYMENT_TARGET_SIGNING_SECRET: targetSecret,
    RUNNER_STATE_DIR: journalDir,
    ...(options.env ?? {}),
  });
  const runner = runnerProcess.url;
  return {
    events,
    journalDir,
    runnerProcess,
    async restart() {
      await runnerProcess.stop();
      return start(t, "./server.mjs", {
        RUNNER_PORT: String(port),
        RUNNER_HOST: "127.0.0.1",
        RDPS_API_URL: api,
        DEPLOYMENT_RUNNER_SIGNING_SECRET: runnerSecret,
        DEPLOYMENT_TARGET_URL: target,
        DEPLOYMENT_TARGET_SIGNING_SECRET: targetSecret,
        RUNNER_STATE_DIR: journalDir,
      });
    },
    async sendDispatch(payload = deployment) {
      const body = JSON.stringify({ reason: null, ...payload });
      const timestamp = String(Date.now());
      const response = await fetch(runner + "/dispatch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": payload.idempotencyKey,
          "X-RDPS-Timestamp": timestamp,
          "X-RDPS-Signature": sign(body, timestamp, runnerSecret),
        },
        body,
      });
      await response.text();
      return response.status;
    },
    async dispatch(payload = deployment) {
      assert.equal(await this.sendDispatch(payload), 202);
    },
    async terminal() {
      for (
        let i = 0;
        i < 600 &&
        !callbacks.some(
          ({ body, acknowledged }) =>
            acknowledged &&
            ["SUCCEEDED", "FAILED"].includes(JSON.parse(body).status),
        );
        i++
      )
        await new Promise((resolve) => setTimeout(resolve, 20));
      assert.ok(callbacks.length >= 2);
      for (const { body, headers, path } of callbacks) {
        assert.equal(
          path,
          "/api/v1/internal/deployment-orchestration/runner/requests/" +
            deployment.requestId +
            "/status",
        );
        assert.equal(
          headers["x-rdps-signature"],
          sign(body, headers["x-rdps-timestamp"], runnerSecret),
        );
      }
      return JSON.parse(
        callbacks.findLast(
          ({ body, acknowledged }) =>
            acknowledged &&
            ["SUCCEEDED", "FAILED"].includes(JSON.parse(body).status),
        ).body,
      );
    },
  };
}

test(
  "signed dispatch applies once and reports success after target verification",
  { timeout: 15_000 },
  async (t) => {
    const stateDir = await mkdtemp(join(tmpdir(), "rdps-runner-test-"));
    const target = (
      await start(t, "./sandbox-target.mjs", {
        TARGET_PORT: "0",
        TARGET_HOST: "127.0.0.1",
        RUNNER_STATE_DIR: stateDir,
        DEPLOYMENT_TARGET_SIGNING_SECRET: targetSecret,
      })
    ).url;
    t.after(() => rm(stateDir, { recursive: true, force: true }));
    let healthReads = 0;
    const runner = await fixture(t, async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      if (request.url === "/health" && ++healthReads === 1) {
        response.end(JSON.stringify({ status: "ok", activeDeployments: {} }));
        return;
      }
      const upstream = await fetch(target + request.url, {
        method: request.method,
        ...(request.method === "POST" && {
          headers: request.headers,
          body: Buffer.concat(chunks),
        }),
      });
      response.writeHead(upstream.status).end(await upstream.text());
    });
    const payload = { ...deployment, targetUrl: "http://127.0.0.1:1" };
    await Promise.all([runner.dispatch(payload), runner.dispatch(payload)]);
    assert.equal((await runner.terminal()).status, "SUCCEEDED");
    assert.deepEqual(runner.events, [
      "RUNNING",
      "/deploy",
      "/health",
      "/health",
      "SUCCEEDED",
    ]);
    const health = await fetch(target + "/health").then((response) =>
      response.json(),
    );
    assert.deepEqual(health.activeDeployments, {
      [deployment.projectId]: {
        [deployment.environmentId]: { releaseId: deployment.releaseId },
      },
    });
  },
);

test(
  "retries a rejected RUNNING callback before applying and completes",
  { timeout: 15_000 },
  async (t) => {
    let runningAttempts = 0;
    let deploys = 0;
    const runner = await fixture(
      t,
      async (request, response) => {
        if (request.url === "/deploy") deploys++;
        if (request.method === "POST") response.writeHead(200).end();
        else
          response.end(
            JSON.stringify({
              status: "ok",
              activeDeployments: {
                [deployment.projectId]: {
                  [deployment.environmentId]: {
                    releaseId: deployment.releaseId,
                  },
                },
              },
            }),
          );
      },
      {
        callbackHandler: async (_request, response, callback) => {
          if (callback.status === "RUNNING" && ++runningAttempts === 1) {
            response.writeHead(503).end("private response");
            return;
          }
          response.writeHead(204).end();
        },
      },
    );
    await runner.dispatch();
    const result = await runner.terminal();
    assert.equal(runningAttempts, 2);
    assert.equal(deploys, 1);
    assert.equal(result.status, "SUCCEEDED");
  },
);

test(
  "waits for a delayed RUNNING acknowledgement before applying",
  { timeout: 10_000 },
  async (t) => {
    let releaseRunning;
    const runningGate = new Promise((resolve) => (releaseRunning = resolve));
    let deploys = 0;
    let receivedRunning;
    const runningSeen = new Promise((resolve) => (receivedRunning = resolve));
    const runner = await fixture(
      t,
      async (request, response) => {
        if (request.url === "/deploy") deploys++;
        if (request.method === "POST") response.writeHead(200).end();
        else
          response.end(
            JSON.stringify({
              status: "ok",
              activeDeployments: {
                [deployment.projectId]: {
                  [deployment.environmentId]: {
                    releaseId: deployment.releaseId,
                  },
                },
              },
            }),
          );
      },
      {
        callbackHandler: async (_request, response, callback) => {
          if (callback.status === "RUNNING") {
            receivedRunning();
            await runningGate;
          }
          response.writeHead(204).end();
        },
      },
    );
    await runner.dispatch();
    await runningSeen;
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(deploys, 0);
    releaseRunning();
    assert.equal((await runner.terminal()).status, "SUCCEEDED");
    assert.equal(deploys, 1);
  },
);

test(
  "recovers an accepted dispatch after process restart and does not reapply",
  { timeout: 15_000 },
  async (t) => {
    const stateDir = await mkdtemp(join(tmpdir(), "rdps-runner-journal-"));
    removeAfterRunnersStop(t, stateDir);
    let terminalUnavailable = true;
    let deploys = 0;
    let callbackCount = 0;
    const runner = await fixture(
      t,
      async (request, response) => {
        if (request.url === "/deploy") deploys++;
        if (request.method === "POST") response.writeHead(200).end();
        else
          response.end(
            JSON.stringify({
              status: "ok",
              activeDeployments: {
                [deployment.projectId]: {
                  [deployment.environmentId]: {
                    releaseId: deployment.releaseId,
                  },
                },
              },
            }),
          );
      },
      {
        journalDir: stateDir,
        callbackHandler: async (_request, response, callback) => {
          callbackCount++;
          if (callback.status === "SUCCEEDED" && terminalUnavailable) {
            response.writeHead(503).end();
            return;
          }
          response.writeHead(204).end();
        },
      },
    );
    await runner.dispatch();
    const acceptedJournal = JSON.parse(
      await readFile(join(stateDir, "accepted-dispatches.json"), "utf8"),
    );
    assert.equal(
      acceptedJournal.jobs[0].deployment.requestId,
      deployment.requestId,
    );
    for (let i = 0; i < 300 && deploys === 0; i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(deploys, 1);
    await runner.runnerProcess.stop();
    terminalUnavailable = false;
    const restarted = await runner.restart();
    await runner.dispatch();
    const result = await runner.terminal();
    assert.equal(result.status, "SUCCEEDED");
    assert.equal(deploys, 1);
    assert.ok(callbackCount >= 2);
    await restarted.stop();
  },
);

test(
  "does not acknowledge a dispatch after journal failure until retry is durable",
  { timeout: 15_000 },
  async (t) => {
    const stateDir = await mkdtemp(
      join(tmpdir(), "rdps-runner-journal-fault-"),
    );
    removeAfterRunnersStop(t, stateDir);
    const preloadPath = join(stateDir, "fail-first-journal-write.mjs");
    await writeFile(
      preloadPath,
      `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const originalWriteFileSync = fs.writeFileSync;
let failOnce = true;
fs.writeFileSync = function (path, ...args) {
  if (failOnce && String(path).endsWith("accepted-dispatches.tmp")) {
    failOnce = false;
    throw Object.assign(new Error("injected journal write failure"), { code: "EIO" });
  }
  return originalWriteFileSync.call(this, path, ...args);
};
syncBuiltinESMExports();
`,
    );
    let deploys = 0;
    const runner = await fixture(
      t,
      async (request, response) => {
        if (request.url === "/deploy") deploys++;
        if (request.method === "POST") response.writeHead(200).end();
        else
          response.end(
            JSON.stringify({
              status: "ok",
              activeDeployments: {
                [deployment.projectId]: {
                  [deployment.environmentId]: {
                    releaseId: deployment.releaseId,
                  },
                },
              },
            }),
          );
      },
      {
        journalDir: stateDir,
        env: { NODE_OPTIONS: `--import=${pathToFileURL(preloadPath).href}` },
      },
    );

    assert.equal(await runner.sendDispatch(), 400);
    assert.equal(await runner.sendDispatch(), 202);
    const journal = JSON.parse(
      await readFile(join(stateDir, "accepted-dispatches.json"), "utf8"),
    );
    assert.equal(journal.jobs[0].deployment.requestId, deployment.requestId);
    assert.equal((await runner.terminal()).status, "SUCCEEDED");
    assert.equal(deploys, 1);
  },
);

test(
  "retries transient health network and invalid JSON failures within the probe window",
  { timeout: 15_000 },
  async (t) => {
    let reads = 0;
    const runner = await fixture(t, (request, response) => {
      if (request.method === "POST") {
        response.writeHead(200).end();
        return;
      }
      reads++;
      if (reads === 1) {
        request.socket.destroy();
      } else if (reads === 2) {
        response.end("{");
      } else {
        response.end(
          JSON.stringify({
            status: "ok",
            activeDeployments: {
              [deployment.projectId]: {
                [deployment.environmentId]: { releaseId: deployment.releaseId },
              },
            },
          }),
        );
      }
    });
    await runner.dispatch();
    assert.equal((await runner.terminal()).status, "SUCCEEDED");
    assert.equal(reads, 3);
  },
);

test(
  "does not match a release active under another project",
  { timeout: 15_000 },
  async (t) => {
    const runner = await fixture(t, (request, response) => {
      if (request.method === "POST") {
        response.writeHead(200).end();
        return;
      }
      response.end(
        JSON.stringify({
          status: "ok",
          activeDeployments: {
            "other-project": {
              [deployment.environmentId]: { releaseId: deployment.releaseId },
            },
          },
        }),
      );
    });
    await runner.dispatch();
    assert.equal((await runner.terminal()).status, "FAILED");
  },
);

for (const [name, field, value] of [
  [
    "external target cleartext",
    "DEPLOYMENT_TARGET_URL",
    "http://attacker.example",
  ],
  ["external callback cleartext", "RDPS_API_URL", "http://attacker.example"],
  ["malformed target URL", "DEPLOYMENT_TARGET_URL", "http://[::1"],
  ["malformed callback URL", "RDPS_API_URL", "http://[::1"],
]) {
  test("rejects " + name + " at startup", { timeout: 10_000 }, async (t) => {
    const stateDir = await mkdtemp(join(tmpdir(), "rdps-invalid-runner-"));
    t.after(() => rm(stateDir, { recursive: true, force: true }));
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("./server.mjs", import.meta.url))],
      {
        env: {
          ...process.env,
          NODE_ENV: "development",
          RUNNER_PORT: String(await unusedPort()),
          RUNNER_HOST: "127.0.0.1",
          RDPS_API_URL: "http://127.0.0.1:1",
          DEPLOYMENT_RUNNER_SIGNING_SECRET: runnerSecret,
          DEPLOYMENT_TARGET_URL: "http://127.0.0.1:1",
          DEPLOYMENT_TARGET_SIGNING_SECRET: targetSecret,
          RUNNER_STATE_DIR: stateDir,
          [field]: value,
        },
        stdio: "ignore",
      },
    );
    const exited = await Promise.race([
      once(child, "close").then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 300)),
    ]);
    if (!exited) child.kill("SIGKILL");
    assert.equal(exited, true);
  });
}

for (const failure of [
  "redirect",
  "transport",
  "timeout",
  "unhealthy",
  "wrong release",
]) {
  test(
    "reports safe failure for target " + failure,
    { timeout: 15_000 },
    async (t) => {
      const runner = await fixture(t, (request, response) => {
        if (failure === "redirect") {
          response
            .writeHead(307, { Location: "/unexpected" })
            .end(targetSecret);
        } else if (failure === "transport") {
          request.socket.destroy();
        } else if (failure === "timeout") {
          return;
        } else if (request.method === "POST") {
          response.writeHead(200).end();
        } else if (failure === "unhealthy") {
          response.writeHead(503).end(targetSecret);
        } else {
          response.end(
            JSON.stringify({
              status: "ok",
              activeDeployments: {
                [deployment.projectId]: {
                  [deployment.environmentId]: { releaseId: targetSecret },
                },
              },
            }),
          );
        }
      });
      await runner.dispatch();
      const result = await runner.terminal();
      assert.equal(result.status, "FAILED");
      assert.match(result.resultCode, /^LOCAL_TARGET_(APPLY|VERIFY)_FAILED$/);
      assert.equal(
        result.resultSummary,
        "Local sandbox deployment could not be verified",
      );
      assert.equal(runner.events[0], "RUNNING");
      assert.equal(runner.events[1], "/deploy");
      assert.equal(runner.events.at(-1), "FAILED");
      assert.ok(!runner.events.includes("/unexpected"));
    },
  );
}
