import { FormEvent, useMemo, useState } from "react";
import { adminApi } from "./api";

type Release = {
  id: string;
  version: string;
  title: string;
  type: string;
  channel?: string;
  releaseDate?: string | null;
  internalSummary?: string | null;
  publicSummary?: string | null;
  status: string;
  changes?: Array<{
    id: string;
    title: string;
    category: string;
    internalDescription: string;
    publicDescription?: string | null;
    visibility?: string;
    sortOrder?: number;
  }>;
};
type Diff = {
  added: Array<{ title: string; category: string }>;
  removed: Array<{ title: string; category: string }>;
  updated: Array<{ before: { title: string }; after: { title: string } }>;
};

type ReleaseComparison = {
  changes: Diff;
};

const messageFor = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The request could not be completed.";

export function ReleaseAdminTools({
  projectId,
  release,
  releases,
  onUpdated,
  onArchived,
}: {
  projectId: string;
  release: Release;
  releases: Release[];
  onUpdated: () => Promise<void>;
  onArchived: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [ordered, setOrdered] = useState(release.changes ?? []);
  const [fromId, setFromId] = useState(
    releases.find((item) => item.id !== release.id)?.id ?? release.id,
  );
  const [toId, setToId] = useState(release.id);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [summaryBusy, setSummaryBusy] = useState(false);

  const comparableReleases = useMemo(
    () => [...releases].sort((a, b) => a.version.localeCompare(b.version)),
    [releases],
  );

  async function run(
    action: () => Promise<unknown>,
    success: string,
    afterSuccess?: () => void,
  ) {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      await onUpdated();
      afterSuccess?.();
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setWorking(false);
    }
  }

  async function saveMetadata(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = {
      version: String(form.get("version") ?? "").trim(),
      title: String(form.get("title") ?? "").trim(),
      type: String(form.get("type") ?? "MINOR"),
      channel: String(form.get("channel") ?? "STABLE"),
      releaseDate: String(form.get("releaseDate") ?? "") || null,
      internalSummary: String(form.get("internalSummary") ?? "") || null,
      publicSummary: String(form.get("publicSummary") ?? "") || null,
    };
    await run(
      () => adminApi.updateRelease(release.id, input),
      "Release metadata saved.",
    );
    setEditing(false);
  }

  async function compare() {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const result = await adminApi.compareReleases<ReleaseComparison>(
        projectId,
        fromId,
        toId,
      );
      setDiff(result.changes);
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setWorking(false);
    }
  }

  async function downloadComparison(format: "csv" | "json") {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const result = await adminApi.downloadReleaseComparison(
        projectId,
        fromId,
        toId,
        format,
      );
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename || `release-comparison.${format}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`Comparison downloaded as ${format.toUpperCase()}.`);
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setWorking(false);
    }
  }

  async function suggestSummary(form: HTMLFormElement) {
    setSummaryBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await adminApi.suggestAiSummary<{ summary: string }>(
        release.id,
      );
      const field = form.elements.namedItem("publicSummary");
      if (field instanceof HTMLTextAreaElement) field.value = result.summary;
      setNotice(
        "AI suggestion added to the public summary field. Review and edit it before saving.",
      );
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setSummaryBusy(false);
    }
  }

  function move(index: number, delta: number) {
    setOrdered((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      const currentItem = next[index];
      const targetItem = next[target];
      if (!currentItem || !targetItem) return current;
      next[index] = targetItem;
      next[target] = currentItem;
      return next;
    });
  }

  const originalOrder = (release.changes ?? [])
    .map((item) => item.id)
    .join("|");
  const currentOrder = ordered.map((item) => item.id).join("|");

  return (
    <section
      className="section-block release-admin-tools"
      aria-labelledby="release-admin-heading"
    >
      <div className="section-heading">
        <div>
          <h2 id="release-admin-heading">Release administration</h2>
          <p>Edit metadata, compare versions, and arrange change ordering.</p>
        </div>
      </div>
      <div className="admin-feedback" aria-live="polite">
        {error && <p className="error-copy">{error}</p>}
        {notice && <p className="success-copy">{notice}</p>}
      </div>

      <div className="admin-tool-actions">
        <button
          className="button button-secondary"
          type="button"
          onClick={() => setEditing((value) => !value)}
        >
          {editing ? "Close editor" : "Edit release metadata"}
        </button>
        <button
          className="button button-danger"
          type="button"
          disabled={working || release.status.toUpperCase() === "ARCHIVED"}
          onClick={() => {
            if (
              window.confirm(
                `Archive release ${release.version}? It will remain in the record but will no longer be active.`,
              )
            )
              void run(
                () => adminApi.archiveRelease(release.id),
                "Release archived.",
                onArchived,
              );
          }}
        >
          Archive release
        </button>
      </div>

      {editing && (
        <form className="form-panel compact-form" onSubmit={saveMetadata}>
          <div className="form-grid three">
            <label className="field">
              <span>Version</span>
              <input
                name="version"
                required
                pattern="v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?"
                defaultValue={release.version}
              />
            </label>
            <label className="field">
              <span>Release title</span>
              <input
                name="title"
                required
                minLength={2}
                maxLength={200}
                defaultValue={release.title}
              />
            </label>
            <label className="field">
              <span>Type</span>
              <select name="type" defaultValue={release.type}>
                {["MAJOR", "MINOR", "PATCH", "HOTFIX"].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Channel</span>
              <select name="channel" defaultValue={release.channel ?? "STABLE"}>
                {["ALPHA", "BETA", "RC", "STABLE"].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Release date</span>
              <input
                name="releaseDate"
                type="date"
                defaultValue={release.releaseDate?.slice(0, 10) ?? ""}
              />
            </label>
            <label className="field">
              <span>Internal summary</span>
              <textarea
                name="internalSummary"
                rows={2}
                maxLength={10000}
                defaultValue={release.internalSummary ?? ""}
              />
            </label>
            <label className="field">
              <span>Public summary</span>
              <textarea
                name="publicSummary"
                rows={2}
                maxLength={10000}
                defaultValue={release.publicSummary ?? ""}
              />
              <small>
                AI suggestions use public change descriptions only. Review and
                edit before saving.
              </small>
              <button
                className="button button-secondary"
                type="button"
                disabled={working || summaryBusy}
                onClick={(event) =>
                  void suggestSummary(event.currentTarget.form!)
                }
              >
                {summaryBusy ? "Generating…" : "Suggest with AI"}
              </button>
            </label>
          </div>
          <div className="form-actions">
            <button className="button button-primary" disabled={working}>
              {working ? "Saving…" : "Save release metadata"}
            </button>
          </div>
        </form>
      )}

      <div className="admin-subsection" aria-labelledby="compare-heading">
        <div className="section-heading">
          <div>
            <h3 id="compare-heading">Compare releases</h3>
            <p>Review added, removed, and updated change entries.</p>
          </div>
        </div>
        {comparableReleases.length > 1 ? (
          <div className="comparison-controls">
            <label className="field">
              <span>From release</span>
              <select
                value={fromId}
                onChange={(event) => setFromId(event.target.value)}
              >
                {comparableReleases.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.version} · {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>To release</span>
              <select
                value={toId}
                onChange={(event) => setToId(event.target.value)}
              >
                {comparableReleases.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.version} · {item.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button button-secondary"
              type="button"
              disabled={working || fromId === toId}
              onClick={() => void compare()}
            >
              {working ? "Comparing…" : "Compare"}
            </button>
          </div>
        ) : (
          <p className="inline-empty">
            Create another release to compare change histories.
          </p>
        )}
        {diff && (
          <div className="diff-results" aria-live="polite">
            <h4>Comparison result</h4>
            <div className="admin-tool-actions">
              <button
                className="button button-secondary"
                type="button"
                disabled={working}
                onClick={() => void downloadComparison("csv")}
              >
                Export CSV
              </button>
              <button
                className="button button-secondary"
                type="button"
                disabled={working}
                onClick={() => void downloadComparison("json")}
              >
                Export JSON
              </button>
            </div>
            <p>
              {diff.added.length} added · {diff.removed.length} removed ·{" "}
              {diff.updated.length} updated
            </p>
            {[
              ...[...diff.added].map((item) => ({ kind: "Added", item })),
              ...diff.removed.map((item) => ({ kind: "Removed", item })),
              ...diff.updated.map((pair) => ({
                kind: "Updated",
                item: {
                  title: `${pair.before.title} → ${pair.after.title}`,
                  category: "",
                },
              })),
            ].map(({ kind, item }, index) => (
              <div className="diff-item" key={`${kind}-${item.title}-${index}`}>
                <span>{kind}</span>
                <strong>{item.title}</strong>
                <small>{item.category}</small>
              </div>
            ))}
            {!diff.added.length &&
              !diff.removed.length &&
              !diff.updated.length && <p>No change differences were found.</p>}
          </div>
        )}
      </div>

      <div className="admin-subsection" aria-labelledby="ordering-heading">
        <div className="section-heading">
          <div>
            <h3 id="ordering-heading">Change ordering</h3>
            <p>
              Move items into the published order, then save the full sequence.
            </p>
          </div>
          <button
            className="button button-secondary"
            type="button"
            disabled={
              working || !ordered.length || originalOrder === currentOrder
            }
            onClick={() =>
              void run(
                () =>
                  adminApi.updateChangeOrder(
                    release.id,
                    ordered.map((item, sortOrder) => ({
                      id: item.id,
                      sortOrder,
                    })),
                  ),
                "Change order saved.",
              )
            }
          >
            Save order
          </button>
        </div>
        {ordered.length ? (
          <ol className="order-list">
            {ordered.map((item, index) => (
              <li key={item.id}>
                <span className="order-index">{index + 1}</span>
                <div>
                  <strong>{item.title}</strong>
                  <small>
                    {item.category.replaceAll("_", " ").toLowerCase()}
                  </small>
                </div>
                <div className="order-buttons">
                  <button
                    className="button button-quiet"
                    type="button"
                    aria-label={`Move ${item.title} up`}
                    disabled={working || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    className="button button-quiet"
                    type="button"
                    aria-label={`Move ${item.title} down`}
                    disabled={working || index === ordered.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </button>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="inline-empty">No changes to order.</p>
        )}
      </div>
    </section>
  );
}
