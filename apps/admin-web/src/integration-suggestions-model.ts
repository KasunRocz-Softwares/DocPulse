export type IntegrationSuggestionReference = {
  referenceKind: string;
  externalId: string;
  revision: string | null;
};

export function integrationReferenceLabel(
  suggestion: IntegrationSuggestionReference,
) {
  switch (suggestion.referenceKind) {
    case "pull_request":
      return `Pull request #${suggestion.externalId}`;
    case "issue":
      return `Issue #${suggestion.externalId}`;
    case "commit":
      return `Commit ${(suggestion.revision || suggestion.externalId).slice(0, 12)}`;
    case "tag":
      return `Tag ${suggestion.externalId}`;
    default:
      return `${suggestion.referenceKind.replaceAll("_", " ")} · ${suggestion.externalId}`;
  }
}

export function integrationSuggestionDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Date unavailable"
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}
