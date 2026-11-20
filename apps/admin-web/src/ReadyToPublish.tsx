import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { ApiError } from "./api-client";
import { publicSiteUrl } from "./PublicPageDesigner";

type ReadyRevision = {
  id: string;
  revision: number;
  releaseId: string;
  createdAt: string;
  release: {
    id: string;
    version: string;
    title: string;
    projectId: string;
    project: { name: string; slug: string };
  };
  decisions: Array<{ id: string; createdAt: string; comment?: string | null }>;
};

function messageFor(error: unknown) {
  if (error instanceof ApiError && error.status === 403)
    return "Only project Admins and Release managers can publish.";
  return error instanceof Error ? error.message : "Publishing failed.";
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/**
 * Approved revisions waiting to go live, with a one-click Publish. The API
 * only returns revisions in projects where the viewer may publish, so the
 * panel renders nothing for other roles.
 */
export function ReadyToPublish({
  releaseId,
  compact = false,
  onPublished,
}: {
  releaseId?: string;
  compact?: boolean;
  onPublished?: () => void | Promise<void>;
}) {
  const [items, setItems] = useState<ReadyRevision[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [published, setPublished] = useState<{
    label: string;
    url: string;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.request<ReadyRevision[]>(
        "/internal/approval-revisions/ready-to-publish",
      );
      setItems(
        releaseId
          ? result.filter((item) => item.releaseId === releaseId)
          : result,
      );
    } catch {
      setItems([]);
    } finally {
      setLoaded(true);
    }
  }, [releaseId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function publish(item: ReadyRevision) {
    setWorking(item.id);
    setError("");
    setPublished(null);
    try {
      await api.request(
        `/internal/releases/${encodeURIComponent(item.releaseId)}/approval-revisions/${encodeURIComponent(item.id)}/publish`,
        { method: "POST" },
      );
      setPublished({
        label: `${item.release.project.name} ${item.release.version} is live.`,
        url: `${publicSiteUrl()}/projects/${encodeURIComponent(item.release.project.slug)}/releases/${encodeURIComponent(item.release.version)}`,
      });
      await load();
      await onPublished?.();
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setWorking("");
    }
  }

  if (!loaded || (items.length === 0 && !published && !error)) return null;

  return (
    <section
      className={`ready-publish${compact ? " ready-publish-compact" : ""}`}
      aria-labelledby={`ready-publish-${releaseId ?? "all"}`}
    >
      <div className="ready-publish-head">
        <h2 id={`ready-publish-${releaseId ?? "all"}`}>
          <span className="ready-publish-dot" aria-hidden="true" />
          Ready to publish
        </h2>
        {!compact && (
          <p>
            Approved by a second person and frozen. Publishing makes exactly
            this content public.
          </p>
        )}
      </div>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {published && (
        <p className="notice notice-success" role="status">
          {published.label}{" "}
          <a href={published.url} target="_blank" rel="noreferrer">
            View public page ↗
          </a>
        </p>
      )}
      {items.length > 0 && (
        <ul className="ready-publish-list">
          {items.map((item) => (
            <li key={item.id}>
              <div>
                {!compact && (
                  <span className="type-label">
                    {item.release.project.name}
                  </span>
                )}
                <strong>
                  {item.release.version} · {item.release.title}
                </strong>
                <small>
                  Revision {item.revision}
                  {item.decisions[0]
                    ? ` · approved ${dateLabel(item.decisions[0].createdAt)}`
                    : ""}
                </small>
              </div>
              <button
                type="button"
                className="button button-primary"
                disabled={working !== ""}
                onClick={() => void publish(item)}
              >
                {working === item.id
                  ? "Publishing…"
                  : `Publish ${item.release.version}`}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
