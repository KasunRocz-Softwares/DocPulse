import test from "node:test";
import assert from "node:assert/strict";
import { getLocaleCatalog, normalizeLocale, translate } from "./i18n.ts";

test("normalizes supported locale tags and falls back to English", () => {
  assert.equal(normalizeLocale("si"), "si-LK");
  assert.equal(normalizeLocale("SI-lk"), "si-LK");
  assert.equal(normalizeLocale("ta_lk"), "ta-LK");
  assert.equal(normalizeLocale("fr-CA"), "en");
  assert.equal(normalizeLocale(undefined), "en");
});

test("uses Sinhala and Tamil catalogs with English fallback for missing keys", () => {
  assert.equal(getLocaleCatalog("si-LK").search, "සොයන්න");
  assert.equal(getLocaleCatalog("ta-LK").search, "தேடு");
  assert.equal(translate("fr", "search"), "Search");
  assert.equal(translate("si", "missing-key"), "missing-key");
});

test("provides complete interface catalogs for supported locales", () => {
  const englishKeys = Object.keys(getLocaleCatalog("en")).sort();
  assert.deepEqual(Object.keys(getLocaleCatalog("si-LK")).sort(), englishKeys);
  assert.deepEqual(Object.keys(getLocaleCatalog("ta-LK")).sort(), englishKeys);
});

test("preserves any valid BCP 47 content locale and exposes catalog plus published locales", async () => {
  const { contentLocaleOptions, normalizeContentLocale } =
    await import("./i18n.ts");
  assert.equal(normalizeContentLocale("de_de"), "de-DE");
  assert.equal(normalizeContentLocale("fr-CA"), "fr-CA");
  assert.equal(
    normalizeContentLocale("zh-Hant-TW-u-nu-hanidec"),
    "zh-Hant-TW-u-nu-hanidec",
  );
  assert.equal(normalizeContentLocale("not a locale"), "en");
  assert.deepEqual(contentLocaleOptions(["de-DE", "si-LK", "fr-CA"], "fr-CA"), [
    "en",
    "si-LK",
    "ta-LK",
    "de-DE",
    "fr-CA",
  ]);
});

test("public page widget phrases are translated, not English fallbacks", () => {
  for (const key of ["recentReleases", "releasedOn", "pageNotFoundHeading"]) {
    assert.notEqual(translate("si-LK", key), translate("en", key));
    assert.notEqual(translate("ta-LK", key), translate("en", key));
  }
  assert.equal(translate("si-LK", "recentReleases"), "මෑත නිකුතු");
  assert.equal(translate("fr", "releasedOn"), "Released");
});
