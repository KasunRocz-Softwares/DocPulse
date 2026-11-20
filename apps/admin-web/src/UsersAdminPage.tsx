import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { ApiError } from "./api-client";
import "./users-admin.css";

type Role = "ADMIN" | "RELEASE_MANAGER" | "DEVELOPER" | "REVIEWER" | "CLIENT";
type Status = "ACTIVE" | "INVITED" | "SUSPENDED";

export type WorkspaceUser = {
  id: string;
  email: string;
  displayName: string;
  status: Status;
  isSystemAdmin: boolean;
  createdAt: string;
  hasPassword: boolean;
  signInMethods: string[];
  activeSessions: number;
  lastActiveAt: string | null;
  pendingPasswordLinkExpiresAt: string | null;
  memberships: Array<{
    id: string;
    role: Role;
    project: { id: string; name: string; slug: string };
  }>;
};

type ProjectOption = { id: string; name: string; slug: string };

const ROLES: Array<{ id: Role; label: string; summary: string }> = [
  {
    id: "ADMIN",
    label: "Admin",
    summary: "Full control of the project, its settings, and its people.",
  },
  {
    id: "RELEASE_MANAGER",
    label: "Release manager",
    summary: "Runs releases end to end, including approval and publishing.",
  },
  {
    id: "DEVELOPER",
    label: "Developer",
    summary: "Writes releases and changes and asks for public approval.",
  },
  {
    id: "REVIEWER",
    label: "Reviewer",
    summary: "Reads releases and approves or rejects public revisions.",
  },
  {
    id: "CLIENT",
    label: "Client",
    summary: "Sees only the release notes shared with their client group.",
  },
];
const roleLabel = (role: Role) =>
  ROLES.find((item) => item.id === role)?.label ?? role;

/** What each role may do; mirrors the API's role checks. */
const PERMISSIONS: Array<{
  capability: string;
  detail?: string;
  roles: Array<Role | "SYSTEM">;
}> = [
  {
    capability: "Manage workspace users and system administrators",
    detail: "This page.",
    roles: ["SYSTEM"],
  },
  {
    capability: "Create projects",
    roles: ["SYSTEM"],
  },
  {
    capability: "Manage project settings, members, branding, and public page",
    roles: ["SYSTEM", "ADMIN"],
  },
  {
    capability: "View internal releases, changes, and documents",
    roles: ["SYSTEM", "ADMIN", "RELEASE_MANAGER", "DEVELOPER", "REVIEWER"],
  },
  {
    capability: "Create and edit releases and changes",
    roles: ["SYSTEM", "ADMIN", "RELEASE_MANAGER", "DEVELOPER"],
  },
  {
    capability: "Submit for review and request public approval",
    roles: ["SYSTEM", "ADMIN", "RELEASE_MANAGER", "DEVELOPER"],
  },
  {
    capability: "Approve or reject a public revision",
    detail: "Never your own revision — a second person must approve.",
    roles: ["SYSTEM", "ADMIN", "RELEASE_MANAGER", "REVIEWER"],
  },
  {
    capability: "Publish and unpublish approved releases",
    roles: ["SYSTEM", "ADMIN", "RELEASE_MANAGER"],
  },
  {
    capability: "Read release notes shared with their client group",
    detail: "In the client portal on the public site.",
    roles: ["CLIENT"],
  },
];

function messageFor(error: unknown) {
  if (error instanceof ApiError && error.status === 403)
    return "Only system administrators can manage users.";
  return error instanceof Error ? error.message : "Something went wrong.";
}

function relativeTime(value: string | null) {
  if (!value) return "Never";
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(value),
  );
}

function adminOrigin() {
  return `${window.location.origin}${window.location.pathname}`;
}

function CopyLink({
  label,
  link,
  note,
}: {
  label: string;
  link: string;
  note: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="ua-link" role="status">
      <p>
        <strong>{label}</strong> {note}
      </p>
      <div className="ua-link-row">
        <input
          readOnly
          value={link}
          aria-label={label}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          type="button"
          className="button button-secondary"
          onClick={() =>
            void navigator.clipboard
              .writeText(link)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`ua-status ua-status-${status.toLowerCase()}`}>
      <i aria-hidden="true" />
      {status === "ACTIVE"
        ? "Active"
        : status === "INVITED"
          ? "Invited"
          : "Suspended"}
    </span>
  );
}

function Avatar({
  user,
}: {
  user: Pick<WorkspaceUser, "displayName" | "email">;
}) {
  const source = user.displayName.trim() || user.email;
  return (
    <span className="ua-avatar" aria-hidden="true">
      {source.slice(0, 1).toUpperCase()}
    </span>
  );
}

function UserPanel({
  user,
  currentUserId,
  projects,
  onChanged,
  onClose,
}: {
  user: WorkspaceUser;
  currentUserId: string;
  projects: ProjectOption[];
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const isSelf = user.id === currentUserId;
  const [name, setName] = useState(user.displayName);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [passwordLink, setPasswordLink] = useState<{
    link: string;
    expiresAt: string;
  } | null>(null);
  const [inviteLink, setInviteLink] = useState("");
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [addProject, setAddProject] = useState("");
  const [addRole, setAddRole] = useState<Role>("DEVELOPER");

  useEffect(() => {
    setName(user.displayName);
    setPasswordLink(null);
    setInviteLink("");
    setConfirmSuspend(false);
    setError("");
    setNotice("");
  }, [user.id, user.displayName]);

  async function run(key: string, work: () => Promise<void>, success: string) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await work();
      setNotice(success);
      await onChanged();
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy("");
    }
  }

  const patch = (body: Record<string, unknown>) =>
    api.request(`/internal/users/${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      body,
    });

  const memberProjectIds = new Set(
    user.memberships.map((item) => item.project.id),
  );
  const availableProjects = projects.filter(
    (item) => !memberProjectIds.has(item.id),
  );

  return (
    <aside className="ua-panel" aria-labelledby="ua-panel-title">
      <header className="ua-panel-head">
        <Avatar user={user} />
        <div>
          <h2 id="ua-panel-title">
            {user.displayName}
            {isSelf && <span className="ua-tag">You</span>}
          </h2>
          <p>{user.email}</p>
          <div className="ua-panel-meta">
            <StatusPill status={user.status} />
            {user.isSystemAdmin && (
              <span className="ua-tag ua-tag-admin">System admin</span>
            )}
          </div>
        </div>
        <button
          type="button"
          className="ua-close"
          onClick={onClose}
          aria-label="Close user details"
        >
          ×
        </button>
      </header>

      <div className="ua-feedback" aria-live="polite">
        {error && <p className="notice notice-error">{error}</p>}
        {notice && !error && <p className="notice notice-success">{notice}</p>}
      </div>

      <section className="ua-section" aria-labelledby="ua-profile">
        <h3 id="ua-profile">Profile</h3>
        <form
          className="ua-inline"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void run(
              "name",
              () => patch({ displayName: name }).then(() => undefined),
              "Display name saved.",
            );
          }}
        >
          <label className="field">
            <span>Display name</span>
            <input
              value={name}
              minLength={2}
              maxLength={160}
              required
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            className="button button-secondary"
            disabled={busy !== "" || name.trim() === user.displayName}
          >
            Save
          </button>
        </form>
        <dl className="ua-facts">
          <div>
            <dt>Sign-in</dt>
            <dd>
              {user.signInMethods.length
                ? user.signInMethods
                    .map((method) =>
                      method === "password" ? "Password" : `SSO (${method})`,
                    )
                    .join(", ")
                : "No password yet"}
            </dd>
          </div>
          <div>
            <dt>Last active</dt>
            <dd>{relativeTime(user.lastActiveAt)}</dd>
          </div>
          <div>
            <dt>Active sessions</dt>
            <dd>{user.activeSessions}</dd>
          </div>
        </dl>
      </section>

      <section className="ua-section" aria-labelledby="ua-password">
        <h3 id="ua-password">
          {user.hasPassword ? "Password" : "Set up sign-in"}
        </h3>
        <p className="ua-hint">
          {user.hasPassword
            ? "Create a one-time link the user opens to choose a new password. It works for 24 hours; using it signs them out everywhere else."
            : "This person hasn't chosen a password yet. Create a one-time link so they can set one and sign in."}
          {user.pendingPasswordLinkExpiresAt &&
            ` A link is already pending until ${new Intl.DateTimeFormat(undefined, { timeStyle: "short", dateStyle: "medium" }).format(new Date(user.pendingPasswordLinkExpiresAt))}; a new one replaces it.`}
        </p>
        <button
          type="button"
          className="button button-secondary"
          disabled={busy !== "" || user.status === "SUSPENDED"}
          onClick={() =>
            void run(
              "link",
              async () => {
                const result = await api.request<{
                  token: string;
                  expiresAt: string;
                }>(
                  `/internal/users/${encodeURIComponent(user.id)}/password-link`,
                  { method: "POST" },
                );
                setPasswordLink({
                  link: `${adminOrigin()}#/reset-password?token=${encodeURIComponent(result.token)}`,
                  expiresAt: result.expiresAt,
                });
              },
              "Password link created. Share it privately with this person.",
            )
          }
        >
          {busy === "link"
            ? "Creating…"
            : user.hasPassword
              ? "Create password reset link"
              : "Create sign-up link"}
        </button>
        {user.status === "SUSPENDED" && (
          <p className="ua-hint">Reactivate the user first.</p>
        )}
        {passwordLink && (
          <CopyLink
            label="One-time password link"
            link={passwordLink.link}
            note={`Expires ${new Intl.DateTimeFormat(undefined, { timeStyle: "short", dateStyle: "medium" }).format(new Date(passwordLink.expiresAt))}. It is shown only once.`}
          />
        )}
      </section>

      <section className="ua-section" aria-labelledby="ua-projects">
        <h3 id="ua-projects">Project roles</h3>
        {user.isSystemAdmin && (
          <p className="ua-hint">
            System administrators can act as Admin on every project, whatever is
            listed here.
          </p>
        )}
        {user.memberships.length ? (
          <ul className="ua-memberships">
            {user.memberships.map((membership) => (
              <li key={membership.id}>
                <div>
                  <strong>{membership.project.name}</strong>
                  <small>/{membership.project.slug}</small>
                </div>
                <label className="sr-only" htmlFor={`ua-role-${membership.id}`}>
                  Role in {membership.project.name}
                </label>
                <select
                  id={`ua-role-${membership.id}`}
                  value={membership.role}
                  disabled={busy !== ""}
                  onChange={(event) =>
                    void run(
                      `role-${membership.id}`,
                      () =>
                        api
                          .request(
                            `/internal/projects/${encodeURIComponent(membership.project.id)}/members/${encodeURIComponent(membership.id)}`,
                            {
                              method: "PATCH",
                              body: { role: event.target.value },
                            },
                          )
                          .then(() => undefined),
                      `Role in ${membership.project.name} updated.`,
                    )
                  }
                >
                  {ROLES.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="button button-quiet ua-danger-text"
                  disabled={busy !== ""}
                  onClick={() =>
                    void run(
                      `remove-${membership.id}`,
                      () =>
                        api
                          .request(
                            `/internal/projects/${encodeURIComponent(membership.project.id)}/members/${encodeURIComponent(membership.id)}`,
                            { method: "DELETE" },
                          )
                          .then(() => undefined),
                      `Removed from ${membership.project.name}.`,
                    )
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ua-hint">Not a member of any project.</p>
        )}
        {availableProjects.length > 0 && (
          <form
            className="ua-add-project"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              const project = projects.find((item) => item.id === addProject);
              if (!project) return;
              void run(
                "add",
                async () => {
                  const result = await api.request<{
                    invitationToken?: string;
                  }>(
                    `/internal/projects/${encodeURIComponent(project.id)}/members`,
                    {
                      method: "POST",
                      body: {
                        email: user.email,
                        displayName: user.displayName,
                        role: addRole,
                      },
                    },
                  );
                  if (result.invitationToken)
                    setInviteLink(
                      `${adminOrigin()}#/accept-invitation?token=${encodeURIComponent(result.invitationToken)}`,
                    );
                  setAddProject("");
                },
                `Added to ${project.name} as ${roleLabel(addRole)}.`,
              );
            }}
          >
            <label className="field">
              <span>Add to project</span>
              <select
                value={addProject}
                required
                onChange={(e) => setAddProject(e.target.value)}
              >
                <option value="">Choose a project…</option>
                {availableProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Role</span>
              <select
                value={addRole}
                onChange={(e) => setAddRole(e.target.value as Role)}
              >
                {ROLES.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button button-secondary"
              disabled={busy !== "" || !addProject}
            >
              Add
            </button>
          </form>
        )}
        {inviteLink && (
          <CopyLink
            label="Invitation link"
            link={inviteLink}
            note="Expires in 7 days. It is shown only once."
          />
        )}
      </section>

      <section className="ua-section" aria-labelledby="ua-access">
        <h3 id="ua-access">Workspace access</h3>
        <label className="ua-toggle">
          <input
            type="checkbox"
            checked={user.isSystemAdmin}
            disabled={isSelf || busy !== ""}
            onChange={(event) =>
              void run(
                "admin",
                () =>
                  patch({ isSystemAdmin: event.target.checked }).then(
                    () => undefined,
                  ),
                event.target.checked
                  ? "System administrator access granted."
                  : "System administrator access removed.",
              )
            }
          />
          <span>
            <strong>System administrator</strong>
            <small>
              Manages users and can act as Admin on every project.
              {isSelf && " You can't change your own access."}
            </small>
          </span>
        </label>
        {user.status === "SUSPENDED" ? (
          <button
            type="button"
            className="button button-secondary"
            disabled={busy !== ""}
            onClick={() =>
              void run(
                "status",
                () => patch({ status: "ACTIVE" }).then(() => undefined),
                "User reactivated.",
              )
            }
          >
            Reactivate user
          </button>
        ) : confirmSuspend ? (
          <div
            className="ua-confirm"
            role="group"
            aria-label="Confirm suspension"
          >
            <p>
              Suspend <strong>{user.displayName}</strong>? They are signed out
              immediately and can't sign in until reactivated. Their project
              roles are kept.
            </p>
            <div>
              <button
                type="button"
                className="button button-danger"
                disabled={busy !== ""}
                onClick={() =>
                  void run(
                    "status",
                    () => patch({ status: "SUSPENDED" }).then(() => undefined),
                    "User suspended.",
                  )
                }
              >
                Suspend user
              </button>
              <button
                type="button"
                className="button button-quiet"
                onClick={() => setConfirmSuspend(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="button button-quiet ua-danger-text"
            disabled={isSelf || busy !== ""}
            onClick={() => setConfirmSuspend(true)}
            title={isSelf ? "You can't suspend yourself" : undefined}
          >
            Suspend user…
          </button>
        )}
      </section>
    </aside>
  );
}

function InvitePanel({
  projects,
  onInvited,
  onClose,
}: {
  projects: ProjectOption[];
  onInvited: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [added, setAdded] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const projectId = String(form.get("projectId") ?? "");
    const email = String(form.get("email") ?? "").trim();
    setBusy(true);
    setError("");
    setLink("");
    try {
      const result = await api.request<{ invitationToken?: string }>(
        `/internal/projects/${encodeURIComponent(projectId)}/members`,
        {
          method: "POST",
          body: {
            email,
            displayName:
              String(form.get("displayName") ?? "").trim() || undefined,
            role: form.get("role"),
          },
        },
      );
      setLink(
        result.invitationToken
          ? `${adminOrigin()}#/accept-invitation?token=${encodeURIComponent(result.invitationToken)}`
          : "",
      );
      setAdded(
        result.invitationToken
          ? `${email} was invited.`
          : `${email} already has an account and was added to the project.`,
      );
      event.currentTarget.reset();
      await onInvited();
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="ua-panel" aria-labelledby="ua-invite-title">
      <header className="ua-panel-head">
        <div>
          <h2 id="ua-invite-title">Invite a person</h2>
          <p>
            Invitations give access to one project. Add more projects from their
            profile later.
          </p>
        </div>
        <button
          type="button"
          className="ua-close"
          onClick={onClose}
          aria-label="Close invite form"
        >
          ×
        </button>
      </header>
      {projects.length === 0 ? (
        <p className="ua-hint">
          Create a project first — people are invited into a project.
        </p>
      ) : (
        <form className="ua-invite-form" onSubmit={submit}>
          <label className="field">
            <span>Work email</span>
            <input
              name="email"
              type="email"
              required
              maxLength={320}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>Display name</span>
            <input name="displayName" maxLength={160} autoComplete="off" />
          </label>
          <label className="field">
            <span>Project</span>
            <select name="projectId" required defaultValue={projects[0]?.id}>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Role</span>
            <select name="role" defaultValue="DEVELOPER">
              {ROLES.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.label} — {role.summary}
                </option>
              ))}
            </select>
          </label>
          {error && <p className="notice notice-error">{error}</p>}
          {added && !error && <p className="notice notice-success">{added}</p>}
          <button className="button button-primary" disabled={busy}>
            {busy ? "Inviting…" : "Send invitation"}
          </button>
        </form>
      )}
      {link && (
        <CopyLink
          label="Invitation link"
          link={link}
          note="Email isn't configured, so share this one-time link yourself. It expires in 7 days."
        />
      )}
    </aside>
  );
}

function RolesMatrix() {
  const columns: Array<{ id: Role | "SYSTEM"; label: string }> = [
    { id: "SYSTEM", label: "System admin" },
    ...ROLES.map((role) => ({ id: role.id, label: role.label })),
  ];
  return (
    <section className="ua-roles" aria-labelledby="ua-roles-title">
      <div className="section-heading">
        <div>
          <h2 id="ua-roles-title">Role permissions</h2>
          <p>
            Roles are given per project. System administrators sit above
            projects. Every action is checked by the API, not just hidden in the
            interface.
          </p>
        </div>
      </div>
      <div className="ua-role-cards">
        {ROLES.map((role) => (
          <article key={role.id}>
            <h3>{role.label}</h3>
            <p>{role.summary}</p>
          </article>
        ))}
      </div>
      <div className="table-wrap">
        <table className="ua-matrix">
          <caption className="sr-only">What each role can do</caption>
          <thead>
            <tr>
              <th scope="col">Capability</th>
              {columns.map((column) => (
                <th key={column.id} scope="col">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((row) => (
              <tr key={row.capability}>
                <th scope="row">
                  {row.capability}
                  {row.detail && <small>{row.detail}</small>}
                </th>
                {columns.map((column) => {
                  const allowed = row.roles.includes(column.id);
                  return (
                    <td key={column.id} data-allowed={allowed || undefined}>
                      <span aria-hidden="true">{allowed ? "✓" : "—"}</span>
                      <span className="sr-only">
                        {allowed ? "Allowed" : "Not allowed"}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function UsersAdminPage({
  currentUser,
  projects,
}: {
  currentUser: { id: string; isSystemAdmin: boolean };
  projects: ProjectOption[];
}) {
  const [tab, setTab] = useState<"users" | "roles">("users");
  const [users, setUsers] = useState<WorkspaceUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"" | Status | "ADMINS">("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api.request<WorkspaceUser[]>("/internal/users");
      setUsers(result);
      setError("");
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentUser.isSystemAdmin) void load();
    else setLoading(false);
  }, [currentUser.isSystemAdmin, load]);

  const counts = useMemo(
    () => ({
      all: users.length,
      ACTIVE: users.filter((user) => user.status === "ACTIVE").length,
      INVITED: users.filter((user) => user.status === "INVITED").length,
      SUSPENDED: users.filter((user) => user.status === "SUSPENDED").length,
      ADMINS: users.filter((user) => user.isSystemAdmin).length,
    }),
    [users],
  );
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return users.filter(
      (user) =>
        (!status ||
          (status === "ADMINS"
            ? user.isSystemAdmin
            : user.status === status)) &&
        (!term ||
          `${user.displayName} ${user.email} ${user.memberships.map((m) => m.project.name).join(" ")}`
            .toLowerCase()
            .includes(term)),
    );
  }, [users, query, status]);
  const selected = users.find((user) => user.id === selectedId) ?? null;

  if (!currentUser.isSystemAdmin)
    return (
      <div className="empty-state">
        <h3>System administrators only</h3>
        <p>
          Ask a system administrator to change workspace users or roles. Project
          admins can manage members under each project's Settings tab.
        </p>
      </div>
    );

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Users &amp; roles</h1>
          <p>
            Everyone with access to this workspace, their project roles, and
            what each role can do.
          </p>
        </div>
        <button
          type="button"
          className="button button-primary"
          onClick={() => {
            setInviting(true);
            setSelectedId(null);
            setTab("users");
          }}
        >
          + Invite person
        </button>
      </div>

      <div
        className="page-tabs"
        role="tablist"
        aria-label="Users and roles sections"
      >
        {(
          [
            ["users", "Users", counts.all],
            ["roles", "Role permissions", null],
          ] as const
        ).map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
            {count !== null && <span className="tab-count">{count}</span>}
          </button>
        ))}
      </div>

      {tab === "roles" ? (
        <RolesMatrix />
      ) : (
        <div
          className="ua-layout"
          data-panel={selected || inviting ? "open" : undefined}
        >
          <section className="ua-list" aria-label="Workspace users">
            <div className="ua-toolbar">
              <div
                className="ua-filters"
                role="group"
                aria-label="Filter by status"
              >
                {(
                  [
                    ["", "All", counts.all],
                    ["ACTIVE", "Active", counts.ACTIVE],
                    ["INVITED", "Invited", counts.INVITED],
                    ["SUSPENDED", "Suspended", counts.SUSPENDED],
                    ["ADMINS", "System admins", counts.ADMINS],
                  ] as const
                ).map(([id, label, count]) => (
                  <button
                    key={id || "all"}
                    type="button"
                    aria-pressed={status === id}
                    onClick={() => setStatus(id)}
                  >
                    {label} <span>{count}</span>
                  </button>
                ))}
              </div>
              <label className="ua-search">
                <span className="sr-only">Search users</span>
                <input
                  type="search"
                  placeholder="Search name, email, or project"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
            </div>
            {error && <p className="notice notice-error">{error}</p>}
            {loading ? (
              <div className="loading-state" role="status">
                <span className="spinner" aria-hidden="true" /> Loading users
              </div>
            ) : visible.length === 0 ? (
              <div className="empty-state">
                <h3>No users match</h3>
                <p>Try another search or filter.</p>
              </div>
            ) : (
              <ul className="ua-rows">
                {visible.map((user) => (
                  <li key={user.id}>
                    <button
                      type="button"
                      className="ua-row"
                      aria-current={selectedId === user.id ? "true" : undefined}
                      onClick={() => {
                        setSelectedId(user.id);
                        setInviting(false);
                      }}
                    >
                      <Avatar user={user} />
                      <span className="ua-row-main">
                        <strong>
                          {user.displayName}
                          {user.id === currentUser.id && (
                            <span className="ua-tag">You</span>
                          )}
                          {user.isSystemAdmin && (
                            <span className="ua-tag ua-tag-admin">
                              System admin
                            </span>
                          )}
                        </strong>
                        <small>{user.email}</small>
                      </span>
                      <span className="ua-row-projects">
                        {user.memberships.slice(0, 2).map((membership) => (
                          <span key={membership.id} className="ua-chip">
                            {membership.project.name} ·{" "}
                            {roleLabel(membership.role)}
                          </span>
                        ))}
                        {user.memberships.length > 2 && (
                          <span className="ua-chip ua-chip-more">
                            +{user.memberships.length - 2}
                          </span>
                        )}
                        {user.memberships.length === 0 && (
                          <span className="ua-muted">No projects</span>
                        )}
                      </span>
                      <StatusPill status={user.status} />
                      <span className="ua-row-time">
                        {relativeTime(user.lastActiveAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {inviting ? (
            <InvitePanel
              projects={projects}
              onInvited={load}
              onClose={() => setInviting(false)}
            />
          ) : selected ? (
            <UserPanel
              user={selected}
              currentUserId={currentUser.id}
              projects={projects}
              onChanged={load}
              onClose={() => setSelectedId(null)}
            />
          ) : null}
        </div>
      )}
    </>
  );
}
