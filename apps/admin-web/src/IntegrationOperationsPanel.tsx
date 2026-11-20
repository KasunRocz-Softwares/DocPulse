import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

export type IntegrationOperationsEvent = {
  id: string;
  provider: string;
  eventType: string;
  status: string;
  attempts: number;
  queueState: string | null;
  errorCode: string | null;
  receivedAt: string;
  completedAt: string | null;
  retryable: boolean;
  retryUnavailableReason: string | null;
};

type Diagnostics = {
  events: IntegrationOperationsEvent[];
  counts: {
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    completed: number;
    errors: number;
    rateLimited: number;
  };
  truncated: boolean;
  scannedJobs: number;
};

const messageFor = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Integration diagnostics could not be loaded.";

const timestamp = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "—";

/** Standalone panel. Mount with <IntegrationOperationsPanel projectId={project.id} />. */
export function IntegrationOperationsPanel({
  projectId,
}: {
  projectId: string;
}) {
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [workingId, setWorkingId] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const result = await api.request<Diagnostics>(
        `/internal/projects/${encodeURIComponent(projectId)}/integration-operations`,
      );
      setDiagnostics(result);
    } catch (requestError) {
      setError(messageFor(requestError));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function retry(eventId: string) {
    setWorkingId(eventId);
    setError("");
    setNotice("");
    try {
      await api.request(
        `/internal/projects/${encodeURIComponent(projectId)}/integration-operations/events/${encodeURIComponent(eventId)}/retry`,
        { method: "POST" },
      );
      setNotice("Retry queued for the retained failed job.");
      await load();
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setWorkingId("");
    }
  }

  return (
    <section
      className="integration-operations-panel"
      aria-labelledby="integration-operations-title"
    >
      <header className="integration-operations-heading">
        <div>
          <p className="eyebrow">INTEGRATIONS</p>
          <h2 id="integration-operations-title">Webhook operations</h2>
          <p>Project-attributed event and retained queue diagnostics.</p>
        </div>
        <button
          type="button"
          className="button-secondary"
          onClick={() => void load()}
        >
          Refresh
        </button>
      </header>

      {error && (
        <p role="alert" className="integration-operations-alert">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="integration-operations-notice">
          {notice}
        </p>
      )}

      <div
        className="integration-operations-counts"
        aria-label="Retained queue counts"
      >
        {(
          [
            ["Waiting", diagnostics?.counts.waiting],
            ["Active", diagnostics?.counts.active],
            ["Delayed", diagnostics?.counts.delayed],
            ["Failed", diagnostics?.counts.failed],
            ["Rate limited", diagnostics?.counts.rateLimited],
            ["Completed", diagnostics?.counts.completed],
          ] as const
        ).map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value ?? "—"}</strong>
          </article>
        ))}
      </div>

      {diagnostics?.truncated && (
        <p className="integration-operations-note" role="note">
          Counts reflect up to {diagnostics.scannedJobs.toLocaleString()}{" "}
          retained queue jobs; older queue history may not be available.
        </p>
      )}

      <div className="integration-operations-table-wrap">
        <table className="integration-operations-table">
          <thead>
            <tr>
              <th scope="col">Event</th>
              <th scope="col">Status</th>
              <th scope="col">Attempts</th>
              <th scope="col">Received</th>
              <th scope="col">Completed</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {diagnostics?.events.map((event) => (
              <tr key={event.id}>
                <td>
                  <strong>
                    {event.provider} · {event.eventType}
                  </strong>
                  <small>{event.id}</small>
                  {event.errorCode && <small>{event.errorCode}</small>}
                </td>
                <td>
                  <span>{event.status.toLowerCase()}</span>
                  {event.queueState && <small>Queue: {event.queueState}</small>}
                </td>
                <td>{event.attempts}</td>
                <td>{timestamp(event.receivedAt)}</td>
                <td>{timestamp(event.completedAt)}</td>
                <td>
                  {event.retryable ? (
                    <button
                      type="button"
                      className="button-secondary"
                      disabled={workingId === event.id}
                      onClick={() => void retry(event.id)}
                    >
                      {workingId === event.id
                        ? "Retrying…"
                        : "Retry failed job"}
                    </button>
                  ) : event.retryUnavailableReason ? (
                    <small>{event.retryUnavailableReason}</small>
                  ) : (
                    <span aria-label="No retry available">—</span>
                  )}
                </td>
              </tr>
            ))}
            {diagnostics && diagnostics.events.length === 0 && (
              <tr>
                <td colSpan={6}>
                  No project-attributed webhook events are available.
                </td>
              </tr>
            )}
            {!diagnostics && !error && (
              <tr>
                <td colSpan={6}>Loading integration diagnostics…</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="integration-operations-note">
        Retry is available only while BullMQ retains the failed job and its
        normalized payload. Raw webhook payloads and error details are not
        shown.
      </p>
    </section>
  );
}
