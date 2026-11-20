export function customDomainPath(
  projectSlug: string,
  pathname: string,
  search: string,
): string {
  let parts: string[];
  try {
    parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return `/projects/${encodeURIComponent(projectSlug)}`;
  }
  const base = `/projects/${encodeURIComponent(projectSlug)}`;
  if (parts[0] === "projects") {
    if (parts[1] !== projectSlug) return base;
    return `${base}${parts
      .slice(2)
      .map((part) => `/${encodeURIComponent(part)}`)
      .join("")}${search}`;
  }
  if (!parts.length) return base;
  if (parts[0] === "changelog" && parts.length === 1)
    return `${base}/changelog`;
  if (parts[0] === "search" && parts.length === 1)
    return `${base}/search${search}`;
  if (parts[0] === "releases" && parts.length === 1) return `${base}/releases`;
  if (parts[0] === "releases" && parts.length === 2)
    return `${base}/releases/${encodeURIComponent(parts[1]!)}`;
  return base;
}
