import assert from "node:assert/strict";
import test from "node:test";
import { createAdminApi } from "./admin-api.ts";

test("analytics and export client methods stay scoped to the selected project", async () => {
  const calls = [];
  const api = createAdminApi({
    request: async (path, options = {}) => {
      calls.push({ path, ...options });
      return {};
    },
    download: async (path) => {
      calls.push({ path, download: true });
      return { blob: new Blob(), filename: "report.csv" };
    },
  });
  await api.getAnalytics("project/1", 90);
  await api.createAnalyticsExport("project/1", {
    kind: "ANALYTICS_CSV",
    days: 90,
  });
  await api.createAnalyticsExport("project/1", {
    kind: "RELEASE_PDF",
    releaseId: "release/2",
  });
  await api.listAnalyticsExports("project/1");
  await api.downloadAnalyticsExport("project/1", "export/3");
  assert.deepEqual(calls, [
    { path: "/internal/projects/project%2F1/analytics?days=90" },
    {
      path: "/internal/projects/project%2F1/analytics/exports",
      method: "POST",
      body: { kind: "ANALYTICS_CSV", days: 90 },
    },
    {
      path: "/internal/projects/project%2F1/analytics/exports",
      method: "POST",
      body: { kind: "RELEASE_PDF", releaseId: "release/2" },
    },
    { path: "/internal/projects/project%2F1/analytics/exports" },
    {
      path: "/internal/projects/project%2F1/analytics/exports/export%2F3/download",
      download: true,
    },
  ]);
});
