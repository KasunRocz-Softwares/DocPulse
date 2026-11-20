import { type FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "./api";

type DomainStatus = {
  domain: string | null;
  verified: boolean;
  verifiedAt: string | null;
  challengeName: string | null;
};
type DomainChallenge = {
  domain: string;
  verified: false;
  expiresAt: string;
  txtRecord: { name: string; value: string };
};

const pathFor = (projectId: string) =>
  `/internal/projects/${encodeURIComponent(projectId)}/brand/custom-domain`;

export function CustomDomainPanel({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<DomainStatus | null>(null);
  const [domain, setDomain] = useState("");
  const [challenge, setChallenge] = useState<DomainChallenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const result = await api.request<DomainStatus>(pathFor(projectId));
      setStatus(result);
      setDomain(result.domain ?? "");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load domain settings.",
      );
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run<T>(action: () => Promise<T>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      setNotice(success);
      await load();
      return result;
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The request could not be completed.",
      );
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function requestVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await run(
      () =>
        api.request<DomainChallenge>(pathFor(projectId), {
          method: "POST",
          body: { domain: domain.trim() },
        }),
      "Domain saved. Add the DNS TXT record below, then verify it.",
    );
    if (result) setChallenge(result);
  }

  async function verify() {
    const result = await run(
      () =>
        api.request<DomainStatus>(`${pathFor(projectId)}/verify`, {
          method: "POST",
        }),
      "DNS ownership verified.",
    );
    if (result?.verified) setChallenge(null);
  }

  async function remove() {
    if (
      !window.confirm(
        `Remove ${status?.domain ?? "this custom domain"} from the project?`,
      )
    )
      return;
    const result = await run(
      () =>
        api.request<{ removed: boolean }>(pathFor(projectId), {
          method: "DELETE",
        }),
      "Custom domain removed.",
    );
    if (result?.removed) setChallenge(null);
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("DNS value copied.");
    } catch {
      setError(
        "Clipboard access is unavailable. Select and copy the DNS value manually.",
      );
    }
  }

  return (
    <section
      className="admin-subsection"
      aria-labelledby="custom-domain-heading"
    >
      <div className="section-heading">
        <div>
          <h3 id="custom-domain-heading">Custom public domain</h3>
          <p>
            Verify ownership with DNS before configuring public traffic and
            HTTPS at your edge.
          </p>
        </div>
        <button
          className="button button-quiet"
          type="button"
          onClick={() => void load()}
          disabled={busy}
        >
          Refresh
        </button>
      </div>
      {error && (
        <p className="error-copy" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success-copy" aria-live="polite">
          {notice}
        </p>
      )}
      <form className="form-panel compact-form" onSubmit={requestVerification}>
        <div className="form-grid">
          <label className="field">
            <span>Domain</span>
            <input
              name="domain"
              autoComplete="off"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              placeholder="updates.example.com…"
              maxLength={253}
              required
            />
          </label>
        </div>
        <div className="form-actions">
          <button className="button button-secondary" disabled={busy}>
            Request DNS verification
          </button>
          {status?.domain && (
            <span>{status.verified ? "Verified" : "Pending verification"}</span>
          )}
        </div>
      </form>
      {challenge && (
        <div
          className="form-panel compact-form"
          aria-labelledby="dns-challenge-heading"
        >
          <h4 id="dns-challenge-heading">Add this DNS TXT record</h4>
          <label className="field">
            <span>Record name</span>
            <input
              readOnly
              value={challenge.txtRecord.name}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <label className="field">
            <span>Record value</span>
            <input
              readOnly
              value={challenge.txtRecord.value}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <div className="form-actions">
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void copy(challenge.txtRecord.value)}
            >
              Copy TXT value
            </button>
            <button
              className="button button-primary"
              type="button"
              onClick={() => void verify()}
              disabled={busy}
            >
              Verify DNS
            </button>
            <small>
              Challenge expires{" "}
              {new Intl.DateTimeFormat(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(challenge.expiresAt))}
              .
            </small>
          </div>
        </div>
      )}
      {status?.domain && (
        <div className="form-actions">
          <span>
            {status.verified
              ? `${status.domain} verified${status.verifiedAt ? ` on ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(status.verifiedAt))}` : ""}.`
              : `${status.domain} is pending verification.`}
          </span>
          <button
            className="button button-quiet"
            type="button"
            onClick={() => void remove()}
            disabled={busy}
          >
            Remove domain
          </button>
        </div>
      )}
    </section>
  );
}
