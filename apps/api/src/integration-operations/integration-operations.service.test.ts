import assert from "node:assert/strict";
import { test } from "node:test";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { IntegrationOperationsService } from "./integration-operations.service";

function setup(
  options: { role?: string; jobs?: any[]; noMembership?: boolean } = {},
) {
  const auditCreates: any[] = [];
  const eventRows = [
    {
      id: "event-a",
      provider: "github",
      deliveryId: "delivery-a",
      eventType: "push",
      status: "RECEIVED",
      receivedAt: new Date("2026-11-11T10:00:00Z"),
      processedAt: null,
    },
    {
      id: "event-b",
      provider: "github",
      deliveryId: "delivery-b",
      eventType: "push",
      status: "RECEIVED",
      receivedAt: new Date("2026-11-11T10:01:00Z"),
      processedAt: null,
    },
  ];
  const prisma: any = {
    projectMember: {
      findFirst: async () =>
        options.noMembership ? null : { role: options.role ?? "ADMIN" },
    },
    projectRepository: {
      findMany: async () => [
        { provider: "github", owner: "acme", name: "app" },
      ],
    },
    auditLog: {
      findMany: async () => [],
      create: async ({ data }: any) => auditCreates.push(data),
    },
    integrationSuggestion: { findMany: async () => [] },
    webhookEvent: {
      findMany: async ({ where }: any) =>
        eventRows.filter((event) => where.id.in.includes(event.id)),
      findFirst: async ({ where }: any) =>
        eventRows.find((event) => event.id === where.id) ?? null,
    },
    $transaction: async (callback: any) => callback(prisma),
  };
  const jobs = options.jobs ?? [];
  const queue: any = {
    getJobs: async () => jobs,
    getJobCounts: async () => ({
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: jobs.length,
      completed: 0,
    }),
    getJob: async (id: string) => jobs.find((job) => job.id === id) ?? null,
  };
  return {
    service: new IntegrationOperationsService(prisma, queue),
    prisma,
    queue,
    auditCreates,
  } as any;
}

function failedJob(id: string, eventId: string, repository = "acme/app"): any {
  return {
    id,
    data: {
      kind: "github",
      eventId,
      repository,
      eventType: "push",
      action: "created",
      reference: { kind: "tag", externalId: "v1.0.0" },
    },
    attemptsMade: 8,
    failedReason: "Authorization: Bearer super-secret token; 429 rate limit",
    timestamp: 1_794_300_000_000,
    finishedOn: 1_794_300_100_000,
    getState: async () => "failed",
    retry: async () => undefined,
  };
}

test("lists only project-attributed events with sanitized retry diagnostics", async () => {
  const ownJob = failedJob("webhook-event-a", "event-a");
  const { service } = setup({
    jobs: [ownJob, failedJob("webhook-event-b", "event-b", "other/repo")],
  });

  const result = await service.list(
    { id: "member", isSystemAdmin: false },
    "project-a",
  );

  assert.deepEqual(
    result.events.map((event: any) => event.id),
    ["event-a"],
  );
  assert.equal(result.events[0]!.retryable, true);
  assert.equal(result.events[0]!.errorCode, "RATE_LIMITED");
  assert.equal(JSON.stringify(result).includes("super-secret"), false);
  assert.equal(JSON.stringify(result).includes("Authorization"), false);
  assert.equal(result.counts.rateLimited, 1);
});

test("hides diagnostics for actors without project membership", async () => {
  const { service } = setup({ noMembership: true });
  await assert.rejects(
    service.list({ id: "outsider", isSystemAdmin: false }, "project-a"),
    NotFoundException,
  );
});

test("allows retry only to project admins and records every retry", async () => {
  const job = failedJob("webhook-event-a", "event-a");
  let retryCount = 0;
  job.retry = async () => {
    retryCount += 1;
  };
  const { service, auditCreates } = setup({
    role: "RELEASE_MANAGER",
    jobs: [job],
  });

  await service.retry(
    { id: "manager", isSystemAdmin: false },
    "project-a",
    "event-a",
  );

  assert.equal(retryCount, 1);
  assert.equal(auditCreates.length, 1);
  assert.equal(auditCreates[0].action, "integration.webhook.retry_requested");
  assert.equal(auditCreates[0].projectId, "project-a");
});

test("does not retry a failed job after its normalized payload is missing", async () => {
  const job = failedJob("webhook-event-a", "event-a");
  job.data = { eventId: "event-a" };
  const { service } = setup({ role: "ADMIN", jobs: [job] });

  await assert.rejects(
    service.retry(
      { id: "admin", isSystemAdmin: false },
      "project-a",
      "event-a",
    ),
    NotFoundException,
  );
});

test("denies retry to project roles below release manager", async () => {
  const { service } = setup({
    role: "DEVELOPER",
    jobs: [failedJob("webhook-event-a", "event-a")],
  });

  await assert.rejects(
    service.retry(
      { id: "developer", isSystemAdmin: false },
      "project-a",
      "event-a",
    ),
    ForbiddenException,
  );
});

test("does not retry a retained failed job attributed to another project", async () => {
  const { service, auditCreates } = setup({
    role: "ADMIN",
    jobs: [failedJob("webhook-event-a", "event-a", "other/repository")],
  });

  await assert.rejects(
    service.retry(
      { id: "admin", isSystemAdmin: false },
      "project-a",
      "event-a",
    ),
    NotFoundException,
  );
  assert.equal(auditCreates.length, 0);
});

test("audits a retry attempt even when BullMQ rejects the retry", async () => {
  const job = failedJob("webhook-event-a", "event-a");
  job.retry = async () => {
    throw new Error("redis unavailable");
  };
  const { service, auditCreates } = setup({ role: "ADMIN", jobs: [job] });

  await assert.rejects(
    service.retry(
      { id: "admin", isSystemAdmin: false },
      "project-a",
      "event-a",
    ),
    /queue could not accept it/,
  );
  assert.equal(auditCreates.length, 1);
});
