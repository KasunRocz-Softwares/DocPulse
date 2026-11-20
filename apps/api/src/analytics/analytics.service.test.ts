import assert from "node:assert/strict";
import test from "node:test";
import { AnalyticsService } from "./analytics.service";

function setup(overrides: Record<string, any> = {}) {
  const calls: Record<string, any[]> = {};
  const record = (name: string, value: any) => {
    (calls[name] ??= []).push(value);
  };
  const prisma: any = {
    project: {
      findUnique: async () => ({
        id: "project-1",
        slug: "widget",
        name: "Widget",
      }),
    },
    projectMember: { findUnique: async () => ({ role: "ADMIN" }) },
    publicReleaseSnapshot: {
      findFirst: async () => ({
        id: "snapshot-1",
        projectSlug: "widget",
        version: "1.2.3",
        title: "Public release",
        summary: "Public summary",
        publishedAt: new Date("2026-11-01T00:00:00Z"),
        changes: [],
      }),
      findMany: async () => [],
    },
    analyticsEvent: {
      create: async (args: any) => {
        record("event", args);
        return args.data;
      },
      groupBy: async () => [],
    },
    analyticsExportJob: {
      create: async ({ data }: any) => {
        record("job", data);
        return { id: "export-1", ...data };
      },
      findFirst: async () => null,
    },
    auditLog: {
      create: async ({ data }: any) => {
        record("audit", data);
      },
    },
    $transaction: async (fn: (tx: any) => Promise<any>) => fn(prisma),
    ...overrides,
  };
  const queue: any = {
    add: async (...args: any[]) => {
      record("queue", args);
    },
  };
  return { service: new AnalyticsService(prisma, queue), calls, prisma };
}

test("public engagement ingestion persists only allowlisted fields and ignores visitor identifiers", async () => {
  const { service, calls } = setup();
  await service.recordPublicEvent({
    projectSlug: "widget",
    kind: "PROJECT_VIEW",
    ip: "203.0.113.1",
    email: "reader@example.test",
    userAgent: "private",
  });
  assert.deepEqual(calls.event?.[0]?.data, {
    projectId: "project-1",
    snapshotId: null,
    kind: "PROJECT_VIEW",
    occurredOn: new Date("2026-11-11T00:00:00.000Z"),
  });
});

test("release engagement is accepted only for a currently published public snapshot", async () => {
  let query: any;
  const { service } = setup({
    publicReleaseSnapshot: {
      findFirst: async (args: any) => {
        query = args;
        return null;
      },
    },
  });
  await assert.rejects(
    service.recordPublicEvent({
      projectSlug: "widget",
      kind: "RELEASE_VIEW",
      version: "draft",
    }),
  );
  assert.equal(query.where.publication.is.revokedAt, null);
});

test("dashboard and export requests enforce project membership and scope all event reads", async () => {
  let role: string | null = null;
  let eventQuery: any;
  const { service, calls } = setup({
    projectMember: { findUnique: async () => (role ? { role } : null) },
    analyticsEvent: {
      groupBy: async (args: any) => {
        eventQuery = args;
        return [];
      },
    },
  });
  await assert.rejects(
    service.dashboard({ id: "user-1", isSystemAdmin: false }, "project-1", 30),
  );
  role = "CLIENT";
  await assert.rejects(
    service.requestExport({ id: "user-1", isSystemAdmin: false }, "project-1", {
      kind: "ANALYTICS_CSV",
      days: 30,
    }),
  );
  role = "ADMIN";
  const dashboard = await service.dashboard(
    { id: "user-1", isSystemAdmin: false },
    "project-1",
    30,
  );
  assert.deepEqual(dashboard.totals, { projectViews: 0, releaseViews: 0 });
  assert.equal(eventQuery.where.projectId, "project-1");
  await service.requestExport(
    { id: "user-1", isSystemAdmin: false },
    "project-1",
    { kind: "ANALYTICS_CSV", days: 30 },
  );
  assert.equal(calls.job?.[0]?.projectId, "project-1");
  assert.equal(calls.audit?.[0]?.action, "analytics.export_requested");
  assert.equal(calls.queue?.[0]?.[0], "generate-export");
  assert.equal(calls.queue?.[0]?.[2]?.jobId, "analytics-export-1");
  assert.equal(calls.queue?.[0]?.[2]?.attempts, 5);
  assert.deepEqual(calls.queue?.[0]?.[2]?.backoff, {
    type: "exponential",
    delay: 1000,
  });
});

test("worker completion stores the artifact and audits the completed export", async () => {
  let update: any;
  let audit: any;
  const prisma: any = {
    analyticsExportJob: {
      findUnique: async () => ({
        projectId: "project-1",
        status: "PROCESSING",
      }),
      update: async (args: any) => {
        update = args;
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        audit = data;
      },
    },
    $transaction: async (fn: (tx: any) => Promise<any>) => fn(prisma),
  };
  const service = new AnalyticsService(prisma, {
    close: async () => undefined,
  } as any);
  await service.completeExport(
    "export-1",
    Buffer.from("%PDF-1.4"),
    "application/pdf",
  );
  assert.equal(update.data.status, "COMPLETED");
  assert.equal(Buffer.from(update.data.artifact).toString(), "%PDF-1.4");
  assert.equal(audit.action, "analytics.export_completed");
});

test("export download requires project permission, completed status, and records the download", async () => {
  let role: string | null = null;
  let audit: any;
  const { service } = setup({
    projectMember: { findUnique: async () => (role ? { role } : null) },
    analyticsExportJob: {
      findFirst: async () => ({
        id: "export-1",
        projectId: "project-1",
        status: "COMPLETED",
        filename: "analytics.csv",
        contentType: "text/csv",
        artifact: Buffer.from("day\r\n"),
      }),
    },
    auditLog: {
      create: async ({ data }: any) => {
        audit = data;
      },
    },
  });
  const actor = { id: "user-1", isSystemAdmin: false };
  await assert.rejects(service.getExport(actor, "project-1", "export-1"));
  role = "RELEASE_MANAGER";
  const downloaded = await service.getExport(actor, "project-1", "export-1");
  assert.equal(downloaded.filename, "analytics.csv");
  assert.equal(downloaded.artifact.toString(), "day\r\n");
  assert.equal(audit.action, "analytics.export_downloaded");
});
