export type SearchHit = {
  type: string;
  id: string;
  title?: string;
  name?: string;
  slug?: string;
  version?: string;
  description?: string;
  snippet?: string;
  section?: string;
  projectId?: string;
  projectName?: string;
  projectSlug?: string;
  releaseId?: string;
  project?: { id?: string; name?: string; slug?: string };
  release?: { id?: string; version?: string; title?: string };
};

export type NormalizedSearchResponse = {
  items: SearchHit[];
  page: number;
  pageSize: number;
  total: number;
  pageCount?: number;
};

type SearchPayload = {
  items?: unknown;
  results?: unknown;
  hits?: unknown;
  projects?: unknown;
  releases?: unknown;
  changes?: unknown;
  page?: unknown;
  pageSize?: unknown;
  total?: unknown;
  pageCount?: unknown;
};

function asHits(value: unknown, defaultType?: string): SearchHit[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : "";
    if (!id) return [];
    const type = String(
      record.type ??
        record.kind ??
        record.entityType ??
        defaultType ??
        "unknown",
    ).toLowerCase();
    return [{ ...record, id, type } as SearchHit];
  });
}

function positiveInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

export function normalizeSearchResponse(
  input: unknown,
): NormalizedSearchResponse {
  if (Array.isArray(input)) {
    const items = asHits(input);
    return {
      items,
      page: 1,
      pageSize: items.length || 20,
      total: items.length,
    };
  }
  const payload =
    input && typeof input === "object" ? (input as SearchPayload) : {};
  const flat = asHits(payload.items ?? payload.results ?? payload.hits);
  const items = flat.length
    ? flat
    : [
        ...asHits(payload.projects, "project"),
        ...asHits(payload.releases, "release"),
        ...asHits(payload.changes, "change"),
      ];
  return {
    items,
    page: positiveInteger(payload.page, 1),
    pageSize: positiveInteger(payload.pageSize, 20),
    total:
      typeof payload.total === "number" &&
      Number.isInteger(payload.total) &&
      payload.total >= 0
        ? payload.total
        : items.length,
    pageCount: positiveInteger(
      payload.pageCount,
      Math.max(
        1,
        Math.ceil(
          (typeof payload.total === "number" && payload.total >= 0
            ? payload.total
            : items.length) / positiveInteger(payload.pageSize, 20),
        ),
      ),
    ),
  };
}

export function searchResultPath(hit: Partial<SearchHit>): string | null {
  const type = (hit.type ?? "").toLowerCase();
  const projectId = hit.projectId ?? hit.project?.id;
  if (type === "project")
    return hit.id ? `projects/${encodeURIComponent(hit.id)}` : null;
  if (
    (type === "release" || type === "change" || type === "document") &&
    projectId
  ) {
    const releaseId =
      type === "release" ? hit.id : (hit.releaseId ?? hit.release?.id);
    if (releaseId)
      return `projects/${encodeURIComponent(projectId)}/releases/${encodeURIComponent(releaseId)}`;
  }
  return null;
}
