import { useEffect, useState } from "react";

type ClientRelease = {
  projectSlug: string;
  projectName: string;
  version: string;
  title: string;
  summary: string | null;
  publishedAt: string;
  changes: Array<{
    title: string;
    category: string;
    description: string;
    sortOrder: number;
  }>;
  attachments: Array<{
    id: string;
    fileName: string;
    contentType: string;
    sizeBytes: string;
    downloadUrl: string;
  }>;
};

type ClientReleaseResponse = {
  audience: { id: string; name: string };
  releases: ClientRelease[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function ClientReleasePortal({
  projectSlug,
  accessToken,
  apiBaseUrl = `${window.location.origin}/api/v1`,
}: {
  projectSlug: string;
  accessToken: string;
  apiBaseUrl?: string;
}) {
  const [data, setData] = useState<ClientReleaseResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setData(null);
    setError("");
    fetch(
      `${apiBaseUrl.replace(/\/+$/, "")}/client/projects/${encodeURIComponent(projectSlug)}/releases?page=${page}&pageSize=20`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        signal: controller.signal,
        credentials: "include",
      },
    )
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            message?: string;
          } | null;
          throw new Error(
            payload?.message ??
              `Could not load client releases (${response.status}).`,
          );
        }
        return response.json() as Promise<ClientReleaseResponse>;
      })
      .then(setData)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load client releases.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectSlug, accessToken, apiBaseUrl, page]);

  async function download(attachment: ClientRelease["attachments"][number]) {
    setDownloadingId(attachment.id);
    setError("");
    try {
      const response = await fetch(
        `${apiBaseUrl.replace(/\/+$/, "")}${attachment.downloadUrl}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          credentials: "include",
        },
      );
      if (!response.ok)
        throw new Error(`Download failed (${response.status}).`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : `Could not download ${attachment.fileName}.`,
      );
    } finally {
      setDownloadingId("");
    }
  }

  if (loading)
    return (
      <main id="main" tabIndex={-1} aria-live="polite">
        <p>Loading your client release notes…</p>
      </main>
    );
  if (error && !data)
    return (
      <main id="main" tabIndex={-1}>
        <p className="error-copy" role="alert">
          {error}
        </p>
      </main>
    );
  if (!data) return null;

  return (
    <main className="client-release-portal" id="main" tabIndex={-1}>
      <header>
        <p>Private client release portal</p>
        <h1>{data.audience.name}</h1>
        <p>Release notes shared with your organization.</p>
      </header>
      {error && (
        <p className="error-copy" role="alert">
          {error}
        </p>
      )}
      {data.releases.length === 0 ? (
        <p>No client releases have been published for this audience yet.</p>
      ) : (
        <section aria-label="Client releases">
          {data.releases.map((release) => (
            <article
              className="release-card"
              key={`${release.version}-${release.publishedAt}`}
            >
              <header>
                <p>
                  {release.version} · {formatDate(release.publishedAt)}
                </p>
                <h2>{release.title}</h2>
              </header>
              {release.summary && <p>{release.summary}</p>}
              <ul>
                {release.changes.map((change, index) => (
                  <li key={`${change.sortOrder}-${index}`}>
                    <strong>{change.title}</strong>
                    <span>{change.category.replaceAll("_", " ")}</span>
                    <p>{change.description}</p>
                  </li>
                ))}
              </ul>
              {release.attachments.length > 0 && (
                <section aria-label={`Attachments for ${release.version}`}>
                  <h3>Attachments</h3>
                  <ul>
                    {release.attachments.map((attachment) => (
                      <li key={attachment.id}>
                        <button
                          type="button"
                          className="button button-secondary"
                          disabled={downloadingId === attachment.id}
                          onClick={() => void download(attachment)}
                        >
                          {downloadingId === attachment.id
                            ? "Downloading…"
                            : `Download ${attachment.fileName}`}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </article>
          ))}
        </section>
      )}
      {data.pagination.totalPages > 1 && (
        <nav className="pagination" aria-label="Client release pages">
          <button
            type="button"
            className="button button-secondary"
            disabled={loading || data.pagination.page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </button>
          <span aria-live="polite">
            Page {data.pagination.page} of {data.pagination.totalPages}
          </span>
          <button
            type="button"
            className="button button-secondary"
            disabled={
              loading || data.pagination.page >= data.pagination.totalPages
            }
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </button>
        </nav>
      )}
    </main>
  );
}
