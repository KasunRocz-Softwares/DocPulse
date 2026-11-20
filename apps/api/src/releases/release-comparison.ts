export type ComparableReleaseChange = {
  title: string;
  category: string;
  internalDescription: string;
  publicDescription: string | null;
  visibility: string;
  sortOrder: number;
  references?: Array<{
    repository: string;
    kind: string;
    externalId: string;
  }>;
};

export type ReleaseChangeDiff<T extends ComparableReleaseChange> = {
  added: T[];
  removed: T[];
  updated: Array<{ before: T; after: T }>;
};

function identity(change: ComparableReleaseChange): string {
  const references = (change.references ?? [])
    .map((reference) =>
      [reference.repository, reference.kind, reference.externalId]
        .map((part) => part.trim().toLowerCase())
        .join(":"),
    )
    .sort();
  if (references.length) return `reference:${references.join("|")}`;
  return `title:${change.category.toLowerCase()}:${change.title.trim().toLowerCase()}`;
}

function indexByIdentity<T extends ComparableReleaseChange>(
  changes: T[],
): Map<string, T> {
  const occurrences = new Map<string, number>();
  const result = new Map<string, T>();
  for (const change of changes) {
    const base = identity(change);
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    result.set(`${base}#${occurrence}`, change);
  }
  return result;
}

function sameContent(
  before: ComparableReleaseChange,
  after: ComparableReleaseChange,
): boolean {
  return (
    before.title.trim() === after.title.trim() &&
    before.category === after.category &&
    before.internalDescription === after.internalDescription &&
    before.publicDescription === after.publicDescription &&
    before.visibility === after.visibility &&
    before.sortOrder === after.sortOrder
  );
}

export function compareReleaseChanges<T extends ComparableReleaseChange>(
  previous: T[],
  current: T[],
): ReleaseChangeDiff<T> {
  const beforeByKey = indexByIdentity(previous);
  const afterByKey = indexByIdentity(current);
  const added: T[] = [];
  const removed: T[] = [];
  const updated: Array<{ before: T; after: T }> = [];

  for (const [key, before] of beforeByKey) {
    const after = afterByKey.get(key);
    if (!after) removed.push(before);
    else if (!sameContent(before, after)) updated.push({ before, after });
  }
  for (const [key, after] of afterByKey) {
    if (!beforeByKey.has(key)) added.push(after);
  }

  return { added, removed, updated };
}
