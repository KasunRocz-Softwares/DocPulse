import assert from "node:assert/strict";
import test from "node:test";
import { customDomainPath } from "./custom-domain-routing.ts";

test("maps the custom-domain root to its project's public profile", () => {
  assert.equal(customDomainPath("rdps-demo", "/", ""), "/projects/rdps-demo");
});

test("maps history, changelog, search, and release URLs to project routes", () => {
  assert.equal(
    customDomainPath("rdps-demo", "/releases", ""),
    "/projects/rdps-demo/releases",
  );
  assert.equal(
    customDomainPath("rdps-demo", "/changelog", ""),
    "/projects/rdps-demo/changelog",
  );
  assert.equal(
    customDomainPath("rdps-demo", "/search", "?q=security"),
    "/projects/rdps-demo/search?q=security",
  );
  assert.equal(
    customDomainPath("rdps-demo", "/releases/v2.4.0", ""),
    "/projects/rdps-demo/releases/v2.4.0",
  );
});

test("keeps custom-domain routes within the mapped project", () => {
  assert.equal(
    customDomainPath("rdps-demo", "/projects/other", ""),
    "/projects/rdps-demo",
  );
  assert.equal(
    customDomainPath("rdps-demo", "/projects/rdps-demo/releases/v2.4.0", ""),
    "/projects/rdps-demo/releases/v2.4.0",
  );
});

test("maps malformed encoded paths safely to the mapped project", () => {
  assert.equal(
    customDomainPath("rdps-demo", "/releases/%E0%A4%A", ""),
    "/projects/rdps-demo",
  );
});
