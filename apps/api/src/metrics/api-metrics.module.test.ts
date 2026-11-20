import * as assert from "node:assert/strict";
import "reflect-metadata";
import { afterEach, test } from "node:test";
import { RequestMethod, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ApiMetricsModule, ApiMetricsRegistry } from "./api-metrics.module";

const applications: INestApplication[] = [];

test("request metrics aggregate route templates and render Prometheus histograms", () => {
  const metrics = new ApiMetricsRegistry();
  metrics.observe("GET", "/api/v1/projects/:projectId", 200, 0.12);
  metrics.observe("GET", "/api/v1/projects/:projectId", 503, 0.72);

  const exposition = metrics.render();
  assert.match(
    exposition,
    /rdps_http_requests_total\{method="GET",route="\/api\/v1\/projects\/:projectId",status_code="200"\} 1/,
  );
  assert.match(
    exposition,
    /rdps_http_request_duration_seconds_count\{method="GET",route="\/api\/v1\/projects\/:projectId"\} 2/,
  );
  assert.match(
    exposition,
    /rdps_http_request_duration_seconds_bucket\{method="GET",route="\/api\/v1\/projects\/:projectId",le="0.5"\} 1/,
  );
  assert.doesNotMatch(exposition, /project-secret-id/);
});

test("metrics endpoint serves Prometheus text exposition over HTTP", async () => {
  const module = await Test.createTestingModule({
    imports: [ApiMetricsModule],
  }).compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix("api/v1", {
    exclude: [{ path: "metrics", method: RequestMethod.GET }],
  });
  await app.listen(0, "127.0.0.1");
  applications.push(app);
  const url = `${await app.getUrl()}/metrics`;

  await fetch(url);
  const response = await fetch(url);
  const exposition = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/plain/);
  assert.match(
    exposition,
    /rdps_http_requests_total\{method="GET",route="\/api\/v1\/metrics",status_code="200"\} 1/,
  );
  assert.match(exposition, /rdps_process_resident_memory_bytes/);
});

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
});
