import assert from "node:assert/strict";
import test from "node:test";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { DeploymentOrchestrationService } from "./deployment-orchestration.service";

const actor = { id: "user-1", isSystemAdmin: false };
const policy = {
  enabled: true,
  requireApprovedRelease: true,
};

function setup(overrides: Record<string, unknown> = {}) {
  const state: Record<string, any> = {
    environment: {
      id: "env-1",
      projectId: "project-1",
      enabled: true,
      deploymentTriggerEnabled: policy.enabled,
      deploymentRequiresApprovedRelease: policy.requireApprovedRelease,
      name: "STAGING",
    },
    release: { id: "release-1", projectId: "project-1", status: "APPROVED" },
    membership: { role: "RELEASE_MANAGER" },
    request: undefined,
    audits: [] as any[],
    jobs: [] as any[],
  };
  Object.assign(state, overrides);
  const prisma: any = {
    projectMember: { findUnique: async () => state.membership },
    projectEnvironment: {
      findFirst: async () => state.environment,
      update: async ({ data }: any) => {
        state.environment = { ...state.environment, ...data };
        return state.environment;
      },
      updateMany: async ({ data }: any) => {
        Object.assign(state.environment, data);
        return { count: 1 };
      },
    },
    release: { findFirst: async () => state.release },
    deploymentTriggerRequest: {
      findUnique: async () => state.request,
      findFirst: async () => state.request,
      findMany: async () => (state.request ? [state.request] : []),
      create: async ({ data }: any) => {
        state.request = {
          id: "request-1",
          ...data,
          dispatchEnqueuedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        return state.request;
      },
      update: async ({ data }: any) => {
        state.request = { ...state.request, ...data, updatedAt: new Date() };
        return state.request;
      },
      updateMany: async ({ where, data }: any) => {
        if (where.dispatchEnqueuedAt === null) {
          if (!state.request || state.request.id !== where.id)
            return { count: 0 };
          Object.assign(state.request, data);
          return { count: 1 };
        }
        if (
          !state.request ||
          state.request.id !== where.id ||
          state.request.status !== where.status
        )
          return { count: 0 };
        state.request = { ...state.request, ...data, updatedAt: new Date() };
        return { count: 1 };
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        state.audits.push(data);
      },
    },
    add: undefined,
    $transaction: async (fn: any) => fn(prisma),
  };
  const queue = {
    add: async (...args: any[]) => {
      if (state.failQueueAdd > 0) {
        state.failQueueAdd--;
        throw new Error("queue unavailable");
      }
      state.jobs.push(args);
      return {};
    },
  };
  return { service: new DeploymentOrchestrationService(prisma, queue), state };
}

test("trigger request is gated by the environment policy and records audited intent", async () => {
  const { service, state } = setup();
  const created = await service.requestTrigger(
    actor,
    "project-1",
    "release-1",
    "env-1",
    "idempotency-1",
    "release window",
  );
  assert.equal(created.status, "REQUESTED");
  assert.equal(created.environmentId, "env-1");
  assert.equal(state.audits[0].action, "deployment.trigger.requested");
  assert.equal(state.audits[0].entityId, created.id);
  assert.equal(state.audits[0].metadata.environmentId, "env-1");
  assert.equal(state.jobs.length, 1);
  assert.equal(state.jobs[0][1].requestId, created.id);
  assert.equal(state.jobs[0][2].jobId, created.id);
});

test("idempotent retry repairs a request whose first queue enqueue failed", async () => {
  const { service, state } = setup({ failQueueAdd: 1 });
  await assert.rejects(
    service.requestTrigger(
      actor,
      "project-1",
      "release-1",
      "env-1",
      "idempotency-1",
    ),
    /queue unavailable/,
  );
  assert.equal(state.request.status, "REQUESTED");
  const replay = await service.requestTrigger(
    actor,
    "project-1",
    "release-1",
    "env-1",
    "idempotency-1",
  );
  assert.equal(replay.id, state.request.id);
  assert.equal(state.jobs.length, 1);
  assert.ok(state.request.dispatchEnqueuedAt);
});

test("disabled environment policy rejects trigger requests", async () => {
  const { service } = setup({
    environment: {
      id: "env-1",
      projectId: "project-1",
      enabled: true,
      deploymentTriggerEnabled: false,
      deploymentRequiresApprovedRelease: true,
    },
  });
  await assert.rejects(
    service.requestTrigger(
      actor,
      "project-1",
      "release-1",
      "env-1",
      "idempotency-1",
    ),
    ForbiddenException,
  );
});

test("environment policy changes are role-gated and audited", async () => {
  const { service, state } = setup();
  const result = await service.setPolicy(actor, "project-1", "env-1", {
    enabled: false,
    requireApprovedRelease: true,
  });
  assert.deepEqual(result, {
    environmentId: "env-1",
    enabled: false,
    requireApprovedRelease: true,
  });
  assert.equal(state.audits[0].action, "deployment.policy.updated");
  const { service: restricted } = setup({ membership: { role: "DEVELOPER" } });
  await assert.rejects(
    restricted.setPolicy(actor, "project-1", "env-1", {
      enabled: true,
      requireApprovedRelease: true,
    }),
    ForbiddenException,
  );
});

test("same idempotency key replays the original request while changed intent conflicts", async () => {
  const { service, state } = setup();
  const first = await service.requestTrigger(
    actor,
    "project-1",
    "release-1",
    "env-1",
    "idempotency-1",
    "release window",
  );
  const replay = await service.requestTrigger(
    actor,
    "project-1",
    "release-1",
    "env-1",
    "idempotency-1",
    "release window",
  );
  assert.equal(replay.id, first.id);
  assert.equal(state.jobs.length, 1);
  await assert.rejects(
    service.requestTrigger(
      actor,
      "project-1",
      "release-1",
      "env-1",
      "idempotency-1",
      "different intent",
    ),
    ConflictException,
  );
});

test("worker dispatch callback advances REQUESTED and preserves later manual state", async () => {
  const { service, state } = setup();
  const requested = await service.requestTrigger(
    actor,
    "project-1",
    "release-1",
    "env-1",
    "idempotency-1",
  );
  const accepted = await service.reportDispatchStatus(requested.id, {
    status: "ACCEPTED",
    resultCode: "RUNNER_ACCEPTED",
    resultSummary: "Deployment runner accepted the request",
  });
  assert.equal(accepted.status, "ACCEPTED");
  assert.equal(state.audits.at(-1).metadata.actor, "deployment-worker");
  await service.updateStatus(actor, "project-1", requested.id, {
    status: "RUNNING",
  });
  const lateFailure = await service.reportDispatchStatus(requested.id, {
    status: "FAILED",
    resultCode: "RUNNER_REQUEST_FAILED",
    resultSummary: "Deployment runner did not accept the request after retries",
  });
  assert.equal(lateFailure.status, "RUNNING");
});

test("approval policy blocks unapproved releases", async () => {
  const { service } = setup({
    release: { id: "release-1", projectId: "project-1", status: "DRAFT" },
  });
  await assert.rejects(
    service.requestTrigger(
      actor,
      "project-1",
      "release-1",
      "env-1",
      "idempotency-1",
    ),
    ForbiddenException,
  );
});

test("status tracking accepts only legal transitions and stores bounded result fields", async () => {
  const { service, state } = setup();
  const requested = await service.requestTrigger(
    actor,
    "project-1",
    "release-1",
    "env-1",
    "idempotency-1",
  );
  const accepted = await service.updateStatus(
    actor,
    "project-1",
    requested.id,
    {
      status: "RUNNING",
      resultCode: "BUILD_STARTED",
      resultSummary: "Deployment job started",
    },
  );
  assert.equal(accepted.status, "RUNNING");
  assert.equal(accepted.resultCode, "BUILD_STARTED");
  assert.equal(state.audits.length, 2);
  await assert.rejects(
    service.updateStatus(actor, "project-1", requested.id, {
      status: "REQUESTED",
    } as any),
    ConflictException,
  );
});

test("status results reject credential-like content", async () => {
  const { service } = setup();
  const requested = await service.requestTrigger(
    actor,
    "project-1",
    "release-1",
    "env-1",
    "idempotency-1",
  );
  await assert.rejects(
    service.updateStatus(actor, "project-1", requested.id, {
      status: "RUNNING",
      resultSummary: "Bearer secret-value",
    }),
    BadRequestException,
  );
});

test("clients cannot request deployment triggers", async () => {
  const { service } = setup({ membership: { role: "CLIENT" } });
  await assert.rejects(
    service.requestTrigger(
      actor,
      "project-1",
      "release-1",
      "env-1",
      "idempotency-1",
    ),
    ForbiddenException,
  );
});

test("runner status callbacks advance and audit deployment execution", async () => {
  const { service, state } = setup();
  const requested = await service.requestTrigger(
    actor,
    "project-1",
    "release-1",
    "env-1",
    "idempotency-1",
  );
  const running = await service.reportRunnerStatus(requested.id, {
    status: "RUNNING",
    resultCode: "DEPLOYMENT_STARTED",
    resultSummary: "Deployment execution started",
  });
  assert.equal(running.status, "RUNNING");
  assert.equal(
    state.audits.at(-1).action,
    "deployment.trigger.runner_status_updated",
  );
  assert.equal(state.audits.at(-1).metadata.actor, "deployment-runner");
  const succeeded = await service.reportRunnerStatus(requested.id, {
    status: "SUCCEEDED",
    resultCode: "DEPLOYMENT_SUCCEEDED",
    resultSummary: "Deployment completed",
  });
  assert.equal(succeeded.status, "SUCCEEDED");
  assert.ok(succeeded.completedAt);
});
