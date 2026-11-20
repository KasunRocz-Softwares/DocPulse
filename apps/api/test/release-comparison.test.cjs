const assert = require("node:assert/strict");
const { test } = require("node:test");
const { compareReleaseChanges } = require("../src/releases/release-comparison");

test("release comparison classifies additions, removals and edits by linked reference", () => {
  const oldChanges = [
    {
      title: "Updated catalog",
      category: "FEATURE",
      internalDescription: "Old internal notes",
      publicDescription: "Old public notes",
      visibility: "PUBLIC_CANDIDATE",
      sortOrder: 0,
      references: [{ repository: "acme/store", kind: "PR", externalId: "18" }],
    },
    {
      title: "Removed cache fix",
      category: "FIX",
      internalDescription: "Removed",
      publicDescription: null,
      visibility: "INTERNAL_ONLY",
      sortOrder: 1,
      references: [{ repository: "acme/store", kind: "PR", externalId: "19" }],
    },
  ];
  const newChanges = [
    {
      title: "Catalog improvements",
      category: "FEATURE",
      internalDescription: "New internal notes",
      publicDescription: "New public notes",
      visibility: "PUBLIC_CANDIDATE",
      sortOrder: 0,
      references: [{ repository: "acme/store", kind: "PR", externalId: "18" }],
    },
    {
      title: "CSV export",
      category: "IMPROVEMENT",
      internalDescription: "New export",
      publicDescription: "Export lists",
      visibility: "PUBLIC_CANDIDATE",
      sortOrder: 1,
      references: [{ repository: "acme/store", kind: "PR", externalId: "20" }],
    },
  ];

  const diff = compareReleaseChanges(oldChanges, newChanges);

  assert.deepEqual(
    diff.added.map((change) => change.title),
    ["CSV export"],
  );
  assert.deepEqual(
    diff.removed.map((change) => change.title),
    ["Removed cache fix"],
  );
  assert.deepEqual(
    diff.updated.map(({ before, after }) => [before.title, after.title]),
    [["Updated catalog", "Catalog improvements"]],
  );
});

test("release comparison falls back to normalized title and category without references", () => {
  const base = {
    title: "  Login fix ",
    category: "FIX",
    internalDescription: "Details",
    publicDescription: null,
    visibility: "INTERNAL_ONLY",
    sortOrder: 0,
    references: [],
  };

  const diff = compareReleaseChanges([base], [{ ...base, title: "Login fix" }]);

  assert.deepEqual(diff, { added: [], removed: [], updated: [] });
});
