import assert from "node:assert/strict";
import test from "node:test";
import {
  integrationReferenceLabel,
  integrationSuggestionDate,
} from "./integration-suggestions-model.ts";

test("labels supported integration suggestion reference kinds", () => {
  assert.equal(
    integrationReferenceLabel({
      referenceKind: "pull_request",
      externalId: "42",
      revision: null,
    }),
    "Pull request #42",
  );
  assert.equal(
    integrationReferenceLabel({
      referenceKind: "issue",
      externalId: "12",
      revision: null,
    }),
    "Issue #12",
  );
  assert.equal(
    integrationReferenceLabel({
      referenceKind: "commit",
      externalId: "abcdef1234567890",
      revision: "1234567890abcdef",
    }),
    "Commit 1234567890ab",
  );
  assert.equal(
    integrationReferenceLabel({
      referenceKind: "tag",
      externalId: "v2.4.0",
      revision: null,
    }),
    "Tag v2.4.0",
  );
});

test("formats valid timestamps and gives malformed values a safe label", () => {
  assert.notEqual(
    integrationSuggestionDate("2026-11-10T12:00:00.000Z"),
    "Date unavailable",
  );
  assert.equal(integrationSuggestionDate("not-a-date"), "Date unavailable");
});
