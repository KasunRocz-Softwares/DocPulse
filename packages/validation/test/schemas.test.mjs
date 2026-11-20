import assert from "node:assert/strict";
import test from "node:test";

import {
  createProjectSchema,
  createReleaseSchema,
  paginationQuerySchema,
  semanticVersionSchema,
} from "../dist/index.js";

test("semantic versions follow the SemVer grammar including prerelease identifiers", () => {
  assert.equal(
    semanticVersionSchema.safeParse("2.4.0-rc.1+build.9").success,
    true,
  );
  assert.equal(semanticVersionSchema.safeParse("02.4.0").success, false);
});

test("pagination coerces bounded query strings", () => {
  assert.deepEqual(paginationQuerySchema.parse({}), { page: 1, pageSize: 20 });
  assert.deepEqual(paginationQuerySchema.parse({ page: "3", pageSize: "20" }), {
    page: 3,
    pageSize: 20,
  });
  assert.equal(paginationQuerySchema.safeParse({ page: "0" }).success, false);
  assert.equal(
    paginationQuerySchema.safeParse({ pageSize: "101" }).success,
    false,
  );
});

test("project slugs use the stable lowercase URL-safe form", () => {
  assert.equal(
    createProjectSchema.safeParse({ name: "RDPS", slug: "rdps-release-notes" })
      .success,
    true,
  );
  assert.equal(
    createProjectSchema.safeParse({ name: "RDPS", slug: "Bad Slug" }).success,
    false,
  );
});

test("release input rejects credential-like fields and unknown internal metadata", () => {
  const base = {
    projectId: "57d7e0c2-0193-4a90-85cf-b42cc8cebe8a",
    version: "1.2.0",
    channel: "STABLE",
    type: "MINOR",
    title: "Launch",
  };
  assert.equal(createReleaseSchema.safeParse(base).success, true);
  assert.equal(
    createReleaseSchema.safeParse({ ...base, githubToken: "secret" }).success,
    false,
  );
  assert.equal(
    createReleaseSchema.safeParse({ ...base, passwordHash: "hash" }).success,
    false,
  );
});
