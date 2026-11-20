import assert from "node:assert/strict";
import test from "node:test";
import {
  initialTranslationLocale,
  translationLocales,
} from "./release-localization-model.ts";

test("localization editor never offers the project's primary locale as a translation", () => {
  assert.deepEqual(translationLocales("fr-CA", ["de_de", "fr-ca", "de-DE"]), [
    "si-LK",
    "ta-LK",
    "en",
    "de-DE",
  ]);
});

test("localization editor opens the first saved translation or a valid alternate locale", () => {
  assert.equal(initialTranslationLocale("en", ["fr-CA", "si-LK"]), "fr-CA");
  assert.equal(initialTranslationLocale("si-LK"), "ta-LK");
  assert.equal(
    initialTranslationLocale("en", ["zh-Hant-TW-u-nu-hanidec"]),
    "zh-Hant-TW-u-nu-hanidec",
  );
});
