import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { DeploymentRunnerController } from "./deployment-runner.controller";

test("runner callback authenticates timestamp and exact body bytes", async () => {
  const previous = process.env.DEPLOYMENT_RUNNER_SIGNING_SECRET;
  const secret = "deployment-runner-callback-test-secret-32-bytes";
  process.env.DEPLOYMENT_RUNNER_SIGNING_SECRET = secret;
  const received: unknown[][] = [];
  const controller = new DeploymentRunnerController({
    reportRunnerStatus: async (...args: any[]) => {
      received.push(args);
      return { status: args[1].status };
    },
  } as any);
  const body = Buffer.from(
    JSON.stringify({
      status: "SUCCEEDED",
      resultCode: "DEPLOYMENT_SUCCEEDED",
      resultSummary: "Deployment completed",
    }),
  );
  const timestamp = String(Date.now());
  const signature = `sha256=${createHmac("sha256", secret)
    .update(`${timestamp}.${body.toString("utf8")}`)
    .digest("hex")}`;
  try {
    assert.throws(
      () =>
        controller.report(
          "11111111-1111-4111-8111-111111111111",
          JSON.parse(body.toString("utf8")),
          { rawBody: body },
          timestamp,
          "sha256=" + "0".repeat(64),
        ),
      UnauthorizedException,
    );
    const result = await controller.report(
      "11111111-1111-4111-8111-111111111111",
      JSON.parse(body.toString("utf8")),
      { rawBody: body },
      timestamp,
      signature,
    );
    assert.deepEqual(result, { status: "SUCCEEDED" });
    assert.equal(received.length, 1);
  } finally {
    if (previous === undefined)
      delete process.env.DEPLOYMENT_RUNNER_SIGNING_SECRET;
    else process.env.DEPLOYMENT_RUNNER_SIGNING_SECRET = previous;
  }
});

test("runner callback rejects stale timestamps", async () => {
  const previous = process.env.DEPLOYMENT_RUNNER_SIGNING_SECRET;
  process.env.DEPLOYMENT_RUNNER_SIGNING_SECRET =
    "deployment-runner-callback-test-secret-32-bytes";
  const controller = new DeploymentRunnerController({} as any);
  const body = Buffer.from('{"status":"RUNNING"}');
  const timestamp = String(Date.now() - 6 * 60 * 1000);
  const signature = `sha256=${createHmac(
    "sha256",
    process.env.DEPLOYMENT_RUNNER_SIGNING_SECRET,
  )
    .update(`${timestamp}.${body.toString("utf8")}`)
    .digest("hex")}`;
  try {
    assert.throws(
      () =>
        controller.report(
          "11111111-1111-4111-8111-111111111111",
          { status: "RUNNING" } as any,
          { rawBody: body },
          timestamp,
          signature,
        ),
      UnauthorizedException,
    );
  } finally {
    if (previous === undefined)
      delete process.env.DEPLOYMENT_RUNNER_SIGNING_SECRET;
    else process.env.DEPLOYMENT_RUNNER_SIGNING_SECRET = previous;
  }
});
