import { FormEvent, useEffect, useState } from "react";
import { adminApi } from "./api";

type Session = {
  id: string;
  userAgent?: string | null;
  createdAt: string;
  lastUsedAt?: string | null;
  expiresAt: string;
  revokedAt?: string | null;
  current: boolean;
};

const messageFor = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The request could not be completed.";
const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : "Not available";

export function AccountSecurityPanel({
  onSessionRevoked,
}: {
  onSessionRevoked: () => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState("");
  const [passwordWorking, setPasswordWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadSessions() {
    setLoading(true);
    setError("");
    try {
      setSessions(await adminApi.listSessions<Session[]>());
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSessions();
  }, []);

  async function revoke(session: Session) {
    if (
      !window.confirm(
        session.current
          ? "Revoke this session and sign out now?"
          : "Revoke this session?",
      )
    )
      return;
    setWorkingId(session.id);
    setError("");
    setNotice("");
    try {
      const result = await adminApi.revokeSession<{ revoked: boolean }>(
        session.id,
      );
      if (session.current && result.revoked) {
        onSessionRevoked();
        return;
      }
      setNotice(
        result.revoked
          ? "Session revoked."
          : "That session is already inactive.",
      );
      await loadSessions();
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setWorkingId("");
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const values = new FormData(formElement);
    const currentPassword = String(values.get("currentPassword") ?? "");
    const newPassword = String(values.get("newPassword") ?? "");
    const confirmation = String(values.get("confirmPassword") ?? "");
    if (newPassword !== confirmation) {
      setError("New password and confirmation do not match.");
      return;
    }
    setPasswordWorking(true);
    setError("");
    setNotice("");
    try {
      await adminApi.changePassword({ currentPassword, newPassword });
      formElement.reset();
      setNotice("Password changed. Other active sessions were revoked.");
      await loadSessions();
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setPasswordWorking(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Account and security</h1>
          <p>Review active sessions and change your password.</p>
        </div>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => void loadSessions()}
          disabled={loading}
        >
          Refresh sessions
        </button>
      </div>
      <div aria-live="polite">
        {error && (
          <p className="error-copy" role="alert">
            {error}
          </p>
        )}
        {notice && <p className="success-copy">{notice}</p>}
      </div>
      <section className="section-block" aria-labelledby="sessions-heading">
        <div className="section-heading">
          <div>
            <h2 id="sessions-heading">Active sessions</h2>
            <p>Revoking the current session signs you out immediately.</p>
          </div>
        </div>
        {loading ? (
          <p role="status">Loading sessions…</p>
        ) : sessions.length ? (
          <div className="admin-list" role="list" aria-label="Account sessions">
            {sessions.map((session) => (
              <div
                className="admin-list-row session-row"
                role="listitem"
                key={session.id}
              >
                <div>
                  <strong>
                    {session.current
                      ? "This session"
                      : session.userAgent || "Unknown browser or device"}
                    {session.current && (
                      <span className="current-session-label">CURRENT</span>
                    )}
                  </strong>
                  <small>
                    Created {formatDate(session.createdAt)} · Last used{" "}
                    {formatDate(session.lastUsedAt)}
                  </small>
                  <small>
                    Expires {formatDate(session.expiresAt)}
                    {session.revokedAt
                      ? ` · Revoked ${formatDate(session.revokedAt)}`
                      : ""}
                  </small>
                </div>
                <button
                  className="button button-danger"
                  type="button"
                  disabled={Boolean(workingId) || Boolean(session.revokedAt)}
                  onClick={() => void revoke(session)}
                >
                  {workingId === session.id
                    ? "Revoking…"
                    : session.revokedAt
                      ? "Revoked"
                      : "Revoke session"}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="inline-empty">No sessions found.</p>
        )}
      </section>
      <section className="section-block" aria-labelledby="password-heading">
        <div className="section-heading">
          <div>
            <h2 id="password-heading">Change password</h2>
            <p>
              Use at least 12 characters. Other sessions will be signed out.
            </p>
          </div>
        </div>
        <form
          className="form-panel compact-form"
          onSubmit={(event) => void changePassword(event)}
        >
          <label className="field">
            <span>Current password</span>
            <input
              type="password"
              name="currentPassword"
              required
              minLength={12}
              maxLength={128}
              autoComplete="current-password"
            />
          </label>
          <label className="field">
            <span>New password</span>
            <input
              type="password"
              name="newPassword"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
          <label className="field">
            <span>Confirm new password</span>
            <input
              type="password"
              name="confirmPassword"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
          <div className="form-actions">
            <button
              className="button button-primary"
              disabled={passwordWorking}
            >
              {passwordWorking ? "Changing…" : "Change password"}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
