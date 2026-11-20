import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const secret = "sandbox-target-test-secret-32-characters";
const deployment = {
  projectId: "project-1",
  releaseId: "release-1",
  environmentId: "qa",
  requestId: "request-1",
  idempotencyKey: "key-1",
};
const next = {
  ...deployment,
  releaseId: "release-2",
  requestId: "request-2",
  idempotencyKey: "key-2",
};

async function startTarget(t, stateDir, fault) {
  if (!stateDir) {
    stateDir = await mkdtemp(join(tmpdir(), "rdps-target-"));
    t.after(() => rm(stateDir, { recursive: true, force: true }));
  }
  const preload = fault ? ["--import", faultPreload(fault)] : [];
  const child = spawn(
    process.execPath,
    [
      ...preload,
      fileURLToPath(new URL("./sandbox-target.mjs", import.meta.url)),
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: "development",
        RUNNER_STATE_DIR: stateDir,
        TARGET_HOST: "127.0.0.1",
        TARGET_PORT: "0",
        DEPLOYMENT_TARGET_SIGNING_SECRET: secret,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const closed = once(child, "close");
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await closed;
  };
  t.after(stop);
  const lines = createInterface({ input: child.stdout });
  const port = await Promise.race([
    once(lines, "line").then(([line]) => JSON.parse(line).port),
    closed.then(() => {
      throw new Error(stderr || "Target exited before listening");
    }),
  ]);
  const url = `http://127.0.0.1:${port}`;

  function raw(
    body,
    {
      timestamp = Date.now(),
      key = secret,
      headers = {},
      chunked = false,
    } = {},
  ) {
    const signature = createHmac("sha256", key)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    const requestHeaders = {
      "content-type": "application/json",
      "x-rdps-timestamp": String(timestamp),
      "x-rdps-signature": `sha256=${signature}`,
      ...(chunked
        ? { "transfer-encoding": "chunked" }
        : { "content-length": Buffer.byteLength(body) }),
      ...headers,
    };
    return new Promise((resolve, reject) => {
      const outgoing = request(
        `${url}/deploy`,
        { method: "POST", headers: requestHeaders },
        (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode));
          response.on("error", reject);
        },
      );
      outgoing.on("error", reject);
      if (chunked) {
        outgoing.write(body.slice(0, 10_000));
        outgoing.end(body.slice(10_000));
      } else {
        outgoing.end(body);
      }
    });
  }

  return {
    stateDir,
    stop,
    persisted: () => readFile(join(stateDir, "state.json"), "utf8"),
    health: async () => {
      const response = await fetch(`${url}/health`);
      assert.equal(response.status, 200);
      return response.json();
    },
    raw,
    deploy: (payload, options) =>
      raw(JSON.stringify(payload), {
        ...options,
        headers: { "idempotency-key": payload.idempotencyKey },
      }),
  };
}

function faultPreload(fault) {
  const source = `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    const fault = ${JSON.stringify(fault)};
    const fail = () => { throw Object.assign(new Error("Injected persistence failure"), { code: "EIO" }); };
    const original = fs[fault === "fsyncOnce" ? "fsyncSync" : fault];
    if (fault === "fsyncSync" || fault === "fsyncOnce") {
      // Simulate a Linux directory descriptor when running the tests on Windows.
      const open = fs.openSync;
      const close = fs.closeSync;
      const directoryFd = -100;
      Object.defineProperty(process, "platform", { value: "linux" });
      fs.openSync = (path, ...args) => path === process.env.RUNNER_STATE_DIR ? directoryFd : open(path, ...args);
      fs.closeSync = (fd) => { if (fd !== directoryFd) close(fd); };
      let directorySyncCount = 0;
      fs.fsyncSync = (fd) => {
        if (fd !== directoryFd) return original(fd);
        directorySyncCount += 1;
        if (fault === "fsyncSync" || directorySyncCount === 1) {
          return fail();
        }
        const probe = open(process.env.RUNNER_STATE_DIR + "/state.json", "r+");
        try {
          return original(probe);
        } finally {
          close(probe);
        }
      };
    } else {
      fs[fault] = (...args) => String(args[0]).endsWith("state.tmp") ? fail() : original(...args);
    }
    syncBuiltinESMExports();
  `;
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

test("scopes environments, keys, and request IDs by project across restart", async (t) => {
  const target = await startTarget(t);
  const other = {
    ...deployment,
    projectId: "project-2",
    releaseId: "other-release",
  };
  assert.equal(await target.deploy(deployment), 200);
  assert.equal(await target.deploy(other), 200);
  assert.equal(
    await target.deploy({
      ...next,
      projectId: other.projectId,
      idempotencyKey: "key-3",
    }),
    200,
  );
  assert.equal(await target.deploy({ ...next, environmentId: "staging" }), 200);
  const expected = {
    status: "ok",
    activeDeployments: {
      "project-1": {
        qa: { releaseId: "release-1" },
        staging: { releaseId: "release-2" },
      },
      "project-2": { qa: { releaseId: "release-2" } },
    },
    deliveryAttempts: {
      "project-1": { "request-1": 1, "request-2": 1 },
      "project-2": { "request-1": 1, "request-2": 1 },
    },
  };
  assert.deepEqual(await target.health(), expected);
  await target.stop();
  const restarted = await startTarget(t, target.stateDir);
  assert.deepEqual(await restarted.health(), {
    ...expected,
    deliveryAttempts: {},
  });
  assert.equal(await restarted.deploy(other), 200);
  assert.equal(await restarted.deploy(deployment), 200);
  assert.equal(
    await restarted.deploy({ ...deployment, requestId: "retry" }),
    200,
  );
  assert.equal(
    await restarted.deploy({
      ...deployment,
      requestId: "retry",
      idempotencyKey: "different",
    }),
    409,
  );
  assert.equal(await restarted.deploy(next), 409);
  assert.equal(
    await restarted.deploy({ ...other, idempotencyKey: "different" }),
    409,
  );
  assert.deepEqual(await restarted.health(), {
    ...expected,
    deliveryAttempts: {
      "project-1": { "request-1": 1, retry: 1 },
      "project-2": { "request-1": 1 },
    },
  });
});

test("reports repeated signed deliveries separately from unique applications", async (t) => {
  const target = await startTarget(t);
  assert.equal(await target.deploy(deployment), 200);
  assert.equal(await target.deploy(deployment), 200);
  assert.deepEqual((await target.health()).deliveryAttempts, {
    "project-1": { "request-1": 2 },
  });
});

test("rejects invalid signatures, stale or future timestamps, and invalid bodies", async (t) => {
  const target = await startTarget(t);
  assert.equal(await target.deploy(deployment, { key: "wrong" }), 401);
  for (const offset of [-301_000, 301_000]) {
    assert.equal(
      await target.deploy(deployment, { timestamp: Date.now() + offset }),
      401,
    );
  }
  assert.equal(await target.deploy({ ...deployment, releaseId: "" }), 400);
  assert.equal(
    await target.deploy({ ...deployment, padding: "x".repeat(17_000) }),
    413,
  );
  assert.deepEqual((await target.health()).activeDeployments, {});
});

const nextBody = JSON.stringify(next);
const nextHeaders = { "idempotency-key": next.idempotencyKey };
for (const [name, body, options, status] of [
  [
    "malformed signature",
    nextBody,
    { headers: { ...nextHeaders, "x-rdps-signature": "sha256=xyz" } },
    401,
  ],
  [
    "signed malformed JSON",
    nextBody.slice(0, -1),
    { headers: nextHeaders },
    400,
  ],
  ["missing idempotency header", nextBody, {}, 400],
  [
    "mismatched idempotency header",
    nextBody,
    { headers: { "idempotency-key": "wrong" } },
    400,
  ],
  [
    "oversized chunked body",
    JSON.stringify({ ...next, padding: "x".repeat(17_000) }),
    { headers: nextHeaders, chunked: true },
    413,
  ],
]) {
  test(`rejects ${name} without changing active state or persisted replay records`, async (t) => {
    const target = await startTarget(t);
    assert.equal(await target.deploy(deployment), 200);
    const health = await target.health();
    const persisted = await target.persisted();
    assert.equal(await target.raw(body, options), status);
    assert.deepEqual(await target.health(), health);
    assert.equal(await target.persisted(), persisted);
  });
}

for (const fault of ["writeFileSync", "renameSync", "fsyncSync"]) {
  test(`recovers after ${fault} failure and abrupt stop`, async (t) => {
    const target = await startTarget(t);
    assert.equal(await target.deploy(deployment), 200);
    const health = await target.health();
    const persisted = await target.persisted();
    await target.stop();

    const failing = await startTarget(t, target.stateDir, fault);
    assert.equal(await failing.deploy(next), 500);
    const afterFailure = await failing.health();
    if (fault === "fsyncSync") {
      assert.equal(
        afterFailure.activeDeployments[next.projectId].qa.releaseId,
        next.releaseId,
      );
      assert.notEqual(await failing.persisted(), persisted);
      assert.equal(
        await failing.deploy({ ...next, releaseId: "conflict" }),
        409,
      );
      assert.equal(await failing.deploy(next), 500);
    } else {
      assert.deepEqual(
        afterFailure.activeDeployments,
        health.activeDeployments,
      );
      assert.deepEqual(afterFailure.deliveryAttempts, {});
      assert.equal(await failing.persisted(), persisted);
    }
    assert.equal(
      await failing.deploy({ ...deployment, idempotencyKey: "different" }),
      409,
    );
    await failing.stop();

    const recovered = await startTarget(t, target.stateDir);
    assert.deepEqual(await recovered.health(), afterFailure);
    assert.equal(
      await recovered.deploy({ ...deployment, releaseId: "conflict" }),
      409,
    );
    assert.equal(await recovered.deploy(next), 200);
    const applied = await recovered.persisted();
    assert.equal(await recovered.deploy(next), 200);
    assert.equal(await recovered.persisted(), applied);
    assert.equal(
      (await recovered.health()).activeDeployments[next.projectId].qa.releaseId,
      next.releaseId,
    );
  });
}

test("recovers active state and replay records from the original snapshot format", async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), "rdps-target-"));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  await writeFile(
    join(stateDir, "state.json"),
    JSON.stringify({
      activeDeployments: {
        qa: {
          projectId: deployment.projectId,
          releaseId: deployment.releaseId,
        },
      },
      requests: { [deployment.requestId]: deployment.idempotencyKey },
      deploymentsByKey: {
        [deployment.idempotencyKey]: {
          projectId: deployment.projectId,
          releaseId: deployment.releaseId,
          environmentId: deployment.environmentId,
        },
      },
    }),
  );
  const target = await startTarget(t, stateDir);
  assert.equal(
    (await target.health()).activeDeployments[deployment.projectId].qa
      .releaseId,
    deployment.releaseId,
  );
  assert.equal(
    await target.deploy({ ...deployment, idempotencyKey: "different" }),
    409,
  );
  assert.equal(
    await target.deploy({ ...deployment, releaseId: "different" }),
    409,
  );
});

test("does not acknowledge a persisted replay after restart until directory sync succeeds", async (t) => {
  const target = await startTarget(t);
  assert.equal(await target.deploy(deployment), 200);
  const failing = await startTarget(t, target.stateDir, "fsyncSync");
  assert.equal(await failing.deploy(next), 500);
  await failing.stop();

  const restarted = await startTarget(t, target.stateDir, "fsyncOnce");
  assert.equal(await restarted.deploy(next), 500);
  assert.equal(await restarted.deploy(next), 200);
  assert.equal(await restarted.deploy(next), 200);
  assert.equal(
    (await restarted.health()).activeDeployments[deployment.projectId].qa
      .releaseId,
    next.releaseId,
  );
});
