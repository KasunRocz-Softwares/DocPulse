import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import "./github-app-installations.css";

type Repository = {
  id: string;
  owner: string;
  name: string;
  fullName?: string;
  defaultBranch?: string | null;
  private?: boolean;
  htmlUrl?: string;
};

type LinkedRepository = Repository & { id: string; externalId: string | null };

type Connection = {
  id: string;
  installationId: string;
  accountLogin: string;
  accountType: string;
  status: "ACTIVE" | "SUSPENDED" | "REMOVED";
  repositories: LinkedRepository[];
};

type Status = {
  configured: boolean;
  webhookPath: string;
  connections: Connection[];
};

const messageFor = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "GitHub App settings could not be loaded.";

/** Standalone panel contract: <GitHubAppInstallationsPanel projectId={project.id} /> */
export function GitHubAppInstallationsPanel({
  projectId,
}: {
  projectId: string;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [discovered, setDiscovered] = useState<Record<string, Repository[]>>(
    {},
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setStatus(
        await api.request<Status>(
          `/internal/projects/${encodeURIComponent(projectId)}/github-app`,
        ),
      );
    } catch (loadError) {
      setError(messageFor(loadError));
    }
  }, [projectId]);

  useEffect(() => {
    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.get("github_app") === "connected") {
      setNotice("GitHub App installation connected.");
      currentUrl.searchParams.delete("github_app");
      window.history.replaceState(
        null,
        "",
        `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
      );
    }
    void load();
  }, [load]);

  async function beginInstall() {
    setWorking("install");
    setError("");
    setNotice("");
    try {
      const { installUrl } = await api.request<{ installUrl: string }>(
        `/internal/projects/${encodeURIComponent(projectId)}/github-app/installations`,
        { method: "POST" },
      );
      const target = new URL(installUrl);
      if (target.protocol !== "https:" || target.hostname !== "github.com")
        throw new Error("GitHub returned an unsafe installation URL.");
      window.open(target.toString(), "_blank", "noopener,noreferrer");
      setNotice(
        "Complete installation in the GitHub tab, then refresh this panel.",
      );
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setWorking("");
    }
  }

  async function discover(installationId: string) {
    setWorking(`discover-${installationId}`);
    setError("");
    try {
      const repositories = await api.request<Repository[]>(
        `/internal/projects/${encodeURIComponent(projectId)}/github-app/installations/${encodeURIComponent(installationId)}/repositories`,
      );
      setDiscovered((current) => ({
        ...current,
        [installationId]: repositories,
      }));
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setWorking("");
    }
  }

  async function link(installationId: string, repositoryId: string) {
    setWorking(`link-${repositoryId}`);
    setError("");
    setNotice("");
    try {
      await api.request(
        `/internal/projects/${encodeURIComponent(projectId)}/github-app/installations/${encodeURIComponent(installationId)}/repositories`,
        { method: "POST", body: { repositoryId } },
      );
      setNotice("Repository linked to this project.");
      await load();
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setWorking("");
    }
  }

  async function disconnectRepository(repositoryId: string) {
    setWorking(`unlink-${repositoryId}`);
    setError("");
    try {
      await api.request(
        `/internal/projects/${encodeURIComponent(projectId)}/github-app/repositories/${encodeURIComponent(repositoryId)}`,
        { method: "DELETE" },
      );
      setNotice("Repository disconnected.");
      await load();
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setWorking("");
    }
  }

  async function disconnectInstallation(installationId: string) {
    setWorking(`remove-${installationId}`);
    setError("");
    try {
      await api.request(
        `/internal/projects/${encodeURIComponent(projectId)}/github-app/installations/${encodeURIComponent(installationId)}`,
        { method: "DELETE" },
      );
      setNotice(
        "Installation disconnected and its linked repositories removed.",
      );
      await load();
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setWorking("");
    }
  }

  return (
    <section
      className="github-app-installations"
      aria-labelledby="github-app-title"
    >
      <header>
        <div>
          <p className="eyebrow">SOURCE CONTROL</p>
          <h2 id="github-app-title">GitHub App installations</h2>
          <p>
            Connect an installation, then choose the repositories this project
            can use.
          </p>
        </div>
        <div className="github-app-actions">
          <button
            type="button"
            className="button-secondary"
            onClick={() => void load()}
          >
            Refresh
          </button>
          <button
            type="button"
            className="button-primary"
            onClick={() => void beginInstall()}
            disabled={!status?.configured || working === "install"}
          >
            {working === "install" ? "Opening GitHub…" : "Install GitHub App"}
          </button>
        </div>
      </header>
      {status && !status.configured && (
        <p className="github-app-disabled" role="status">
          GitHub App installation is disabled in this environment. Configure
          GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_APP_PRIVATE_KEY,
          GITHUB_APP_WEBHOOK_SECRET, and GITHUB_APP_ADMIN_ORIGIN to enable it.
        </p>
      )}
      {error && (
        <p className="github-app-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="github-app-notice" role="status">
          {notice}
        </p>
      )}
      <div className="github-app-webhook">
        Signed lifecycle webhook endpoint:{" "}
        <code>{status?.webhookPath ?? "—"}</code>
      </div>

      {status?.connections.length === 0 ? (
        <p className="github-app-empty">
          No GitHub App installations are connected to this project.
        </p>
      ) : (
        status?.connections.map((connection) => {
          const linkedIds = new Set(
            connection.repositories.map((repository) => repository.externalId),
          );
          return (
            <article className="github-app-connection" key={connection.id}>
              <div className="github-app-connection-heading">
                <div>
                  <h3>{connection.accountLogin}</h3>
                  <p>
                    {connection.accountType} · installation{" "}
                    {connection.installationId} ·{" "}
                    {connection.status.toLowerCase()}
                  </p>
                </div>
                <div className="github-app-actions">
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => void discover(connection.installationId)}
                    disabled={
                      connection.status !== "ACTIVE" ||
                      working === `discover-${connection.installationId}`
                    }
                  >
                    {working === `discover-${connection.installationId}`
                      ? "Loading…"
                      : "Discover repositories"}
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() =>
                      void disconnectInstallation(connection.installationId)
                    }
                    disabled={working === `remove-${connection.installationId}`}
                  >
                    Disconnect installation
                  </button>
                </div>
              </div>
              <ul className="github-app-repositories">
                {connection.repositories.map((repository) => (
                  <li key={repository.id}>
                    <span>
                      {repository.owner}/{repository.name}
                    </span>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => void disconnectRepository(repository.id)}
                      disabled={working === `unlink-${repository.id}`}
                    >
                      Disconnect
                    </button>
                  </li>
                ))}
                {discovered[connection.installationId]
                  ?.filter((repository) => !linkedIds.has(repository.id))
                  .map((repository) => (
                    <li key={`available-${repository.id}`}>
                      <span>
                        {repository.fullName ??
                          `${repository.owner}/${repository.name}`}
                        {repository.private ? " · private" : " · public"}
                      </span>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() =>
                          void link(connection.installationId, repository.id)
                        }
                        disabled={working === `link-${repository.id}`}
                      >
                        Link repository
                      </button>
                    </li>
                  ))}
              </ul>
            </article>
          );
        })
      )}
    </section>
  );
}
