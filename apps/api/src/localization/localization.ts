import { BadRequestException } from "@nestjs/common";

export function canonicalizeLocale(value: string): string {
  const trimmed = value.trim().replaceAll("_", "-");
  if (trimmed.length < 2 || trimmed.length > 255)
    throw new BadRequestException("Locale must be a valid BCP 47 tag");
  try {
    const [canonical] = Intl.getCanonicalLocales(trimmed);
    if (!canonical || canonical.length > 255) throw new Error("invalid locale");
    return canonical;
  } catch {
    throw new BadRequestException("Locale must be a valid BCP 47 tag");
  }
}

export function resolvePublicLocale(
  requestedLocale: string | undefined,
  defaultLocale: string,
  availableLocales: string[],
) {
  const fallback = canonicalizeLocale(defaultLocale);
  if (!requestedLocale) return fallback;
  const requested = canonicalizeLocale(requestedLocale);
  const available = new Map(
    availableLocales.map((locale) => [locale.toLowerCase(), locale]),
  );
  const exact = available.get(requested.toLowerCase());
  if (exact) return exact;
  const language = requested.split("-")[0]?.toLowerCase();
  const languageMatch = [...available.entries()].find(
    ([candidate]) => candidate.split("-")[0] === language,
  )?.[1];
  return languageMatch ?? fallback;
}
