import assert from "node:assert/strict";
import test from "node:test";
import {
  createAnalyticsExportProcessor,
  ANALYTICS_EXPORT_JOB_DEFAULTS,
} from "./analytics-processor.js";

test("analytics export worker renders CSV and reports completion with the artifact", async () => {
  let completed: any;
  const processor = createAnalyticsExportProcessor({
    complete: async (id, artifact) => {
      completed = { id, artifact };
    },
    fail: async () => undefined,
  });
  await processor({
    data: {
      exportId: "export-1",
      kind: "ANALYTICS_CSV",
      filename: "analytics-widget.csv",
      rows: [{ day: "2026-11-11", projectViews: 3, releaseViews: 2 }],
    },
  });
  assert.equal(completed.id, "export-1");
  assert.equal(completed.artifact.contentType, "text/csv; charset=utf-8");
  assert.match(
    Buffer.from(completed.artifact.content, "base64").toString(),
    /day,projectViews,releaseViews/,
  );
});

test("release export worker creates a valid PDF artifact from public snapshot fields only", async () => {
  let completed: any;
  const processor = createAnalyticsExportProcessor({
    complete: async (_id, artifact) => {
      completed = artifact;
    },
    fail: async () => undefined,
  });
  await processor({
    data: {
      exportId: "export-2",
      kind: "RELEASE_PDF",
      filename: "release.pdf",
      snapshot: {
        projectName: "Widget",
        version: "1.2.3",
        title: "Public release",
        summary: "Public summary",
        publishedAt: "2026-11-01T00:00:00.000Z",
        changes: [
          {
            title: "Feature",
            category: "FEATURE",
            description: "Public details",
          },
        ],
      },
    },
  });
  const pdf = Buffer.from(completed.content, "base64").toString("binary");
  assert.equal(completed.contentType, "application/pdf");
  assert.ok(pdf.startsWith("%PDF-1.4"));
  assert.match(pdf, /Public release/);
  assert.doesNotMatch(pdf, /internal|secret/i);
});

test("worker records a safe failure code and rethrows for BullMQ retry", async () => {
  let failure: any;
  const processor = createAnalyticsExportProcessor({
    complete: async () => undefined,
    fail: async (...args) => {
      failure = args;
    },
  });
  await assert.rejects(
    processor({
      data: { exportId: "export-3", filename: "broken", kind: "unknown" },
      opts: { attempts: 1 },
    }),
  );
  assert.deepEqual(failure, ["export-3", "INVALID_EXPORT_DATA"]);
});

test("transient artifact delivery retries without marking the export failed", async () => {
  let deliveries = 0;
  let failures = 0;
  const processor = createAnalyticsExportProcessor({
    complete: async () => {
      deliveries += 1;
      if (deliveries === 1) throw new Error("temporary API outage");
    },
    fail: async () => {
      failures += 1;
    },
  });
  const job = {
    data: {
      exportId: "export-4",
      kind: "ANALYTICS_CSV",
      filename: "analytics.csv",
      rows: [],
    },
    opts: { attempts: 2 },
  };
  await assert.rejects(processor({ ...job, attemptsMade: 0 }));
  assert.equal(failures, 0);
  await processor({ ...job, attemptsMade: 1 });
  assert.equal(deliveries, 2);
  assert.equal(failures, 0);
  assert.equal(ANALYTICS_EXPORT_JOB_DEFAULTS.attempts, 5);
  assert.equal(ANALYTICS_EXPORT_JOB_DEFAULTS.backoff.type, "exponential");
});
