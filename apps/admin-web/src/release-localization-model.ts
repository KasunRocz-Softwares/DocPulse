function canonicalLocale(value: string): string | null {
  try {
    const [locale] = Intl.getCanonicalLocales(
      value.trim().replaceAll("_", "-"),
    );
    return locale && locale.length <= 255 ? locale : null;
  } catch {
    return null;
  }
}

export function translationLocales(
  defaultLocale: string,
  savedLocales: readonly string[] = [],
): string[] {
  const canonicalDefault = canonicalLocale(defaultLocale) ?? "en";
  const locales = new Map<string, string>();
  for (const raw of ["si-LK", "ta-LK", "en", ...savedLocales]) {
    const locale = canonicalLocale(raw);
    if (locale && locale.toLowerCase() !== canonicalDefault.toLowerCase())
      locales.set(locale.toLowerCase(), locale);
  }
  return [...locales.values()];
}

export function initialTranslationLocale(
  defaultLocale: string,
  savedLocales: readonly string[] = [],
): string {
  const canonicalDefault = canonicalLocale(defaultLocale) ?? "en";
  const saved = savedLocales
    .map(canonicalLocale)
    .find(
      (locale) =>
        locale && locale.toLowerCase() !== canonicalDefault.toLowerCase(),
    );
  return saved ?? translationLocales(defaultLocale, savedLocales)[0] ?? "en";
}
