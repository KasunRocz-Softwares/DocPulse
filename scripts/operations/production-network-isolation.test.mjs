import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const repositoryRoot = new URL("../../", import.meta.url);

test("production ingress edge is isolated to the web proxy", async () => {
  const compose = await readFile(
    new URL("docker-compose.production.yml", repositoryRoot),
    "utf8",
  );
  const apiStart = compose.indexOf("  api:\n");
  const apiEnd = compose.indexOf("\n  worker:\n", apiStart);
  const apiService = compose.slice(apiStart, apiEnd);
  const webStart = compose.indexOf("  web:\n");
  const webEnd = compose.indexOf("\n  prometheus:\n", webStart);
  const webService = compose.slice(webStart, webEnd);
  const blackboxStart = compose.indexOf("  blackbox-exporter:\n");
  const blackboxEnd = compose.indexOf("\n  node-exporter:\n", blackboxStart);
  const blackboxService = compose.slice(blackboxStart, blackboxEnd);

  assert.notEqual(apiStart, -1, "production API service is defined");
  assert.notEqual(apiEnd, -1, "production API service has a clear boundary");
  assert.match(apiService, /networks: \[private, monitoring, egress\]/);
  assert.doesNotMatch(apiService, /networks: \[[^\]]*\bedge\b/);
  assert.match(webService, /networks: \[private, edge, monitoring\]/);
  assert.match(blackboxService, /networks: \[monitoring, private, egress\]/);
  assert.doesNotMatch(blackboxService, /networks: \[[^\]]*\bedge\b/);
});
