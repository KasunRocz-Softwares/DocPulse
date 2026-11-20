import assert from "node:assert/strict";
import test from "node:test";

import {
  CHANGE_CATEGORIES,
  RELEASE_CHANNELS,
  RELEASE_STATUSES,
} from "../dist/index.js";

test("shared domain vocabularies match the persisted RDPS lifecycle", () => {
  assert.deepEqual(RELEASE_CHANNELS, ["ALPHA", "BETA", "RC", "STABLE"]);
  assert.deepEqual(RELEASE_STATUSES, [
    "DRAFT",
    "REVIEW",
    "APPROVED",
    "PUBLISHED",
    "REJECTED",
    "UNPUBLISHED",
    "CANCELLED",
    "ARCHIVED",
  ]);
  assert.ok(RELEASE_STATUSES.includes("UNPUBLISHED"));
  assert.ok(CHANGE_CATEGORIES.includes("SECURITY"));
});
