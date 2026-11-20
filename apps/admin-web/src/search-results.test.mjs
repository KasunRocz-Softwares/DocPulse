import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSearchResponse, searchResultPath } from "./search-results.ts";

test("normalizes project, release, change, and document navigation hits", () => {
  const result = normalizeSearchResponse({
    items: [
      { type: "project", id: "p/1", name: "Alpha", slug: "alpha" },
      {
        type: "release",
        id: "r/1",
        projectId: "p/1",
        version: "2.0.0",
        title: "Launch",
        projectName: "Alpha",
      },
      {
        type: "change",
        id: "c/1",
        releaseId: "r/1",
        projectId: "p/1",
        title: "Search update",
        projectName: "Alpha",
      },
      {
        type: "document",
        id: "d/1",
        releaseId: "r/1",
        projectId: "p/1",
        title: "Operations guide",
        section: "Deployment",
        projectName: "Alpha",
      },
    ],
    page: 2,
    pageSize: 20,
    total: 41,
    pageCount: 3,
  });

  assert.equal(result.items.length, 4);
  assert.equal(result.total, 41);
  assert.equal(result.pageCount, 3);
  assert.equal(searchResultPath(result.items[0]), "projects/p%2F1");
  assert.equal(
    searchResultPath(result.items[1]),
    "projects/p%2F1/releases/r%2F1",
  );
  assert.equal(
    searchResultPath(result.items[2]),
    "projects/p%2F1/releases/r%2F1",
  );
  assert.equal(
    searchResultPath(result.items[3]),
    "projects/p%2F1/releases/r%2F1",
  );
});

test("normalizes grouped search responses and uses a safe fallback for incomplete hits", () => {
  const result = normalizeSearchResponse({
    projects: [{ id: "p1", name: "Alpha", slug: "alpha" }],
    releases: [{ id: "r1", projectId: "p1", version: "1.0.0", title: "One" }],
    changes: [{ id: "c1", projectId: "p1", releaseId: "r1", title: "Fix" }],
  });
  assert.deepEqual(
    result.items.map((item) => item.type),
    ["project", "release", "change"],
  );
  assert.equal(searchResultPath({ type: "unknown", id: "x" }), null);
});
