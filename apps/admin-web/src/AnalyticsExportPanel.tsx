import { useCallback, useEffect, useState } from "react";
import { adminApi } from "./api";

type Dashboard = {
  totals: { projectViews: number; releaseViews: number };
  daily: Array<{ day: string; projectViews: number; releaseViews: number }>;
  topReleases: Array<{
    id: string;
    version: string;
    title: string;
    views: number;
  }>;
};
type ExportJob = {
  id: string;
  kind: "ANALYTICS_CSV" | "RELEASE_PDF";
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  filename: string;
  errorCode?: string | null;
  createdAt: string;
};
type PublishedRelease = {
  id: string;
  version: string;
  title: string;
  status: string;
};

const messageFor = (error: unknown) =>
  error instanceof Error ? error.message : "Analytics could not be loaded.";

export function AnalyticsExportPanel({
  projectId,
  releases = [],
}: {
  projectId: string;
  releases?: PublishedRelease[];
}) {
  const [days, setDays] = useState(30);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [releaseId, setReleaseId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const publishedReleases = releases.filter(
    (release) => release.status === "PUBLISHED",
  );

  const load = useCallback(async () => {
    setError("");
    const results = await Promise.allSettled([
      adminApi.getAnalytics<Dashboard>(projectId, days),
      adminApi.listAnalyticsExports<ExportJob[]>(projectId),
    ]);
    if (results[0].status === "fulfilled") setDashboard(results[0].value);
    if (results[1].status === "fulfilled") setJobs(results[1].value);
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [messageFor(result.reason)] : [],
    );
    setError(failures.join(" "));
  }, [projectId, days]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (
      !jobs.some(
        (job) => job.status === "PENDING" || job.status === "PROCESSING",
      )
    )
      return;
    const timer = window.setInterval(() => {
      void load();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [jobs, load]);

  async function createExport(
    body: {
      kind: "ANALYTICS_CSV" | "RELEASE_PDF";
      days?: number;
      releaseId?: string;
    },
    success: string,
  ) {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      await adminApi.createAnalyticsExport(projectId, body);
      setNotice(success);
      await load();
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setWorking(false);
    }
  }

  async function download(job: ExportJob) {
    try {
      const file = await adminApi.downloadAnalyticsExport(projectId, job.id);
      const url = URL.createObjectURL(file.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.filename ?? job.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(messageFor(requestError));
    }
  }

  const maxViews = Math.max(
    1,
    ...(dashboard?.daily.map((row) => row.projectViews + row.releaseViews) ??
      []),
  );

  return (
    <section className="analytics-panel" aria-labelledby="analytics-title">
      <header className="analytics-heading">
        <div>
          <p className="eyebrow">PUBLIC ENGAGEMENT</p>
          <h2 id="analytics-title">Analytics & exports</h2>
          <p>
            Aggregate public page views. No visitor profiles, IP addresses, or
            referrers are stored.
          </p>
        </div>
        <label>
          Range{" "}
          <select
            aria-label="Analytics range"
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
      </header>
      {error && (
        <p className="analytics-alert" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="analytics-notice" role="status">
          {notice}
        </p>
      )}
      <div className="analytics-metrics">
        <article>
          <span>Project page views</span>
          <strong>
            {dashboard?.totals.projectViews.toLocaleString() ?? "—"}
          </strong>
          <small>Last {days} days</small>
        </article>
        <article>
          <span>Release views</span>
          <strong>
            {dashboard?.totals.releaseViews.toLocaleString() ?? "—"}
          </strong>
          <small>Published release pages</small>
        </article>
      </div>
      <article className="analytics-card">
        <div className="analytics-card-heading">
          <div>
            <h3>Daily engagement</h3>
            <p>Project and release views combined</p>
          </div>
        </div>
        {dashboard?.daily.length ? (
          <div
            className="analytics-bars"
            role="img"
            aria-label="Daily public page views"
          >
            {dashboard.daily.map((row) => (
              <div
                className="analytics-bar-column"
                key={row.day}
                title={`${row.day}: ${row.projectViews + row.releaseViews} views`}
              >
                <span
                  style={{
                    height: `${Math.max(3, ((row.projectViews + row.releaseViews) / maxViews) * 100)}%`,
                  }}
                />
                <small>{row.day.slice(5)}</small>
              </div>
            ))}
          </div>
        ) : (
          <p className="analytics-empty">
            No public page views in this range yet.
          </p>
        )}
      </article>
      <div className="analytics-export-grid">
        <article className="analytics-card">
          <h3>Export analytics</h3>
          <p>Download a daily aggregate report as CSV.</p>
          <button
            type="button"
            disabled={working}
            onClick={() =>
              void createExport(
                { kind: "ANALYTICS_CSV", days },
                "CSV export queued.",
              )
            }
          >
            {working ? "Queueing…" : "Queue CSV export"}
          </button>
        </article>
        <article className="analytics-card">
          <h3>Release notes PDF</h3>
          <p>Create a PDF from the currently published public snapshot.</p>
          <label>
            Published release{" "}
            <select
              value={releaseId}
              onChange={(event) => setReleaseId(event.target.value)}
            >
              <option value="">Choose a release</option>
              {publishedReleases.map((release) => (
                <option key={release.id} value={release.id}>
                  {release.version} · {release.title}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={working || !releaseId}
            onClick={() =>
              void createExport(
                { kind: "RELEASE_PDF", releaseId },
                "PDF export queued.",
              )
            }
          >
            Queue PDF export
          </button>
        </article>
      </div>
      <article className="analytics-card">
        <h3>Recent exports</h3>
        {jobs.length ? (
          <ul className="analytics-jobs">
            {jobs.map((job) => (
              <li key={job.id}>
                <div>
                  <strong>{job.filename}</strong>
                  <small>
                    {job.kind === "ANALYTICS_CSV"
                      ? "Analytics CSV"
                      : "Published release PDF"}{" "}
                    · {job.status.toLowerCase()}
                  </small>
                  {job.errorCode && (
                    <small className="analytics-alert">{job.errorCode}</small>
                  )}
                </div>
                {job.status === "COMPLETED" && (
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => void download(job)}
                  >
                    Download
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="analytics-empty">No exports requested yet.</p>
        )}
      </article>
    </section>
  );
}
