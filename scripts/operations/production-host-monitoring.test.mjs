import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const repositoryRoot = new URL("../../", import.meta.url);

test("production monitoring scrapes host resources and alerts on exhaustion", async () => {
  const [compose, prometheus, alerts, smoke, deploy] = await Promise.all([
    readFile(new URL("docker-compose.production.yml", repositoryRoot), "utf8"),
    readFile(
      new URL("scripts/ops/monitoring/prometheus.yml", repositoryRoot),
      "utf8",
    ),
    readFile(
      new URL("scripts/ops/monitoring/alerts.yml", repositoryRoot),
      "utf8",
    ),
    readFile(
      new URL("scripts/ops/production-smoke-check.sh", repositoryRoot),
      "utf8",
    ),
    readFile(
      new URL("scripts/ops/deploy-production.sh", repositoryRoot),
      "utf8",
    ),
  ]);

  const nodeExporterStart = compose.indexOf("  node-exporter:\n");
  const nodeExporterEnd = compose.indexOf("\nvolumes:\n", nodeExporterStart);
  const nodeExporterService = compose.slice(nodeExporterStart, nodeExporterEnd);

  assert.match(compose, /node-exporter:[\s\S]*?NODE_EXPORTER_IMAGE/);
  assert.match(compose, /\/:\/host:ro,rslave/);
  assert.match(nodeExporterService, /read_only: true/);
  assert.match(nodeExporterService, /cap_drop: \[ALL\]/);
  assert.match(nodeExporterService, /networks: \[monitoring\]/);
  assert.match(
    nodeExporterService,
    /--collector\.textfile\.directory=\/host\/var\/lib\/node_exporter\/textfile_collector/,
  );
  assert.doesNotMatch(nodeExporterService, /^\s+ports:/m);
  assert.match(prometheus, /job_name: node-exporter[\s\S]*?node-exporter:9100/);
  assert.match(alerts, /alert: RdpsNodeExporterUnavailable/);
  assert.match(alerts, /alert: RdpsBackupMetricsMissing/);
  assert.match(alerts, /alert: RdpsBackupRunFailed/);
  assert.match(alerts, /alert: RdpsBackupTooOld/);
  assert.match(alerts, /alert: RdpsHostDiskSpaceLow/);
  assert.match(alerts, /alert: RdpsHostMemoryLow/);
  assert.match(alerts, /alert: RdpsHostCpuSaturation/);
  assert.match(smoke, /labels\.job == "node-exporter"/);
  assert.match(deploy, /pull[\s\S]*?node-exporter/);
  assert.match(deploy, /blackbox-exporter node-exporter/);
});

test("production monitoring alerts when expected scrape or probe series disappear", async () => {
  const alerts = await readFile(
    new URL("scripts/ops/monitoring/alerts.yml", repositoryRoot),
    "utf8",
  );

  for (const job of [
    "rdps-api",
    "rdps-api-health",
    "rdps-web-health",
    "postgres-exporter",
    "redis-exporter",
    "node-exporter",
  ]) {
    assert.match(
      alerts,
      new RegExp(`absent\\(up\\{job="${job}"\\}\\)`),
      `expected a missing-target alert for ${job}`,
    );
  }
  assert.match(alerts, /absent\(probe_success\{job="rdps-api-health"\}\)/);
  assert.match(alerts, /absent\(probe_success\{job="rdps-web-health"\}\)/);
});

test("monitoring runbook applies mounted config changes to running services", async () => {
  const runbook = await readFile(
    new URL("scripts/ops/monitoring/README.md", repositoryRoot),
    "utf8",
  );

  assert.match(runbook, /POST \/-\/reload/);
  assert.match(runbook, /--force-recreate[^\n]*prometheus/);
  assert.match(runbook, /--force-recreate[^\n]*blackbox-exporter/);
  assert.match(runbook, /--force-recreate[^\n]*alertmanager/);
  assert.match(runbook, /\/-\/ready/);
  assert.match(runbook, /\/api\/v1\/targets/);
});
