import { useEffect, useRef, useState } from "react";
import "./OidcLogin.css";

type OidcLoginProps = {
  onAuthenticated?: (accessToken: string, user: OidcUser) => void;
  apiBaseUrl?: string;
  mode?: "login" | "link";
};

type OidcUser = {
  id: string;
  email: string;
  displayName: string;
  isSystemAdmin: boolean;
};

type OidcRefreshResult = { accessToken?: string; user?: OidcUser };
let oidcRefreshInFlight: Promise<OidcRefreshResult> | null = null;

const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV
    ? "http://localhost:13001/api/v1"
    : `${window.location.origin}/api/v1`);

function refreshOidcSession(baseUrl: string) {
  if (!oidcRefreshInFlight) {
    oidcRefreshInFlight = fetch(`${baseUrl}/internal/auth/refresh`, {
      method: "POST",
      credentials: "include",
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "The organization sign-in session could not be completed.",
          );
        return (await response.json()) as OidcRefreshResult;
      })
      .finally(() => {
        oidcRefreshInFlight = null;
      });
  }
  return oidcRefreshInFlight;
}

export function OidcLogin({
  onAuthenticated,
  apiBaseUrl: override,
  mode = "login",
}: OidcLoginProps) {
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [messageRole, setMessageRole] = useState<"alert" | "status">("alert");
  const [busy, setBusy] = useState(false);
  const baseUrl = (override || apiBaseUrl).replace(/\/+$/, "");
  const onAuthenticatedRef = useRef(onAuthenticated);

  useEffect(() => {
    onAuthenticatedRef.current = onAuthenticated;
  }, [onAuthenticated]);

  useEffect(() => {
    let active = true;
    const url = new URL(window.location.href);
    if (url.searchParams.get("oidc") === "linked" && mode === "link") {
      setMessageRole("status");
      setMessage("Your organization account is linked.");
      url.searchParams.delete("oidc");
      window.history.replaceState(
        null,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    } else if (url.searchParams.get("oidc") === "success" && mode === "login") {
      setBusy(true);
      refreshOidcSession(baseUrl)
        .then((result) => {
          if (!active) return;
          if (
            !result.accessToken ||
            !result.user ||
            !onAuthenticatedRef.current
          )
            throw new Error(
              "The organization sign-in response was incomplete.",
            );
          onAuthenticatedRef.current(result.accessToken, result.user);
        })
        .catch((error: unknown) => {
          if (active)
            setMessage(
              error instanceof Error
                ? error.message
                : "Organization sign-in failed.",
            );
        })
        .finally(() => {
          url.searchParams.delete("oidc");
          window.history.replaceState(
            null,
            "",
            `${url.pathname}${url.search}${url.hash}`,
          );
          if (active) setBusy(false);
        });
    } else if (url.searchParams.get("oidc_error")) {
      setMessage(
        "Organization sign-in failed. Try again or use your RDPS password.",
      );
      url.searchParams.delete("oidc_error");
      window.history.replaceState(
        null,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }

    fetch(`${baseUrl}/internal/auth/oidc/config`, { credentials: "include" })
      .then((response) =>
        response.ok
          ? (response.json() as Promise<{ enabled?: boolean }>)
          : null,
      )
      .then((result) => {
        if (active) setEnabled(result?.enabled === true);
      })
      .catch(() => {
        if (active) setEnabled(false);
      });

    return () => {
      active = false;
    };
  }, [baseUrl, mode]);

  async function beginLink() {
    setBusy(true);
    setMessage("");
    setMessageRole("alert");
    try {
      const token = window.sessionStorage.getItem("rdps.accessToken");
      if (!token)
        throw new Error(
          "Sign in to RDPS again before linking organization SSO.",
        );
      const response = await fetch(`${baseUrl}/internal/auth/oidc/link/start`, {
        method: "POST",
        credentials: "include",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok)
        throw new Error("Could not start organization account linking.");
      const result = (await response.json()) as {
        authorizationUrl?: string;
      };
      if (!result.authorizationUrl)
        throw new Error("The organization sign-in response was incomplete.");
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not link organization SSO.",
      );
      setBusy(false);
    }
  }

  if (!enabled) return null;
  return (
    <div className="oidc-login">
      {message && (
        <p className="oidc-login__message" role={messageRole}>
          {message}
        </p>
      )}
      {busy ? (
        <p className="oidc-login__status" role="status">
          {mode === "link"
            ? "Connecting to your organization…"
            : "Completing organization sign-in…"}
        </p>
      ) : mode === "link" ? (
        <button
          className="oidc-login__button"
          type="button"
          onClick={() => void beginLink()}
        >
          Link organization account
        </button>
      ) : (
        <a
          className="oidc-login__button"
          href={`${baseUrl}/internal/auth/oidc/start`}
        >
          Continue with organization SSO
        </a>
      )}
    </div>
  );
}
