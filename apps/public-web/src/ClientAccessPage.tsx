import { FormEvent, useState } from "react";
import { ClientReleasePortal } from "./ClientReleasePortal";

type LoginResult = { accessToken: string };

export function ClientAccessPage({
  projectSlug,
  apiBaseUrl,
}: {
  projectSlug: string;
  apiBaseUrl: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`${apiBaseUrl}/internal/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await response.json().catch(() => null)) as
        (LoginResult & { message?: string }) | null;
      if (!response.ok || !payload?.accessToken)
        throw new Error(
          payload?.message ??
            "Sign-in failed. Check your account and try again.",
        );
      setAccessToken(payload.accessToken);
      setPassword("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed.");
    } finally {
      setWorking(false);
    }
  }

  async function logout() {
    await fetch(`${apiBaseUrl}/internal/auth/logout`, {
      method: "POST",
      credentials: "include",
    }).catch(() => undefined);
    setAccessToken("");
    setEmail("");
    setPassword("");
    setError("");
  }

  if (accessToken)
    return (
      <>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        <div className="client-portal-toolbar">
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void logout()}
          >
            Sign out
          </button>
        </div>
        <ClientReleasePortal
          projectSlug={projectSlug}
          accessToken={accessToken}
          apiBaseUrl={apiBaseUrl}
        />
      </>
    );

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <main className="client-access-page" id="main" tabIndex={-1}>
        <section aria-labelledby="client-access-heading">
          <p>Private client release portal</p>
          <h1 id="client-access-heading">Sign in to view client updates</h1>
          <p>Use the account provided by your project administrator.</p>
          {error && (
            <p className="error-copy" role="alert">
              {error}
            </p>
          )}
          <form onSubmit={(event) => void login(event)}>
            <label>
              Email
              <input
                name="email"
                type="email"
                spellCheck={false}
                autoComplete="username"
                required
                maxLength={320}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button
              className="button button-primary"
              type="submit"
              disabled={working}
            >
              {working ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </section>
      </main>
    </>
  );
}
