import { useEffect, useState } from "react";
import { adminApi } from "./api";

type Audience = { id: string; name: string; slug: string };
type AudienceSelection = { mode: "PUBLIC" | "CLIENTS"; audiences: Audience[] };

const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Could not update release visibility.";

export function ClientReleaseAudienceSelector({
  projectId,
  releaseId,
  onSaved,
}: {
  projectId: string;
  releaseId: string;
  onSaved?: () => void;
}) {
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [mode, setMode] = useState<"PUBLIC" | "CLIENTS">("PUBLIC");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      adminApi.listClientAudiences<Audience[]>(projectId),
      adminApi.getReleaseAudience<AudienceSelection>(releaseId),
    ])
      .then(([available, current]) => {
        if (!active) return;
        setAudiences(available);
        setMode(current.mode);
        setSelectedIds(current.audiences.map((audience) => audience.id));
        setError("");
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, releaseId]);

  function toggleAudience(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  }

  async function save() {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      await adminApi.setReleaseAudience(releaseId, {
        mode,
        audienceIds: mode === "CLIENTS" ? selectedIds : [],
      });
      setNotice(
        "Release visibility saved. The approved revision will freeze this audience.",
      );
      onSaved?.();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setWorking(false);
    }
  }

  return (
    <section
      className="admin-subsection"
      aria-labelledby="release-audience-heading"
    >
      <h3 id="release-audience-heading">Release visibility</h3>
      <p>
        Choose whether this release is public or limited to selected client
        audiences.
      </p>
      {error && (
        <p className="error-copy" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success-copy" role="status">
          {notice}
        </p>
      )}
      {loading ? (
        <p aria-live="polite">Loading client audiences…</p>
      ) : (
        <fieldset className="audience-options" disabled={working}>
          <legend>Who can read this release?</legend>
          <label>
            <input
              type="radio"
              name={`audience-mode-${releaseId}`}
              checked={mode === "PUBLIC"}
              onChange={() => setMode("PUBLIC")}
            />
            Everyone on the public release portal
          </label>
          <label>
            <input
              type="radio"
              name={`audience-mode-${releaseId}`}
              checked={mode === "CLIENTS"}
              onChange={() => setMode("CLIENTS")}
            />
            Selected client audiences only
          </label>
          {mode === "CLIENTS" && (
            <div role="group" aria-label="Client audiences">
              {audiences.length === 0 ? (
                <p>
                  Create a client audience before selecting restricted
                  visibility.
                </p>
              ) : (
                audiences.map((audience) => (
                  <label key={audience.id}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(audience.id)}
                      onChange={() => toggleAudience(audience.id)}
                    />
                    {audience.name}
                  </label>
                ))
              )}
            </div>
          )}
        </fieldset>
      )}
      <button
        className="button button-primary"
        type="button"
        onClick={() => void save()}
        disabled={
          loading || working || (mode === "CLIENTS" && selectedIds.length === 0)
        }
      >
        {working ? "Saving…" : "Save visibility"}
      </button>
    </section>
  );
}
