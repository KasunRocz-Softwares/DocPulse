import { useEffect, useState } from "react";
import { api } from "./api";

type ProjectSummary = { id: string; name: string };
type ReleaseSummary = {
  id: string;
  project: ProjectSummary;
  version: string;
  title: string;
  status: string;
  releaseDate?: string | null;
};

type IntegrationSummary = {
  project: ProjectSummary;
  failed: number;
  error?: string;
};

export function DashboardLifecycleSummary({
  projects,
  releases,
}: {
  projects: ProjectSummary[];
  releases: ReleaseSummary[];
}) {
  const [integrations, setIntegrations] = useState<IntegrationSummary[]>([]);
  const [loadingIntegrations, setLoadingIntegrations] = useState(true);
  const [integrationError, setIntegrationError] = useState(false);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  useEffect(() => {
    let active = true;
    if (!projects.length) {
      setIntegrations([]);
      setLoadingIntegrations(false);
      setIntegrationError(false);
      return () => {
        active = false;
      };
    }
    setLoadingIntegrations(true);
    setIntegrationError(false);
    void Promise.allSettled(
      projects.map(async (project) => {
        const result = await api.request<{
          counts?: { failed?: number };
        }>(
          `/internal/projects/${encodeURIComponent(project.id)}/integration-operations`,
        );
        return { project, failed: Number(result.counts?.failed ?? 0) };
      }),
    ).then((results) => {
      if (!active) return;
      const summary = results.map((result, index) =>
        result.status === "fulfilled"
          ? result.value
          : {
              project: projects[index]!,
              failed: 0,
              error: "Diagnostics could not be loaded.",
            },
      );
      setIntegrations(summary);
      setIntegrationError(
        summary.some((item) => "error" in item && item.error !== undefined),
      );
      setLoadingIntegrations(false);
    });
    return () => {
      active = false;
    };
  }, [projects]);

  const drafts = releases
    .filter((release) =>
      ["DRAFT", "REJECTED"].includes(release.status.toUpperCase()),
    )
    .sort((left, right) =>
      (left.releaseDate ?? "").localeCompare(right.releaseDate ?? ""),
    );
  const upcoming = releases
    .filter((release) => {
      if (!release.releaseDate) return false;
      const releaseDate = new Date(release.releaseDate);
      return (
        Number.isFinite(releaseDate.getTime()) &&
        releaseDate >= today &&
        !["PUBLISHED", "ARCHIVED"].includes(release.status.toUpperCase())
      );
    })
    .sort((left, right) =>
      (left.releaseDate ?? "").localeCompare(right.releaseDate ?? ""),
    );
  const failedProjects = integrations.filter((item) => item.failed > 0);
  const failedTotal = failedProjects.reduce(
    (total, item) => total + item.failed,
    0,
  );

  return (
    <section
      className="lifecycle-summary"
      aria-labelledby="lifecycle-summary-title"
    >
      <div className="lifecycle-summary-heading">
        <div>
          <p className="eyebrow">RELEASE PIPELINE</p>
          <h2 id="lifecycle-summary-title">Lifecycle and integrations</h2>
        </div>
      </div>
      <div className="lifecycle-summary-grid">
        <article className="lifecycle-summary-card">
          <div className="lifecycle-card-heading">
            <h3>Upcoming releases</h3>
            <strong>{upcoming.length}</strong>
          </div>
          <p>Scheduled for release on or after today.</p>
          {upcoming.length ? (
            <ul>
              {upcoming.slice(0, 4).map((release) => (
                <li key={release.id}>
                  <a
                    href={`#/projects/${encodeURIComponent(release.project.id)}/releases/${encodeURIComponent(release.id)}`}
                  >
                    <span>
                      {release.project.name} · {release.version}
                    </span>
                    <strong>{release.title}</strong>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="lifecycle-empty">No upcoming release dates.</p>
          )}
        </article>
        <article className="lifecycle-summary-card">
          <div className="lifecycle-card-heading">
            <h3>Draft releases</h3>
            <strong>{drafts.length}</strong>
          </div>
          <p>Drafts and releases that need changes.</p>
          {drafts.length ? (
            <ul>
              {drafts.slice(0, 4).map((release) => (
                <li key={release.id}>
                  <a
                    href={`#/projects/${encodeURIComponent(release.project.id)}/releases/${encodeURIComponent(release.id)}`}
                  >
                    <span>
                      {release.project.name} · {release.version}
                    </span>
                    <strong>{release.title}</strong>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="lifecycle-empty">No drafts need attention.</p>
          )}
        </article>
        <article className="lifecycle-summary-card">
          <div className="lifecycle-card-heading">
            <h3>Failed integrations</h3>
            <strong>{loadingIntegrations ? "…" : failedTotal}</strong>
          </div>
          <p>
            {integrationError
              ? "Some project diagnostics could not be loaded."
              : loadingIntegrations
                ? "Checking project webhook queues."
                : `${failedTotal} failed events`}
          </p>
          {failedProjects.length ? (
            <ul>
              {failedProjects.map((item) => (
                <li key={item.project.id}>
                  <a href={`#/projects/${encodeURIComponent(item.project.id)}`}>
                    <span>{item.project.name}</span>
                    <strong>{item.failed} failed events</strong>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="lifecycle-empty">
              {integrationError
                ? "Open a project to inspect webhook operations."
                : loadingIntegrations
                  ? " "
                  : "No failed integration events."}
            </p>
          )}
        </article>
      </div>
    </section>
  );
}
