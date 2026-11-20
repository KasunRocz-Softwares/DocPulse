import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { DeploymentWorkerController } from "./deployment-worker.controller";

test("worker dispatch callback requires the shared secret and forwards safe status", async () => {
  const previous = process.env.RDPS_WORKER_SHARED_SECRET;
  process.env.RDPS_WORKER_SHARED_SECRET = "worker-callback-test-secret";
  const received: unknown[][] = [];
  const controller = new DeploymentWorkerController({
    reportDispatchStatus: async (...args: any[]) => {
      received.push(args);
      return { status: args[1].status };
    },
  } as any);
  try {
    assert.throws(
      () =>
        controller.report(
          "11111111-1111-4111-8111-111111111111",
          {
            status: "ACCEPTED",
            resultCode: "RUNNER_ACCEPTED",
            resultSummary: "Deployment runner accepted the request",
          },
          "wrong-secret",
        ),
      UnauthorizedException,
    );
    const result = await controller.report(
      "11111111-1111-4111-8111-111111111111",
      {
        status: "ACCEPTED",
        resultCode: "RUNNER_ACCEPTED",
        resultSummary: "Deployment runner accepted the request",
      },
      "worker-callback-test-secret",
    );
    assert.deepEqual(result, { status: "ACCEPTED" });
    assert.equal(received.length, 1);
  } finally {
    if (previous === undefined) delete process.env.RDPS_WORKER_SHARED_SECRET;
    else process.env.RDPS_WORKER_SHARED_SECRET = previous;
  }
});
