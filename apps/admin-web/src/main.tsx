import React, {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { adminApi, api } from "./api";
import { ApiError } from "./api-client";
import { ProjectAdminPanel } from "./ProjectAdminPanel";
import { ReleaseAdminTools } from "./ReleaseAdminTools";
import { DeploymentOrchestrationPanel } from "./DeploymentOrchestrationPanel";
import { ReleaseContentPanel } from "./ReleaseContentPanel";
import { ClientReleaseAudienceSelector } from "./ClientReleaseAudienceSelector";
import { AccountSecurityPanel } from "./AccountSecurityPanel";
import { OidcLogin } from "./OidcLogin";
import { ProjectSubscriptionsPanel } from "./ProjectSubscriptionsPanel";
import { ReleaseChangeManagement } from "./ReleaseChangeManagement";
import { DashboardLifecycleSummary } from "./DashboardLifecycleSummary";
import { normalizeSearchResponse, searchResultPath } from "./search-results";
import {
  Button as SharedButton,
  EmptyState as SharedEmptyState,
  PageHeading as SharedPageHeading,
} from "@rdps/ui";
import "@rdps/ui/styles.css";
import "./style.css";
import "./layout.css";
import { PublicPageDesigner } from "./PublicPageDesigner";
import { UsersAdminPage } from "./UsersAdminPage";
import { ReadyToPublish } from "./ReadyToPublish";

type User = {
  id: string;
  email: string;
  displayName: string;
  isSystemAdmin: boolean;
};
type Project = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  status?: string;
  createdAt?: string;
  _count?: { releases?: number; members?: number };
};
type Change = {
  id: string;
  title: string;
  category: string;
  internalDescription: string;
  publicDescription?: string | null;
  visibility?: string;
};
type Release = {
  id: string;
  projectId?: string;
  version: string;
  title: string;
  type: string;
  channel?: string;
  status: string;
  releaseDate?: string | null;
  updatedAt?: string;
  internalSummary?: string | null;
  publicSummary?: string | null;
  changes?: Change[];
  documents?: Array<{ id: string; title?: string; content?: string }>;
  deployments?: Array<{
    id: string;
    status?: string;
    environment?: { name?: string };
  }>;
  _count?: { changes?: number; deployments?: number };
};
type ApprovalRevision = {
  id: string;
  revision: number;
  status: string;
  contentHash: string;
  releaseId: string;
  createdAt: string;
  content: {
    projectId: string;
    version: string;
    title: string;
    summary?: string | null;
    releaseDate?: string | null;
    changes: Array<{
      title: string;
      category: string;
      description: string;
      sortOrder: number;
    }>;
  };
  release: {
    id: string;
    version: string;
    title: string;
    projectId: string;
    project: { name: string; slug: string };
  };
  decisions: Array<{
    id: string;
    reviewerId: string;
    status: string;
    comment?: string | null;
    createdAt: string;
  }>;
};
type WorkspaceData = {
  projects: Project[];
  releases: Array<Release & { project: Project }>;
  releaseLoadErrors: string[];
};

const tokenKey = "rdps.accessToken";
const changeCategories = [
  "FEATURE",
  "IMPROVEMENT",
  "FIX",
  "BREAKING_CHANGE",
  "SECURITY",
  "PERFORMANCE",
  "DEPRECATION",
  "OTHER",
];

function Icon({
  name,
}: {
  name:
    | "home"
    | "projects"
    | "reviews"
    | "search"
    | "plus"
    | "arrow"
    | "logout"
    | "security"
    | "chevron"
    | "menu"
    | "sidebar"
    | "page"
    | "settings"
    | "users"
    | "releases";
}) {
  const paths: Record<typeof name, React.ReactNode> = {
    home: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    projects: (
      <>
        <path d="M3 7.5h7l2 2h9v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <path d="M3 7V5a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v2" />
      </>
    ),
    reviews: (
      <>
        <path d="m5 12 4 4L19 6" />
        <circle cx="12" cy="12" r="9" />
      </>
    ),
    search: (
      <>
        <circle cx="10.8" cy="10.8" r="6.8" />
        <path d="m16 16 5 5" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14M5 12h14" />
      </>
    ),
    arrow: (
      <>
        <path d="M5 12h14M13 6l6 6-6 6" />
      </>
    ),
    logout: (
      <>
        <path d="M10 17l5-5-5-5" />
        <path d="M15 12H3" />
        <path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" />
      </>
    ),
    security: (
      <>
        <path d="M12 3 20 6v5c0 5-3.4 8.2-8 10-4.6-1.8-8-5-8-10V6z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    chevron: (
      <>
        <path d="m9 18 6-6-6-6" />
      </>
    ),
    menu: (
      <>
        <path d="M4 7h16M4 12h16M4 17h16" />
      </>
    ),
    sidebar: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16" />
      </>
    ),
    page: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M9 21V9" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
        <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6" />
      </>
    ),
    releases: (
      <>
        <path d="M4 6h16M4 12h10M4 18h7" />
        <circle cx="18" cy="16" r="3" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

function readRoute() {
  const value = window.location.hash.replace(/^#\/?/, "");
  return value || "overview";
}

function go(path: string) {
  window.location.hash = `/${path}`;
}

function messageFor(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Your session has expired. Sign in again to continue.";
    if (error.status === 403)
      return "You do not have permission to complete this action.";
    return error.message;
  }
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

function dateLabel(date?: string | null) {
  if (!date) return "No release date";
  const parsed = new Date(date);
  return Number.isNaN(parsed.valueOf())
    ? date
    : new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(parsed);
}

function statusTone(status: string) {
  const value = status.toLowerCase();
  if (
    value.includes("publish") ||
    value.includes("approv") ||
    value === "active"
  )
    return "status-pill status-success";
  if (value.includes("review") || value.includes("pending"))
    return "status-pill status-review";
  if (value.includes("reject") || value.includes("fail"))
    return "status-pill status-danger";
  return "status-pill status-neutral";
}

function Status({ value }: { value: string }) {
  return (
    <span className={statusTone(value)}>
      <i />
      {value.replaceAll("_", " ").toLowerCase()}
    </span>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string | undefined;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function ActionMessage({
  value,
  kind = "error",
}: {
  value: string;
  kind?: "error" | "success";
}) {
  if (!value) return null;
  return (
    <div
      className={`notice notice-${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      {value}
    </div>
  );
}

function AuthScreen({
  onAuthenticated,
}: {
  onAuthenticated: (token: string, user: User) => void;
}) {
  const hashQuery = window.location.hash.split("?").slice(1).join("?");
  const inviteToken =
    new URLSearchParams(hashQuery).get("token") ??
    new URLSearchParams(window.location.search).get("token") ??
    "";
  // Links: #/accept-invitation?token=… (project invite) and
  // #/reset-password?token=… (password link issued from Users & roles).
  const isPasswordLink = window.location.hash.startsWith("#/reset-password");
  const [mode, setMode] = useState<"login" | "bootstrap" | "invite" | "reset">(
    inviteToken ? (isPasswordLink ? "reset" : "invite") : "login",
  );
  const usesLink = mode === "invite" || mode === "reset";
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(form.entries());
    if (usesLink && values.password !== values.confirmPassword) {
      setError("The two passwords do not match.");
      setWorking(false);
      return;
    }
    try {
      const result = await api.request<{ accessToken: string; user: User }>(
        mode === "invite"
          ? "/internal/auth/invitations/accept"
          : mode === "reset"
            ? "/internal/auth/password-reset/complete"
            : mode === "bootstrap"
              ? "/internal/auth/bootstrap"
              : "/internal/auth/login",
        {
          method: "POST",
          body: usesLink
            ? { token: inviteToken, password: values.password }
            : values,
        },
      );
      if (usesLink)
        window.history.replaceState(null, "", window.location.pathname);
      onAuthenticated(result.accessToken, result.user);
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-story">
        <div className="brand-lockup">
          <span className="brand-mark">R</span>
          <span>
            RDPS<span className="brand-divider">/</span>RELEASE OPERATIONS
          </span>
        </div>
        <div className="auth-headline">
          <p className="auth-overline">INTERNAL RELEASE PORTAL</p>
          <h1>
            Ship with
            <br />
            <em>clarity.</em>
          </h1>
          <p>
            One workspace for the notes, reviews, and decisions behind every
            release.
          </p>
        </div>
        <div className="auth-footnote">
          <span className="signal-dot" /> PRIVATE WORKSPACE <span>·</span>{" "}
          AUTHORIZED TEAM MEMBERS ONLY
        </div>
      </section>
      <section className="auth-form-side">
        <form className="auth-form" onSubmit={submit}>
          <div>
            <p className="form-kicker">
              {mode === "login"
                ? "WELCOME BACK"
                : mode === "invite"
                  ? "TEAM INVITATION"
                  : mode === "reset"
                    ? "PASSWORD LINK"
                    : "WORKSPACE SETUP"}
            </p>
            <h2>
              {mode === "login"
                ? "Sign in to RDPS"
                : mode === "invite"
                  ? "Join your release workspace"
                  : mode === "reset"
                    ? "Set a new password"
                    : "Create the first admin"}
            </h2>
            <p className="muted">
              {mode === "login"
                ? "Use your release workspace account to continue."
                : mode === "invite"
                  ? "Choose a password to activate your invited account."
                  : mode === "reset"
                    ? "Your administrator sent this one-time link. Choose a password to sign in; other sessions will be signed out."
                    : "Bootstrap creates the initial system administrator."}
            </p>
          </div>
          {mode === "bootstrap" && (
            <Field label="Display name">
              <input
                name="displayName"
                required
                minLength={2}
                maxLength={160}
                autoComplete="name"
              />
            </Field>
          )}
          {!usesLink && (
            <Field label="Work email">
              <input
                name="email"
                type="email"
                required
                maxLength={320}
                spellCheck={false}
                autoComplete="username"
              />
            </Field>
          )}
          <Field
            label="Password"
            hint={mode !== "login" ? "Use at least 12 characters." : undefined}
          >
            <input
              name="password"
              type="password"
              required
              minLength={mode !== "login" ? 12 : 1}
              maxLength={128}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
            />
          </Field>
          {usesLink && (
            <Field label="Confirm password">
              <input
                name="confirmPassword"
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
              />
            </Field>
          )}
          {mode === "bootstrap" && (
            <Field label="Bootstrap secret">
              <input
                name="bootstrapSecret"
                type="password"
                required
                minLength={20}
                maxLength={256}
                autoComplete="off"
              />
            </Field>
          )}
          <ActionMessage value={error} />
          <button
            className="button button-primary button-wide"
            disabled={working}
          >
            {working
              ? "Connecting…"
              : mode === "login"
                ? "Sign in"
                : mode === "invite"
                  ? "Accept invitation"
                  : mode === "reset"
                    ? "Set password and sign in"
                    : "Create administrator"}
            <Icon name="arrow" />
          </button>
          {mode === "login" && <OidcLogin onAuthenticated={onAuthenticated} />}
          {!usesLink && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setMode(mode === "login" ? "bootstrap" : "login");
                setError("");
              }}
            >
              {mode === "login"
                ? "Setting up a new workspace? Create its first admin."
                : "Already have an account? Sign in."}
            </button>
          )}
        </form>
      </section>
    </main>
  );
}

function Loading({ label = "Loading workspace" }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}

function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-rule" />
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}

function WorkspaceApp({
  user,
  onSignOut,
}: {
  user: User;
  onSignOut: () => void;
}) {
  const [route, setRoute] = useState(readRoute);
  const [projects, setProjects] = useState<Project[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [release, setRelease] = useState<Release | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState("");
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem("rdps.sidebar") === "collapsed";
    } catch {
      return false;
    }
  });
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const sync = () => {
      setRoute(readRoute());
      setDrawerOpen(false);
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "rdps.sidebar",
        collapsed ? "collapsed" : "expanded",
      );
    } catch {
      // Storage can be unavailable (private mode); the toggle still works.
    }
  }, [collapsed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
      const target = event.target as HTMLElement | null;
      const typing =
        target?.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "");
      const openSearch =
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") ||
        (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey);
      if (openSearch) {
        event.preventDefault();
        go("search");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const refreshWorkspace = useCallback(async () => {
    const nextProjects = await api.request<Project[]>("/internal/projects");
    const releaseLoadErrors: string[] = [];
    const releaseGroups = await Promise.all(
      nextProjects.map(async (item) => {
        try {
          const items = await api.request<Release[]>(
            `/internal/projects/${encodeURIComponent(item.id)}/releases`,
          );
          return items.map((entry) => ({ ...entry, project: item }));
        } catch (error) {
          releaseLoadErrors.push(`${item.name}: ${messageFor(error)}`);
          return [];
        }
      }),
    );
    const releases = releaseGroups.flat();
    setProjects(nextProjects);
    setWorkspace({ projects: nextProjects, releases, releaseLoadErrors });
    return { projects: nextProjects, releases, releaseLoadErrors };
  }, []);

  useEffect(() => {
    let active = true;
    const parts = route.split("/");
    async function load() {
      setLoading(true);
      setLoadError("");
      setProject(null);
      setRelease(null);
      try {
        if (
          parts[0] === "projects" &&
          parts[1] &&
          parts[2] === "releases" &&
          parts[3]
        ) {
          const detail = await api.request<Release>(
            `/internal/releases/${encodeURIComponent(parts[3])}`,
          );
          if (active) setRelease(detail);
          const found = await api.request<Project>(
            `/internal/projects/${encodeURIComponent(parts[1])}`,
          );
          const projectReleases = await api.request<Release[]>(
            `/internal/projects/${encodeURIComponent(parts[1])}/releases`,
          );
          if (active) {
            setProject(found);
            setWorkspace((current) => ({
              projects: current?.projects ?? [],
              releases: projectReleases.map((item) => ({
                ...item,
                project: found,
              })),
              releaseLoadErrors: current?.releaseLoadErrors ?? [],
            }));
          }
        } else if (parts[0] === "projects" && parts[1]) {
          const [detail, list] = await Promise.all([
            api.request<Project>(
              `/internal/projects/${encodeURIComponent(parts[1])}`,
            ),
            api.request<Release[]>(
              `/internal/projects/${encodeURIComponent(parts[1])}/releases`,
            ),
          ]);
          if (active) {
            setProject(detail);
            setWorkspace((current) => ({
              projects: current?.projects ?? [],
              releases: list.map((item) => ({ ...item, project: detail })),
              releaseLoadErrors: current?.releaseLoadErrors ?? [],
            }));
          }
        } else {
          const data = await refreshWorkspace();
          if (active) setWorkspace(data);
        }
      } catch (error) {
        if (active) {
          const message = messageFor(error);
          setLoadError(message);
          if (error instanceof ApiError && error.status === 401) onSignOut();
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [route, refreshWorkspace, onSignOut]);

  const visibleProjects = useMemo(
    () =>
      projects.filter((item) =>
        `${item.name} ${item.slug}`
          .toLowerCase()
          .includes(filter.toLowerCase()),
      ),
    [projects, filter],
  );
  const title = route.startsWith("projects/")
    ? release
      ? release.title
      : (project?.name ?? "Project")
    : route === "reviews"
      ? "Reviews"
      : route === "projects"
        ? "Projects"
        : route === "search"
          ? "Search"
          : route === "account"
            ? "Account and security"
            : route === "users"
              ? "Users & roles"
              : "Release desk";
  const navItem = route.startsWith("projects/")
    ? "projects"
    : route.split("/")[0] || "overview";

  async function createProject(input: Record<string, FormDataEntryValue>) {
    const result = await api.request<Project>("/internal/projects", {
      method: "POST",
      body: input,
    });
    setToast(`Project “${result.name}” created.`);
    await refreshWorkspace();
    go(`projects/${result.id}`);
  }

  const section = loading ? (
    <Loading label="Loading live project data" />
  ) : loadError ? (
    <EmptyState
      title="Couldn’t load this view"
      detail={loadError}
      action={
        <button
          className="button button-secondary"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      }
    />
  ) : route === "projects" ? (
    <ProjectsPage
      projects={visibleProjects}
      filter={filter}
      onFilter={setFilter}
      onCreate={createProject}
    />
  ) : route === "reviews" ? (
    <ReviewsPage releases={workspace?.releases ?? []} />
  ) : route === "search" ? (
    <SearchPage />
  ) : route === "users" ? (
    <UsersAdminPage currentUser={user} projects={projects} />
  ) : route === "account" ? (
    <>
      <AccountSecurityPanel onSessionRevoked={onSignOut} />
      <section className="section-block" aria-labelledby="organization-sso">
        <div className="section-heading">
          <div>
            <h2 id="organization-sso">Organization sign-in</h2>
            <p>Link or confirm your organization identity provider account.</p>
          </div>
        </div>
        <OidcLogin mode="link" />
      </section>
    </>
  ) : route.startsWith("projects/") &&
    route.includes("/releases/") &&
    project &&
    release ? (
    <ReleaseDetailPage
      release={release}
      project={project}
      releases={
        workspace?.releases.filter((item) => item.project.id === project.id) ??
        []
      }
      onUpdated={async () => {
        const next = await api.request<Release>(
          `/internal/releases/${encodeURIComponent(release.id)}`,
        );
        setRelease(next);
        await refreshWorkspace();
      }}
      onArchived={() => go(`projects/${project.id}`)}
    />
  ) : route.startsWith("projects/") && project ? (
    <ProjectPage
      key={project.id}
      project={project}
      initialTab={route.split("/")[2]}
      releases={
        workspace?.releases.filter((item) => item.project.id === project.id) ??
        []
      }
      onCreated={async () => {
        await refreshWorkspace();
      }}
      onProjectUpdated={(next) => setProject(next)}
    />
  ) : route === "overview" ? (
    <DashboardPage data={workspace} onNewProject={() => go("projects")} />
  ) : (
    <EmptyState
      title="Page not found"
      detail="This workspace route is not available. Return to the release desk to continue."
      action={
        <button
          className="button button-secondary"
          onClick={() => go("overview")}
        >
          Go to release desk
        </button>
      }
    />
  );

  return (
    <div
      className="app-shell"
      data-sidebar={collapsed ? "collapsed" : "expanded"}
      data-drawer={drawerOpen ? "open" : undefined}
    >
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
          document.getElementById("main")?.scrollIntoView({ block: "start" });
        }}
      >
        Skip to main content
      </a>
      <aside className="sidebar" id="primary-sidebar">
        <div className="sidebar-head">
          <button
            className="brand-lockup sidebar-brand"
            onClick={() => go("overview")}
            title="Release desk"
          >
            <span className="brand-mark">R</span>
            <span>
              RDPS<span className="brand-divider">/</span>
              <span className="brand-sub">Release Ops</span>
            </span>
          </button>
          <button
            type="button"
            className="sidebar-collapse"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <Icon name="sidebar" />
          </button>
        </div>
        <div className="side-label">Workspace</div>
        <nav className="main-nav" aria-label="Primary navigation">
          <NavLink
            active={navItem === "overview"}
            label="Overview"
            icon="home"
            onClick={() => go("overview")}
          />
          <NavLink
            active={navItem === "projects"}
            label="Projects"
            icon="projects"
            onClick={() => go("projects")}
            {...(projects.length ? { count: projects.length } : {})}
          />
          <NavLink
            active={navItem === "reviews"}
            label="Review desk"
            icon="reviews"
            onClick={() => go("reviews")}
          />
          <NavLink
            active={navItem === "search"}
            label="Search"
            icon="search"
            onClick={() => go("search")}
          />
          {user.isSystemAdmin && (
            <NavLink
              active={navItem === "users"}
              label="Users & roles"
              icon="users"
              onClick={() => go("users")}
            />
          )}
          <NavLink
            active={navItem === "account"}
            label="Account & security"
            icon="security"
            onClick={() => go("account")}
          />
        </nav>
        <div className="sidebar-projects">
          <div className="side-label">Your projects</div>
          {projects.slice(0, 8).map((item) => (
            <button
              className="project-shortcut"
              key={item.id}
              onClick={() => go(`projects/${item.id}`)}
              aria-current={
                route.split("/")[1] === item.id ? "page" : undefined
              }
              title={item.name}
            >
              <span>{item.name.slice(0, 1).toUpperCase()}</span>
              {item.name}
            </button>
          ))}
          {projects.length === 0 && (
            <p className="side-empty">
              Projects appear here when you have access.
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="account">
            <span className="account-avatar">
              {user.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span className="account-copy">
              <strong>{user.displayName}</strong>
              <small>
                {user.isSystemAdmin ? "System administrator" : user.email}
              </small>
            </span>
          </div>
          <button
            className="signout-button"
            onClick={onSignOut}
            aria-label="Sign out"
          >
            <Icon name="logout" />
          </button>
        </div>
      </aside>
      {drawerOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setDrawerOpen(false)}
        />
      )}
      <main className="main-area" id="main" tabIndex={-1}>
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="menu-button"
              aria-controls="primary-sidebar"
              aria-expanded={drawerOpen}
              aria-label="Open navigation"
              onClick={() => setDrawerOpen(true)}
            >
              <Icon name="menu" />
            </button>
            <div className="breadcrumbs">
              <span>Release operations</span>
              <Icon name="chevron" />
              <strong>{title}</strong>
            </div>
          </div>
          <div className="topbar-right">
            <span className="environment-indicator">
              <i /> Internal
            </span>
            <button
              className="search-shortcut"
              onClick={() => go("search")}
              aria-label="Search projects and releases"
              title="Search (/ or Ctrl+K)"
            >
              <Icon name="search" />
              <span>Search projects and releases</span>
              <kbd>/</kbd>
            </button>
          </div>
        </header>
        <div className="page-content">
          <ActionMessage value={toast} kind="success" />
          {section}
        </div>
        <footer className="app-footer">
          <span>
            RDPS <b>·</b> INTERNAL RELEASE PORTAL
          </span>
          <span>Changes are protected by project access policies.</span>
        </footer>
      </main>
    </div>
  );
}

function NavLink({
  active,
  label,
  icon,
  onClick,
  count,
}: {
  active: boolean;
  label: string;
  icon: "home" | "projects" | "reviews" | "search" | "security" | "users";
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      className={`nav-link${active ? " nav-link-active" : ""}`}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={label}
    >
      <Icon name={icon} />
      <span>{label}</span>
      {count !== undefined && <small>{count}</small>}
    </button>
  );
}

function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function DashboardPage({
  data,
  onNewProject,
}: {
  data: WorkspaceData | null;
  onNewProject: () => void;
}) {
  const projects = data?.projects ?? [];
  const releases = data?.releases ?? [];
  const reviewing = releases.filter((item) =>
    item.status.toLowerCase().includes("review"),
  );
  const published = releases.filter((item) =>
    item.status.toLowerCase().includes("publish"),
  );
  return (
    <>
      <SharedPageHeading
        className="page-heading"
        title="Release desk"
        description="A live view of the projects, releases, and review work in your workspace."
        action={
          <SharedButton
            className="button button-primary"
            variant="primary"
            onClick={onNewProject}
          >
            <Icon name="plus" /> New project
          </SharedButton>
        }
      />
      <section className="summary-strip" aria-label="Workspace summary">
        <Summary
          label="Projects"
          value={projects.length}
          note="Projects you can access"
        />
        <Summary
          label="Releases"
          value={releases.length}
          note="Across all lifecycle states"
        />
        <Summary
          label="Awaiting review"
          value={reviewing.length}
          note="Release workflow status"
          accent="amber"
        />
        <Summary
          label="Published"
          value={published.length}
          note="Release records marked published"
          accent="green"
        />
      </section>
      <DashboardLifecycleSummary projects={projects} releases={releases} />
      {data?.releaseLoadErrors.length ? (
        <ActionMessage
          value={`Some project release lists could not be loaded: ${data.releaseLoadErrors.join(" · ")}`}
        />
      ) : null}
      <div className="dashboard-grid">
        <section className="section-block">
          <div className="section-heading">
            <div>
              <h2>Recent releases</h2>
              <p>Most recently updated across your projects</p>
            </div>
            <button className="link-button" onClick={() => go("projects")}>
              Browse projects <Icon name="arrow" />
            </button>
          </div>
          {releases.length ? (
            <ReleaseTable
              releases={[...releases]
                .sort((a, b) =>
                  (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
                )
                .slice(0, 7)}
            />
          ) : (
            <SharedEmptyState
              className="empty-state"
              headingLevel={3}
              title="No releases yet"
              description={
                projects.length
                  ? "Create a release inside a project to start building its release history."
                  : "Create your first project to start organizing releases."
              }
              action={
                !projects.length ? (
                  <SharedButton
                    className="button button-secondary"
                    onClick={onNewProject}
                  >
                    Create a project
                  </SharedButton>
                ) : undefined
              }
            />
          )}
        </section>
        <aside className="section-block attention-block">
          <div className="section-heading">
            <div>
              <h2>Review desk</h2>
              <p>Releases in internal review</p>
            </div>
            <button
              className="icon-quiet"
              aria-label="Open review desk"
              onClick={() => go("reviews")}
            >
              <Icon name="arrow" />
            </button>
          </div>
          {reviewing.length ? (
            <div className="attention-list">
              {reviewing.slice(0, 5).map((item) => (
                <button
                  key={item.id}
                  className="attention-row"
                  onClick={() =>
                    go(`projects/${item.project.id}/releases/${item.id}`)
                  }
                >
                  <span className="attention-mark">
                    <Icon name="reviews" />
                  </span>
                  <span className="attention-text">
                    <strong>
                      {item.project.name} · {item.version}
                    </strong>
                    <small>{item.title}</small>
                  </span>
                  <Status value={item.status} />
                </button>
              ))}
            </div>
          ) : (
            <SharedEmptyState
              className="empty-state"
              headingLevel={3}
              title="Nothing waiting"
              description="Releases submitted for internal review will show here."
            />
          )}
        </aside>
      </div>
      <section className="section-block project-overview">
        <div className="section-heading">
          <div>
            <h2>Projects</h2>
            <p>Access and release activity</p>
          </div>
          <button className="link-button" onClick={onNewProject}>
            All projects <Icon name="arrow" />
          </button>
        </div>
        {projects.length ? (
          <div className="project-grid">
            {projects.slice(0, 4).map((item) => (
              <button
                className="project-tile"
                key={item.id}
                onClick={() => go(`projects/${item.id}`)}
              >
                <span className="tile-initial">
                  {item.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="tile-main">
                  <strong>{item.name}</strong>
                  <small>/{item.slug}</small>
                </span>
                <span className="tile-count">
                  {item._count?.releases ??
                    releases.filter((entry) => entry.project.id === item.id)
                      .length}{" "}
                  releases
                </span>
                <Icon name="chevron" />
              </button>
            ))}
          </div>
        ) : (
          <SharedEmptyState
            className="empty-state"
            headingLevel={3}
            title="A workspace starts with a project"
            description="Projects keep release records and team access in one place."
            action={
              <SharedButton
                className="button button-secondary"
                onClick={onNewProject}
              >
                Create project
              </SharedButton>
            }
          />
        )}
      </section>
    </>
  );
}

function Summary({
  label,
  value,
  note,
  accent,
}: {
  label: string;
  value: number;
  note: string;
  accent?: "amber" | "green";
}) {
  return (
    <div className="summary-item">
      <div className="summary-label">
        <span className={accent ? `summary-dot ${accent}` : "summary-dot"} />
        {label}
      </div>
      <strong>{String(value).padStart(2, "0")}</strong>
      <small>{note}</small>
    </div>
  );
}

function ReleaseTable({
  releases,
}: {
  releases: Array<Release & { project: Project }>;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Project / release</th>
            <th>Type</th>
            <th>Status</th>
            <th>Updated</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {releases.map((item) => (
            <tr
              key={item.id}
              onClick={() =>
                go(`projects/${item.project.id}/releases/${item.id}`)
              }
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter")
                  go(`projects/${item.project.id}/releases/${item.id}`);
              }}
            >
              <td>
                <span className="table-primary">
                  {item.project.name} <b>·</b> {item.version}
                </span>
                <small>{item.title}</small>
              </td>
              <td>
                <span className="type-label">{item.type.toLowerCase()}</span>
              </td>
              <td>
                <Status value={item.status} />
              </td>
              <td className="table-date">
                {dateLabel(item.updatedAt ?? item.releaseDate)}
              </td>
              <td>
                <Icon name="chevron" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProjectsPage({
  projects,
  filter,
  onFilter,
  onCreate,
}: {
  projects: Project[];
  filter: string;
  onFilter: (value: string) => void;
  onCreate: (input: Record<string, FormDataEntryValue>) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [slug, setSlug] = useState("");
  const [createError, setCreateError] = useState("");
  const [saving, setSaving] = useState(false);
  function updateName(value: string) {
    setSlug(
      value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80),
    );
  }
  return (
    <>
      <PageHeading
        title="Projects"
        description="Projects are the boundary for release records, access, and publishing."
        action={
          <button
            className="button button-primary"
            onClick={() => setCreating((value) => !value)}
          >
            <Icon name="plus" /> {creating ? "Close form" : "New project"}
          </button>
        }
      />
      {creating && (
        <form
          className="form-panel project-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            setCreateError("");
            try {
              await onCreate(
                Object.fromEntries(new FormData(event.currentTarget).entries()),
              );
              setCreating(false);
            } catch (error) {
              setCreateError(messageFor(error));
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="form-panel-heading">
            <h2>Create project</h2>
            <p>Choose a stable name and URL-safe project slug.</p>
          </div>
          <div className="form-grid">
            <Field label="Project name">
              <input
                name="name"
                required
                minLength={2}
                maxLength={160}
                onChange={(event) => updateName(event.target.value)}
              />
            </Field>
            <Field
              label="Project slug"
              hint="Lowercase letters, numbers, and hyphens."
            >
              <input
                name="slug"
                required
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                maxLength={80}
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
              />
            </Field>
            <Field label="Description">
              <textarea name="description" rows={3} maxLength={2000} />
            </Field>
          </div>
          <ActionMessage value={createError} />
          <div className="form-actions">
            <button className="button button-primary" disabled={saving}>
              {saving ? "Creating…" : "Create project"}
            </button>
          </div>
        </form>
      )}
      <div className="list-toolbar">
        <label className="search-field">
          <Icon name="search" />
          <input
            name="projectFilter"
            autoComplete="off"
            aria-label="Filter projects"
            placeholder="Filter projects"
            value={filter}
            onChange={(event) => onFilter(event.target.value)}
          />
        </label>
        <span>
          {projects.length} {projects.length === 1 ? "project" : "projects"}
        </span>
      </div>
      {projects.length ? (
        <div className="project-list">
          {projects.map((item) => (
            <button
              className="project-list-row"
              key={item.id}
              onClick={() => go(`projects/${item.id}`)}
            >
              <span className="tile-initial">
                {item.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="project-list-name">
                <strong>{item.name}</strong>
                <small>{item.description || `/${item.slug}`}</small>
              </span>
              <span className="project-list-meta">
                {item._count?.releases ?? 0} releases
              </span>
              <Status value={item.status ?? "active"} />
              <Icon name="chevron" />
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          title={filter ? "No matching projects" : "No projects available"}
          detail={
            filter
              ? "Try another name or slug."
              : "Create a project if your account has permission."
          }
        />
      )}
    </>
  );
}

const projectTabs = [
  { id: "releases", label: "Releases", icon: "releases" },
  { id: "public-page", label: "Public page", icon: "page" },
  { id: "settings", label: "Settings", icon: "settings" },
  { id: "subscribers", label: "Subscribers", icon: "users" },
] as const;
type ProjectTab = (typeof projectTabs)[number]["id"];

function ProjectPage({
  project,
  releases,
  initialTab,
  onCreated,
  onProjectUpdated,
}: {
  project: Project;
  releases: Array<Release & { project: Project }>;
  initialTab?: string | undefined;
  onCreated: () => Promise<void>;
  onProjectUpdated: (next: Project) => void;
}) {
  const [tab, setTab] = useState<ProjectTab>(() =>
    projectTabs.some((item) => item.id === initialTab)
      ? (initialTab as ProjectTab)
      : "releases",
  );
  function selectTab(next: ProjectTab) {
    setTab(next);
    window.history.replaceState(
      null,
      "",
      `#/projects/${project.id}${next === "releases" ? "" : `/${next}`}`,
    );
  }
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError("");
    const values = Object.fromEntries(
      new FormData(event.currentTarget).entries(),
    );
    try {
      const result = await api.request<Release>(
        `/internal/projects/${encodeURIComponent(project.id)}/releases`,
        { method: "POST", body: values },
      );
      await onCreated();
      go(`projects/${project.id}/releases/${result.id}`);
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setWorking(false);
    }
  }
  return (
    <>
      <PageHeading
        title={project.name}
        description={
          project.description ||
          `Project /${project.slug} · release records and project activity.`
        }
        action={
          <button
            className="button button-primary"
            onClick={() => {
              selectTab("releases");
              setCreating((value) => !value);
            }}
          >
            <Icon name="plus" /> New release
          </button>
        }
      />
      <div className="project-context">
        <span>
          PROJECT SLUG <strong>/{project.slug}</strong>
        </span>
        <span>
          PROJECT STATUS <Status value={project.status ?? "active"} />
        </span>
        <span>
          CREATED <strong>{dateLabel(project.createdAt)}</strong>
        </span>
      </div>
      <div className="page-tabs" role="tablist" aria-label="Project sections">
        {projectTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`project-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`project-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => selectTab(item.id)}
            onKeyDown={(event) => {
              const index = projectTabs.findIndex(({ id }) => id === tab);
              const step =
                event.key === "ArrowRight"
                  ? 1
                  : event.key === "ArrowLeft"
                    ? -1
                    : 0;
              if (!step) return;
              event.preventDefault();
              const next =
                projectTabs[
                  (index + step + projectTabs.length) % projectTabs.length
                ]!;
              selectTab(next.id);
              document.getElementById(`project-tab-${next.id}`)?.focus();
            }}
          >
            <Icon name={item.icon} />
            {item.label}
            {item.id === "releases" && (
              <span className="tab-count">{releases.length}</span>
            )}
          </button>
        ))}
      </div>
      {tab === "public-page" && (
        <div
          role="tabpanel"
          id="project-panel-public-page"
          aria-labelledby="project-tab-public-page"
        >
          <PublicPageDesigner project={project} />
        </div>
      )}
      {tab === "settings" && (
        <div
          role="tabpanel"
          id="project-panel-settings"
          aria-labelledby="project-tab-settings"
        >
          <ProjectAdminPanel
            project={project}
            onProjectUpdated={onProjectUpdated}
          />
        </div>
      )}
      {tab === "subscribers" && (
        <div
          role="tabpanel"
          id="project-panel-subscribers"
          aria-labelledby="project-tab-subscribers"
        >
          <ProjectSubscriptionsPanel projectId={project.id} />
        </div>
      )}
      {tab === "releases" && (
        <div
          role="tabpanel"
          id="project-panel-releases"
          aria-labelledby="project-tab-releases"
        >
          {creating && (
            <form className="form-panel" onSubmit={submit}>
              <div className="form-panel-heading">
                <h2>New release</h2>
                <p>
                  Version follows semantic versioning with an optional leading
                  v.
                </p>
              </div>
              <div className="form-grid three">
                <Field label="Version">
                  <input
                    name="version"
                    required
                    pattern="v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?"
                    placeholder="1.4.0"
                  />
                </Field>
                <Field label="Release title">
                  <input
                    name="title"
                    required
                    minLength={2}
                    maxLength={200}
                    placeholder="Accessibility improvements"
                  />
                </Field>
                <Field label="Type">
                  <select name="type" required defaultValue="MINOR">
                    {["MAJOR", "MINOR", "PATCH", "HOTFIX"].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Channel">
                  <select name="channel" defaultValue="STABLE">
                    {["ALPHA", "BETA", "RC", "STABLE"].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Release date">
                  <input name="releaseDate" type="date" />
                </Field>
                <Field label="Internal summary">
                  <textarea name="internalSummary" rows={2} maxLength={10000} />
                </Field>
              </div>
              <ActionMessage value={error} />
              <div className="form-actions">
                <button className="button button-primary" disabled={working}>
                  {working ? "Creating…" : "Create release"}
                </button>
              </div>
            </form>
          )}
          <section className="section-block">
            <div className="section-heading">
              <div>
                <h2>Release history</h2>
                <p>{releases.length} release records for this project</p>
              </div>
            </div>
            {releases.length ? (
              <ReleaseTable releases={releases} />
            ) : (
              <EmptyState
                title="This project has no releases"
                detail="Create the first release to start writing internal notes and customer-facing changes."
                action={
                  <button
                    className="button button-secondary"
                    onClick={() => setCreating(true)}
                  >
                    Create a release
                  </button>
                }
              />
            )}
          </section>
        </div>
      )}
    </>
  );
}

function ReleaseDetailPage({
  release,
  project,
  releases,
  onUpdated,
  onArchived,
}: {
  release: Release;
  project: Project;
  releases: Array<Release & { project: Project }>;
  onUpdated: () => Promise<void>;
  onArchived: () => void;
}) {
  const [addingChange, setAddingChange] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [revisionId, setRevisionId] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [decision, setDecision] = useState<"approve" | "reject" | "publish">(
    "approve",
  );
  const [changeDraft, setChangeDraft] = useState<Change | null>(null);
  const [managedChanges, setManagedChanges] = useState(release.changes ?? []);
  const [releaseSection, setReleaseSection] = useState("notes");
  const releaseSections = [
    ["notes", "Notes & review"],
    ["details", "Details & comparison"],
    ["deployments", "Deployments"],
    ["content", "Documents & visibility"],
  ] as const;
  const changes = managedChanges;
  const editable = ["DRAFT", "REJECTED"].includes(release.status.toUpperCase());

  useEffect(() => {
    setManagedChanges(release.changes ?? []);
  }, [release.id, release.changes]);

  async function action(
    path: string,
    method: string,
    body?: unknown,
    successText = "Saved.",
  ) {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const result = await api.request<ApprovalRevision | unknown>(path, {
        method,
        ...(body === undefined ? {} : { body }),
      });
      const candidate = result as Partial<ApprovalRevision>;
      if (candidate.id && candidate.revision !== undefined) {
        setRevisionId(candidate.id);
        setSuccess(
          `Public approval revision ${candidate.revision} created. Share this revision ID with an authorized reviewer: ${candidate.id}`,
        );
      } else setSuccess(successText);
      await onUpdated();
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function saveChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    const values = Object.fromEntries(
      new FormData(event.currentTarget).entries(),
    );
    try {
      if (changeDraft) {
        await api.request(
          `/internal/releases/${encodeURIComponent(release.id)}/changes/${encodeURIComponent(changeDraft.id)}`,
          { method: "PATCH", body: values },
        );
        setManagedChanges((current) =>
          current.map((item) =>
            item.id === changeDraft.id
              ? {
                  ...item,
                  title: String(values.title),
                  category: String(values.category),
                  internalDescription: String(values.internalDescription),
                  publicDescription: String(values.publicDescription ?? ""),
                }
              : item,
          ),
        );
        setSuccess("Change updated.");
      } else {
        const created = await api.request<{ id: string }>(
          `/internal/releases/${encodeURIComponent(release.id)}/changes`,
          { method: "POST", body: values },
        );
        setManagedChanges((current) => [
          ...current,
          {
            id: created.id,
            title: String(values.title),
            category: String(values.category),
            internalDescription: String(values.internalDescription),
            publicDescription: String(values.publicDescription ?? ""),
            visibility: values.publicDescription ? "PUBLIC" : "INTERNAL",
            sortOrder: current.length,
          },
        ]);
        setSuccess("Change added.");
      }
      setAddingChange(false);
      setChangeDraft(null);
      await onUpdated();
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setSaving(false);
    }
  }

  const reviewPath = `/internal/releases/${encodeURIComponent(release.id)}/approval-revisions/${encodeURIComponent(revisionId)}`;
  return (
    <>
      <button
        className="back-link"
        onClick={() => go(`projects/${project.id}`)}
      >
        ← {project.name}
      </button>
      <PageHeading
        title={`${release.version} · ${release.title}`}
        description={`${release.type.toLowerCase()} release · ${release.channel?.toLowerCase() ?? "stable"} channel · ${dateLabel(release.releaseDate)}`}
        action={<Status value={release.status} />}
      />
      <div className="release-meta">
        <span>
          PROJECT <strong>{project.name}</strong>
        </span>
        <span>
          UPDATED <strong>{dateLabel(release.updatedAt)}</strong>
        </span>
        <span>
          ENVIRONMENTS{" "}
          <strong>{release.deployments?.length ?? 0} deployments</strong>
        </span>
      </div>
      <ActionMessage value={error} />
      <ActionMessage value={success} kind="success" />
      <div
        className="release-section-nav"
        role="tablist"
        aria-label="Release sections"
      >
        {releaseSections.map(([id, label], index) => (
          <button
            key={id}
            id={`release-tab-${id}`}
            role="tab"
            aria-selected={releaseSection === id}
            aria-controls={`release-panel-${id}`}
            tabIndex={releaseSection === id ? 0 : -1}
            onClick={() => setReleaseSection(id)}
            onKeyDown={(event) => {
              const offset =
                event.key === "ArrowRight"
                  ? 1
                  : event.key === "ArrowLeft"
                    ? -1
                    : 0;
              const target =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? releaseSections.length - 1
                    : offset
                      ? (index + offset + releaseSections.length) %
                        releaseSections.length
                      : -1;
              if (target < 0) return;
              event.preventDefault();
              const next = releaseSections[target]![0];
              setReleaseSection(next);
              document.getElementById(`release-tab-${next}`)?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="release-panel-notes"
        aria-labelledby="release-tab-notes"
        hidden={releaseSection !== "notes"}
        tabIndex={0}
      >
        <div className="release-layout">
          <div className="release-main-column">
            <section className="section-block">
              <div className="section-heading">
                <div>
                  <h2>Release notes</h2>
                  <p>Internal summary and structured change entries</p>
                </div>
                {editable && (
                  <button
                    className="button button-secondary"
                    onClick={() => {
                      setChangeDraft(null);
                      setAddingChange((value) => !value);
                    }}
                  >
                    <Icon name="plus" /> Add change
                  </button>
                )}
              </div>
              {release.internalSummary ? (
                <div className="summary-copy">{release.internalSummary}</div>
              ) : (
                <p className="inline-empty">
                  No internal summary has been added.
                </p>
              )}
              {addingChange && (
                <form className="form-panel compact-form" onSubmit={saveChange}>
                  <div className="form-panel-heading">
                    <h3>{changeDraft ? "Edit change" : "Add a change"}</h3>
                    <p>
                      Public descriptions are included in an approval candidate.
                    </p>
                  </div>
                  <Field label="Change title">
                    <input
                      name="title"
                      required
                      minLength={2}
                      maxLength={240}
                      defaultValue={changeDraft?.title ?? ""}
                    />
                  </Field>
                  <Field label="Category">
                    <select
                      name="category"
                      defaultValue={changeDraft?.category ?? "IMPROVEMENT"}
                    >
                      {changeCategories.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Internal description">
                    <textarea
                      name="internalDescription"
                      required
                      minLength={1}
                      maxLength={20000}
                      rows={4}
                      defaultValue={changeDraft?.internalDescription ?? ""}
                    />
                  </Field>
                  <Field
                    label="Public description"
                    hint="Leave empty to keep this change internal-only."
                  >
                    <textarea
                      name="publicDescription"
                      maxLength={10000}
                      rows={3}
                      defaultValue={changeDraft?.publicDescription ?? ""}
                    />
                  </Field>
                  <div className="form-actions">
                    <button className="button button-primary" disabled={saving}>
                      {saving
                        ? "Saving…"
                        : changeDraft
                          ? "Save change"
                          : "Add change"}
                    </button>
                    <button
                      type="button"
                      className="button button-quiet"
                      onClick={() => {
                        setAddingChange(false);
                        setChangeDraft(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
              {changes.length ? (
                <ReleaseChangeManagement
                  releaseId={release.id}
                  status={release.status}
                  changes={changes}
                  onUpdated={onUpdated}
                  onEdit={(change) => {
                    setChangeDraft(change);
                    setAddingChange(true);
                  }}
                />
              ) : (
                <EmptyState
                  title="No changes added"
                  detail="Add structured changes to build the internal record and, where appropriate, a public candidate."
                />
              )}
            </section>
          </div>
          <aside className="release-side-column">
            <section className="section-block workflow-panel">
              <div className="section-heading">
                <div>
                  <h2>Workflow</h2>
                  <p>Prepare this release for review and publication.</p>
                </div>
              </div>
              {editable && (
                <button
                  className="button button-primary button-wide"
                  disabled={saving}
                  onClick={() =>
                    void action(
                      `/internal/releases/${encodeURIComponent(release.id)}/submit-review`,
                      "PATCH",
                      undefined,
                      "Release submitted for internal review.",
                    )
                  }
                >
                  {saving ? "Working…" : "Submit internal review"}
                </button>
              )}
              {release.status.toUpperCase() === "REVIEW" && (
                <>
                  <button
                    className="button button-secondary button-wide"
                    disabled={saving || changes.length === 0}
                    onClick={() =>
                      void action(
                        `/internal/releases/${encodeURIComponent(release.id)}/approval-revisions`,
                        "POST",
                        undefined,
                        "Approval revision created.",
                      )
                    }
                  >
                    Create public approval revision
                  </button>
                  <div className="workflow-note">
                    This immutable revision is listed for eligible project
                    approvers. Authors do not see their own submissions in that
                    queue.
                  </div>
                </>
              )}
              {release.status.toUpperCase() === "PUBLISHED" && (
                <p className="workflow-note">
                  This release is marked published. Snapshot changes are managed
                  by the publishing API.
                </p>
              )}
            </section>
            <ReadyToPublish
              releaseId={release.id}
              compact
              onPublished={onUpdated}
            />
            <section className="section-block approval-panel">
              <div className="section-heading">
                <div>
                  <h2>Review a public revision</h2>
                  <p>Open the review desk to choose a submitted revision.</p>
                </div>
              </div>
              <button
                className="button button-secondary button-wide"
                onClick={() => go("reviews")}
              >
                Open review desk
              </button>
              <details className="revision-advanced">
                <summary>Review by revision ID</summary>
                <Field label="Approval revision ID">
                  <input
                    value={revisionId}
                    onChange={(event) => setRevisionId(event.target.value)}
                    placeholder="Paste revision ID"
                  />
                </Field>
                <Field label="Decision note">
                  <textarea
                    value={reviewComment}
                    onChange={(event) => setReviewComment(event.target.value)}
                    rows={3}
                    maxLength={4000}
                    placeholder="Add context for this decision"
                  />
                </Field>
                <div className="decision-controls">
                  <select
                    aria-label="Review action"
                    value={decision}
                    onChange={(event) =>
                      setDecision(event.target.value as typeof decision)
                    }
                  >
                    <option value="approve">Approve</option>
                    <option value="reject">Reject</option>
                    <option value="publish">Publish approved</option>
                  </select>
                  <button
                    className="button button-secondary"
                    disabled={saving || !revisionId.trim()}
                    onClick={() =>
                      void action(
                        decision === "publish"
                          ? `${reviewPath}/publish`
                          : `${reviewPath}/${decision}`,
                        decision === "publish" ? "POST" : "PATCH",
                        decision === "publish"
                          ? undefined
                          : { comment: reviewComment },
                        decision === "approve"
                          ? "Revision approved."
                          : decision === "reject"
                            ? "Revision rejected."
                            : "Approved revision published.",
                      )
                    }
                  >
                    {saving ? "Saving…" : "Apply"}
                  </button>
                </div>
              </details>
              <p className="workflow-note">
                Approval is enforced by the server, including approver role
                checks and author separation.
              </p>
            </section>
            {release.deployments?.length ? (
              <section className="section-block">
                <div className="section-heading">
                  <div>
                    <h2>Deployments</h2>
                    <p>Environment records attached to this release</p>
                  </div>
                </div>
                <div className="deployment-list">
                  {release.deployments.map((deployment) => (
                    <div key={deployment.id}>
                      <strong>
                        {deployment.environment?.name ?? "Environment"}
                      </strong>
                      <Status value={deployment.status ?? "unknown"} />
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </aside>
        </div>
      </div>
      <div
        role="tabpanel"
        id="release-panel-details"
        aria-labelledby="release-tab-details"
        hidden={releaseSection !== "details"}
        tabIndex={0}
      >
        <ReleaseAdminTools
          projectId={project.id}
          release={release}
          releases={releases}
          onUpdated={onUpdated}
          onArchived={onArchived}
        />
      </div>
      <div
        role="tabpanel"
        id="release-panel-deployments"
        aria-labelledby="release-tab-deployments"
        hidden={releaseSection !== "deployments"}
        tabIndex={0}
      >
        <DeploymentOrchestrationPanel
          projectId={project.id}
          releaseId={release.id}
        />
      </div>
      <div
        role="tabpanel"
        id="release-panel-content"
        aria-labelledby="release-tab-content"
        hidden={releaseSection !== "content"}
        tabIndex={0}
      >
        <ReleaseContentPanel projectId={project.id} releaseId={release.id} />
        <ClientReleaseAudienceSelector
          projectId={project.id}
          releaseId={release.id}
          onSaved={() => void onUpdated()}
        />
      </div>
    </>
  );
}

function ReviewsPage({
  releases,
}: {
  releases: Array<Release & { project: Project }>;
}) {
  const [revisions, setRevisions] = useState<ApprovalRevision[]>([]);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [workingId, setWorkingId] = useState("");
  const [queueError, setQueueError] = useState("");
  const [queueNotice, setQueueNotice] = useState("");

  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);
    setQueueError("");
    try {
      const result = await adminApi.listApprovalRevisions<ApprovalRevision[]>();
      setRevisions(result);
    } catch (error) {
      setQueueError(messageFor(error));
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  async function decide(
    revision: ApprovalRevision,
    decision: "approve" | "reject",
  ) {
    setWorkingId(revision.id);
    setQueueError("");
    setQueueNotice("");
    try {
      const comment = comments[revision.id]?.trim();
      const body = comment ? { comment } : {};
      if (decision === "approve")
        await adminApi.approveRevision(revision.releaseId, revision.id, body);
      else await adminApi.rejectRevision(revision.releaseId, revision.id, body);
      setQueueNotice(
        `Revision ${revision.revision} ${decision === "approve" ? "approved" : "rejected"}.`,
      );
      await loadQueue();
    } catch (error) {
      setQueueError(messageFor(error));
    } finally {
      setWorkingId("");
    }
  }

  const internalReviews = releases.filter((item) =>
    item.status.toLowerCase().includes("review"),
  );
  return (
    <>
      <PageHeading
        title="Review desk"
        description="Review immutable public release revisions assigned to your approver projects."
      />
      <ReadyToPublish />
      <section
        className="section-block approval-queue"
        aria-labelledby="pending-approvals-heading"
      >
        <div className="section-heading">
          <div>
            <h2 id="pending-approvals-heading">Pending public revisions</h2>
            <p>
              {revisions.length} exact revision
              {revisions.length === 1 ? "" : "s"} awaiting a decision
            </p>
          </div>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void loadQueue()}
            disabled={loadingQueue}
          >
            Refresh queue
          </button>
        </div>
        {queueError && (
          <p className="error-copy" role="alert">
            {queueError}
          </p>
        )}
        {queueNotice && (
          <p className="success-copy" aria-live="polite">
            {queueNotice}
          </p>
        )}
        {loadingQueue ? (
          <Loading label="Loading pending revisions" />
        ) : revisions.length ? (
          <div className="approval-revision-list">
            {revisions.map((revision) => (
              <article className="approval-revision" key={revision.id}>
                <header className="approval-revision-header">
                  <div>
                    <span className="type-label">
                      {revision.release.project.name} · /
                      {revision.release.project.slug}
                    </span>
                    <h3>
                      {revision.content.version} · {revision.content.title}
                    </h3>
                    <p>
                      Revision {revision.revision} · submitted{" "}
                      {dateLabel(revision.createdAt)}
                    </p>
                  </div>
                  <Status value={revision.status} />
                </header>
                <div className="revision-summary">
                  <span>
                    Release record{" "}
                    <strong>
                      {revision.release.version} · {revision.release.title}
                    </strong>
                  </span>
                  <span>
                    Content hash <code>{revision.contentHash}</code>
                  </span>
                  {revision.content.releaseDate && (
                    <span>
                      Release date{" "}
                      <strong>{dateLabel(revision.content.releaseDate)}</strong>
                    </span>
                  )}
                </div>
                {revision.content.summary && (
                  <p className="revision-public-summary">
                    {revision.content.summary}
                  </p>
                )}
                <section
                  className="revision-changes"
                  aria-label={`Immutable public content for revision ${revision.revision}`}
                >
                  <h4>Exact public content</h4>
                  {revision.content.changes.length ? (
                    <ol>
                      {[...revision.content.changes]
                        .sort((a, b) => a.sortOrder - b.sortOrder)
                        .map((change, index) => (
                          <li key={`${change.sortOrder}-${index}`}>
                            <span className="type-label">
                              {change.category
                                .replaceAll("_", " ")
                                .toLowerCase()}
                            </span>
                            <strong>{change.title}</strong>
                            <p>{change.description}</p>
                          </li>
                        ))}
                    </ol>
                  ) : (
                    <p className="inline-empty">
                      This revision contains no public changes.
                    </p>
                  )}
                </section>
                <section
                  className="decision-history"
                  aria-label={`Decision history for revision ${revision.revision}`}
                >
                  <h4>Decision history</h4>
                  {revision.decisions.length ? (
                    <ol>
                      {revision.decisions.map((decision) => (
                        <li key={decision.id}>
                          <strong>{decision.status}</strong>
                          <span>{decision.comment || "No comment"}</span>
                          <time dateTime={decision.createdAt}>
                            {dateLabel(decision.createdAt)}
                          </time>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="inline-empty">No decisions recorded yet.</p>
                  )}
                </section>
                <label className="field decision-comment">
                  <span>
                    Decision comment <small>Optional</small>
                  </span>
                  <textarea
                    rows={2}
                    maxLength={4000}
                    value={comments[revision.id] ?? ""}
                    onChange={(event) =>
                      setComments((current) => ({
                        ...current,
                        [revision.id]: event.target.value,
                      }))
                    }
                  />
                </label>
                <div className="form-actions">
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={Boolean(workingId)}
                    onClick={() => void decide(revision, "approve")}
                  >
                    {workingId === revision.id
                      ? "Saving…"
                      : "Approve this revision"}
                  </button>
                  <button
                    className="button button-danger"
                    type="button"
                    disabled={Boolean(workingId)}
                    onClick={() => void decide(revision, "reject")}
                  >
                    Reject this revision
                  </button>
                  <span className="workflow-note">
                    Decision applies to revision ID <code>{revision.id}</code>.
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No pending public revisions"
            detail="Revisions submitted for public approval will appear here when they are in your approver projects."
          />
        )}
      </section>
      {internalReviews.length ? (
        <section className="section-block">
          <div className="section-heading">
            <div>
              <h2>Internal release review</h2>
              <p>{internalReviews.length} release records in internal review</p>
            </div>
          </div>
          <ReleaseTable releases={internalReviews} />
        </section>
      ) : null}
    </>
  );
}

function SearchPage() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [results, setResults] = useState({
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
  } as ReturnType<typeof normalizeSearchResponse>);
  const [loadingResults, setLoadingResults] = useState(false);
  const [searchError, setSearchError] = useState("");
  const term = query.trim();

  useEffect(() => {
    let active = true;
    if (term.length < 2) {
      setResults({ items: [], page: 1, pageSize: 20, total: 0 });
      setSearchError("");
      setLoadingResults(false);
      return () => {
        active = false;
      };
    }
    setLoadingResults(true);
    setSearchError("");
    const timer = window.setTimeout(() => {
      void adminApi
        .search(term, page, 20)
        .then((payload) => {
          if (active) setResults(normalizeSearchResponse(payload));
        })
        .catch((error) => {
          if (active) setSearchError(messageFor(error));
        })
        .finally(() => {
          if (active) setLoadingResults(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [term, page]);

  const pageCount =
    results.pageCount ??
    Math.max(1, Math.ceil(results.total / results.pageSize));
  return (
    <>
      <PageHeading
        title="Search"
        description="Search projects, releases, changes, and release documents you are authorized to access."
      />
      <label className="search-field search-main" htmlFor="workspace-search">
        <Icon name="search" />
        <input
          id="workspace-search"
          name="q"
          autoComplete="off"
          aria-label="Search projects, releases, changes, and release documents"
          placeholder="Search titles or terms…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
        />
        <kbd>/</kbd>
      </label>
      <div aria-live="polite" className="search-status">
        {term.length === 1 && <p>Enter at least two characters to search.</p>}
        {loadingResults && <p>Searching accessible project records…</p>}
        {searchError && (
          <p className="error-copy" role="alert">
            {searchError}
          </p>
        )}
      </div>
      {term.length > 1 &&
        !loadingResults &&
        !searchError &&
        (results.items.length ? (
          <>
            <div className="search-results">
              {results.items.map((item, index) => {
                const path = searchResultPath(item);
                const kind = item.type.toLowerCase();
                const heading =
                  item.title ??
                  item.release?.title ??
                  item.name ??
                  item.version ??
                  "Search result";
                const projectName = item.projectName ?? item.project?.name;
                const details =
                  kind === "project"
                    ? `Project · /${item.slug ?? item.projectSlug ?? ""}`
                    : kind === "release"
                      ? `${projectName ?? "Project"} · Release ${item.version ?? item.release?.version ?? ""}`
                      : kind === "document"
                        ? `${projectName ?? "Project"} · Release ${item.version ?? ""} · ${item.section ?? "Document"}`
                        : `${projectName ?? "Project"} · Change${item.release?.version ? ` · ${item.release.version}` : ""}`;
                return path ? (
                  <button
                    key={`${kind}-${item.id}-${index}`}
                    onClick={() => go(path)}
                  >
                    <span className="tile-initial">
                      {kind === "project"
                        ? (item.name ?? heading).slice(0, 1).toUpperCase()
                        : kind === "release"
                          ? "R"
                          : kind === "document"
                            ? "D"
                            : "C"}
                    </span>
                    <span>
                      <strong>{heading}</strong>
                      <small>
                        {details}
                        {item.snippet
                          ? ` · ${item.snippet}`
                          : item.description
                            ? ` · ${item.description}`
                            : ""}
                      </small>
                    </span>
                    <Icon name="chevron" />
                  </button>
                ) : (
                  <div
                    className="search-result-static"
                    key={`${kind}-${item.id}-${index}`}
                  >
                    <strong>{heading}</strong>
                    <small>{kind} result is missing navigation context.</small>
                  </div>
                );
              })}
            </div>
            <div className="search-pagination" aria-label="Search result pages">
              <span>
                {results.total} results · Page {results.page} of {pageCount}
              </span>
              <button
                className="button button-secondary"
                type="button"
                disabled={page <= 1 || loadingResults}
                onClick={() => setPage((current) => current - 1)}
              >
                Previous
              </button>
              <button
                className="button button-secondary"
                type="button"
                disabled={page >= pageCount || loadingResults}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </button>
            </div>
          </>
        ) : (
          <EmptyState
            title="No results"
            detail="Try another name, release version, or change description."
          />
        ))}
    </>
  );
}

function AdminApp() {
  const [token, setToken] = useState(() =>
    window.sessionStorage.getItem(tokenKey),
  );
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(
    Boolean(window.sessionStorage.getItem(tokenKey)),
  );
  const signOut = useCallback(() => {
    void api
      .request("/internal/auth/logout", { method: "POST" })
      .catch(() => undefined);
    window.sessionStorage.removeItem(tokenKey);
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    if (!token) {
      setChecking(false);
      return;
    }
    let active = true;
    api
      .request<User>("/internal/auth/me")
      .then((result) => {
        if (active) setUser(result);
      })
      .catch(() => {
        if (active) {
          window.sessionStorage.removeItem(tokenKey);
          setToken(null);
          setUser(null);
        }
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  function authenticate(nextToken: string, nextUser: User) {
    window.sessionStorage.setItem(tokenKey, nextToken);
    setToken(nextToken);
    setUser(nextUser);
    go("overview");
  }

  // One-time invitation and password links always show their form, even in
  // a tab that is already signed in (completing one signs in as that user).
  const linkRoute = /^#\/(accept-invitation|reset-password)\?/.test(
    window.location.hash,
  );
  if (linkRoute) return <AuthScreen onAuthenticated={authenticate} />;
  if (checking) return <Loading label="Checking your session" />;
  if (!token || !user) return <AuthScreen onAuthenticated={authenticate} />;
  return <WorkspaceApp user={user} onSignOut={signOut} />;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AdminApp />
  </React.StrictMode>,
);
