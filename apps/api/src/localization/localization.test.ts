import * as assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalizeLocale, resolvePublicLocale } from "./localization";

test("canonicalizes valid locale tags and rejects malformed tags", () => {
  assert.equal(canonicalizeLocale("si_lk"), "si-LK");
  assert.equal(
    canonicalizeLocale("zh-Hant-TW-u-nu-hanidec"),
    "zh-Hant-TW-u-nu-hanidec",
  );
  assert.throws(() => canonicalizeLocale("not a locale"), /BCP 47/);
});

test("uses requested locale only when the immutable publication contains it", () => {
  assert.equal(resolvePublicLocale("si-lk", "en", ["en", "si-LK"]), "si-LK");
  assert.equal(resolvePublicLocale("en-US", "si-LK", ["en", "si-LK"]), "en");
  assert.equal(resolvePublicLocale("fr-FR", "en", ["en", "si-LK"]), "en");
  assert.equal(resolvePublicLocale(undefined, "en", ["en"]), "en");
});
