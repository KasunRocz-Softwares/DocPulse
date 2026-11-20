import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);

test("shared config exposes applyEnvironment to CommonJS services", () => {
  const config = require("@rdps/config");
  assert.equal(typeof config.applyEnvironment, "function");
});
