import { useCallback, useEffect, useState } from "react";
import { adminApi } from "./api";
import {
  integrationReferenceLabel,
  integrationSuggestionDate,
} from "./integration-suggestions-model";

type IntegrationSuggestion = {
  id: string;
  repository: string;
  referenceKind: string;
  externalId: string;
  revision: string | null;
  action: string;
  status: string;
  createdAt: string;
};

type ProjectRelease = {
  id: string;
  version: string;
  title: string;
  status: string;
};

function messageFor(error: unknown) {
  if (!(error instanceof Error))
    return "The integration suggestions could not be updated.";
  const status = (error as Error & { status?: number }).status;
  if (status === 401) return "Your session expired. Sign in and try again.";
  if (status === 403)
    return "Your project role cannot perform that review action.";
  if (status === 409)
    return "This suggestion was already reviewed. Refresh to see the latest list.";
  return error.message;
}

/** Project-scoped review workflow for integration suggestions. */
export function IntegrationSuggestionsPanel({
  projectId,
}: {
  projectId: string;
}) {
  const [suggestions, setSuggestions] = useState<IntegrationSuggestion[]>([]);
  const [releases, setReleases] = useState<ProjectRelease[]>([]);
  const [selectedReleases, setSelectedReleases] = useState<
    Record<string, string>
  >({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [releaseError, setReleaseError] = useState("");
  const [notice, setNotice] = useState("");
  const [workingId, setWorkingId] = useState("");

  const load = useCallback(async () => {
    setError("");
    setRefreshing(true);
    const [suggestionResult, releaseResult] = await Promise.allSettled([
      adminApi.listIntegrationSuggestions<IntegrationSuggestion[]>(
        projectId,
        250,
      ),
      adminApi.listProjectReleases<ProjectRelease[]>(projectId),
    ]);

    if (suggestionResult.status === "rejected") {
      setError(messageFor(suggestionResult.reason));
    } else {
      setSuggestions(suggestionResult.value);
      setSelectedReleases((current) => {
        const next = { ...current };
        for (const suggestion of suggestionResult.value) {
          if (releaseResult.status === "fulfilled") {
            const selected = next[suggestion.id];
            const stillAvailable = releaseResult.value.some(
              (release) => release.id === selected,
            );
            if (!stillAvailable)
              next[suggestion.id] = releaseResult.value[0]?.id ?? "";
          }
        }
        return next;
      });
    }

    if (releaseResult.status === "fulfilled") {
      setReleases(releaseResult.value);
      setReleaseError("");
    } else {
      setReleases([]);
      setReleaseError(messageFor(releaseResult.reason));
    }

    setLoading(false);
    setRefreshing(false);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(
    suggestion: IntegrationSuggestion,
    action: "accept" | "dismiss",
  ) {
    setWorkingId(suggestion.id);
    setError("");
    setNotice("");
    try {
      if (action === "accept") {
        const releaseId = selectedReleases[suggestion.id];
        if (!releaseId) {
          setError("Choose a release before accepting this suggestion.");
          return;
        }
        await adminApi.acceptIntegrationSuggestion(
          projectId,
          suggestion.id,
          releaseId,
        );
        setNotice(`${integrationReferenceLabel(suggestion)} accepted.`);
      } else {
        await adminApi.dismissIntegrationSuggestion(projectId, suggestion.id);
        setNotice(`${integrationReferenceLabel(suggestion)} dismissed.`);
      }
      await load();
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setWorkingId("");
    }
  }

  return (
    <section
      className="integration-suggestions-panel admin-subsection"
      aria-labelledby="integration-suggestions-title"
    >
      <header className="integration-suggestions-heading">
        <div>
          <h3 id="integration-suggestions-title">Integration suggestions</h3>
          <p>
            Review GitHub references inferred from project webhook activity.
          </p>
        </div>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void load()}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {error && (
        <p role="alert" className="integration-suggestions-alert">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="integration-suggestions-notice">
          {notice}
        </p>
      )}
      {releaseError && (
        <p role="alert" className="integration-suggestions-alert">
          Releases could not be loaded: {releaseError}
        </p>
      )}

      <p className="integration-suggestions-permissions">
        Accept requires Admin, Release Manager, or Developer access. Dismiss
        requires Admin or Release Manager access.
      </p>
      {suggestions.length === 250 && (
        <p className="integration-suggestions-permissions" role="note">
          Showing the latest 250 pending suggestions. Review these to surface
          older pending items.
        </p>
      )}

      {loading ? (
        <p role="status">Loading pending suggestions…</p>
      ) : suggestions.length === 0 ? (
        <p
          className="integration-suggestions-empty"
          role={error ? "status" : undefined}
        >
          {error
            ? "Suggestions are unavailable. Refresh to try again."
            : "No pending integration suggestions for this project."}
        </p>
      ) : (
        <ul className="integration-suggestion-list">
          {suggestions.map((suggestion) => {
            const label = integrationReferenceLabel(suggestion);
            const busy = workingId === suggestion.id;
            return (
              <li className="integration-suggestion-row" key={suggestion.id}>
                <div className="integration-suggestion-details">
                  <strong>{label}</strong>
                  <span>{suggestion.repository}</span>
                  <small>
                    {suggestion.action.replaceAll("_", " ")} ·{" "}
                    {suggestion.status.toLowerCase()} ·{" "}
                    {integrationSuggestionDate(suggestion.createdAt)}
                  </small>
                  {suggestion.revision && (
                    <code title={suggestion.revision}>
                      {suggestion.revision}
                    </code>
                  )}
                </div>
                <div className="integration-suggestion-actions">
                  <label className="integration-suggestion-release">
                    <span>Attach to release</span>
                    <select
                      aria-label={`Release for ${label}`}
                      value={selectedReleases[suggestion.id] ?? ""}
                      onChange={(event) =>
                        setSelectedReleases((current) => ({
                          ...current,
                          [suggestion.id]: event.target.value,
                        }))
                      }
                      disabled={busy || releases.length === 0}
                    >
                      <option value="">
                        {releases.length
                          ? "Choose a release"
                          : "No releases available"}
                      </option>
                      {releases.map((release) => (
                        <option key={release.id} value={release.id}>
                          {release.version} · {release.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => void review(suggestion, "accept")}
                    disabled={busy || releases.length === 0}
                  >
                    {busy ? "Saving…" : "Accept"}
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => void review(suggestion, "dismiss")}
                    disabled={busy}
                  >
                    Dismiss
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
