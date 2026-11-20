import { FormEvent, useEffect, useState } from "react";
import { adminApi } from "./api";
import { ProjectRole } from "./admin-api";
import { CustomDomainPanel } from "./CustomDomainPanel";
import { AnalyticsExportPanel } from "./AnalyticsExportPanel";
import { ClientAudienceAdmin } from "./ClientAudienceAdmin";
import { IntegrationOperationsPanel } from "./IntegrationOperationsPanel";
import { IntegrationSuggestionsPanel } from "./IntegrationSuggestionsPanel";
import { GitHubAppInstallationsPanel } from "./GitHubAppInstallationsPanel";

type Project = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  status?: string;
};
type Member = {
  id: string;
  role: ProjectRole;
  user: { email: string; displayName: string; status: string };
};
type Repository = {
  id: string;
  provider: string;
  owner: string;
  name: string;
  externalId?: string | null;
};
type Environment = {
  id: string;
  name: string;
  label?: string | null;
  enabled: boolean;
};
type Brand = {
  primaryColor: string;
  accentColor: string | null;
  logoUrl: string | null;
  defaultLocale: string;
};
type AuditPage = {
  items: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId?: string | null;
    createdAt: string;
    actor?: { email: string; displayName: string } | null;
    metadata?: unknown;
  }>;
  page: number;
  pageSize: number;
  total: number;
};

const roles: ProjectRole[] = [
  "ADMIN",
  "RELEASE_MANAGER",
  "DEVELOPER",
  "REVIEWER",
  "CLIENT",
];
const messageFor = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The request could not be completed.";
const dateTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export function ProjectAdminPanel({
  project,
  onProjectUpdated,
}: {
  project: Project;
  onProjectUpdated: (next: Project) => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [publishedReleases, setPublishedReleases] = useState<
    Array<{ id: string; version: string; title: string; status: string }>
  >([]);
  const [audit, setAudit] = useState<AuditPage | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [invitationLink, setInvitationLink] = useState("");
  const [working, setWorking] = useState(false);
  const brandValues: Brand = brand ?? {
    primaryColor: "#2563eb",
    accentColor: null,
    logoUrl: null,
    defaultLocale: "en-US",
  };
  function changeBrand<K extends keyof Brand>(key: K, value: Brand[K]) {
    setBrand((current) => ({ ...(current ?? brandValues), [key]: value }));
  }

  async function load() {
    setError("");
    const results = await Promise.allSettled([
      adminApi.listMembers<Member[]>(project.id),
      adminApi.listRepositories<Repository[]>(project.id),
      adminApi.listEnvironments<Environment[]>(project.id),
      adminApi.listAudit<AuditPage>(project.id),
      adminApi.getBrand<Brand>(project.id),
      adminApi.listProjectReleases<
        Array<{ id: string; version: string; title: string; status: string }>
      >(project.id),
    ]);
    const [
      memberResult,
      repositoryResult,
      environmentResult,
      auditResult,
      brandResult,
      releasesResult,
    ] = results;
    if (memberResult.status === "fulfilled") setMembers(memberResult.value);
    if (repositoryResult.status === "fulfilled")
      setRepositories(repositoryResult.value);
    if (environmentResult.status === "fulfilled")
      setEnvironments(environmentResult.value);
    if (auditResult.status === "fulfilled") setAudit(auditResult.value);
    if (brandResult.status === "fulfilled") setBrand(brandResult.value);
    if (releasesResult.status === "fulfilled")
      setPublishedReleases(releasesResult.value);
    const failures = results.flatMap((result, index) =>
      result.status === "rejected"
        ? [
            `${["Members", "Repositories", "Environments", "Audit history", "Brand settings", "Releases"][index]}: ${messageFor(result.reason)}`,
          ]
        : [],
    );
    setError(failures.join(" "));
  }

  useEffect(() => {
    void load();
    // Fetch again when navigating between projects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  async function run(action: () => Promise<unknown>, success: string) {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      await load();
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setWorking(false);
    }
  }

  async function exportAudit() {
    setError("");
    setNotice("");
    try {
      const { blob, filename } = await adminApi.downloadProjectAudit(
        project.id,
      );
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename || "project-audit.csv";
      link.hidden = true;
      document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
        URL.revokeObjectURL(objectUrl);
      }
      setNotice("Project audit CSV exported.");
    } catch (requestError) {
      setError(messageFor(requestError));
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = {
      name: String(form.get("name") ?? "").trim(),
      description: String(form.get("description") ?? "").trim() || null,
      status: String(form.get("status") ?? "ACTIVE"),
    };
    await run(async () => {
      const updated = await adminApi.updateProject<Project>(project.id, input);
      onProjectUpdated(updated);
    }, "Project profile saved.");
  }

  async function saveBrand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = {
      primaryColor: String(form.get("primaryColor") ?? "").trim(),
      accentColor: String(form.get("accentColor") ?? "").trim() || null,
      logoUrl: String(form.get("logoUrl") ?? "").trim() || null,
      defaultLocale: String(form.get("defaultLocale") ?? "").trim(),
    };
    await run(async () => {
      const updated = await adminApi.updateBrand<Brand>(project.id, input);
      setBrand(updated);
    }, "Brand and localization settings saved.");
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const input = {
      email: String(form.get("email") ?? "").trim(),
      ...(String(form.get("displayName") ?? "").trim()
        ? { displayName: String(form.get("displayName")).trim() }
        : {}),
      role: String(form.get("role") ?? "DEVELOPER") as ProjectRole,
    };
    await run(async () => {
      const result = await adminApi.addMember<{ invitationToken?: string }>(
        project.id,
        input,
      );
      setInvitationLink(
        result.invitationToken
          ? `${window.location.origin}/#/accept-invitation?token=${encodeURIComponent(result.invitationToken)}`
          : "",
      );
      formElement.reset();
    }, "Project member added or updated. New invitations expire in seven days.");
  }

  async function addRepository(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const input = {
      provider: String(form.get("provider") ?? "github"),
      owner: String(form.get("owner") ?? "").trim(),
      name: String(form.get("name") ?? "").trim(),
      ...(String(form.get("externalId") ?? "").trim()
        ? { externalId: String(form.get("externalId")).trim() }
        : {}),
    };
    await run(async () => {
      await adminApi.addRepository(project.id, input);
      formElement.reset();
    }, "Repository connected to the project.");
  }

  return (
    <section className="project-admin" aria-labelledby="project-admin-heading">
      <div className="section-heading">
        <div>
          <h2 id="project-admin-heading">Project administration</h2>
          <p>
            Manage the project profile, access, integrations, environments, and
            history.
          </p>
        </div>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => void load()}
        >
          Refresh settings
        </button>
      </div>
      <div className="admin-feedback" aria-live="polite">
        {error && <p className="error-copy">{error}</p>}
        {notice && <p className="success-copy">{notice}</p>}
      </div>

      <form className="form-panel compact-form" onSubmit={saveProfile}>
        <div className="form-panel-heading">
          <h3>Project profile</h3>
          <p>Update the displayed name, description, and lifecycle status.</p>
        </div>
        <div className="form-grid three">
          <label className="field">
            <span>Project name</span>
            <input
              name="name"
              required
              minLength={2}
              maxLength={160}
              defaultValue={project.name}
            />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea
              name="description"
              rows={2}
              maxLength={2000}
              defaultValue={project.description ?? ""}
            />
          </label>
          <label className="field">
            <span>Status</span>
            <select name="status" defaultValue={project.status ?? "ACTIVE"}>
              <option value="ACTIVE">Active</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </label>
        </div>
        <div className="form-actions">
          <button className="button button-primary" disabled={working}>
            Save project profile
          </button>
        </div>
      </form>

      <form
        className="form-panel compact-form"
        onSubmit={saveBrand}
        aria-labelledby="brand-settings-heading"
      >
        <div className="form-panel-heading">
          <h3 id="brand-settings-heading">Branding and localization</h3>
          <p>Set the project colors, public logo, and default locale.</p>
        </div>
        <div className="form-grid three">
          <label className="field">
            <span>Primary color</span>
            <input
              name="primaryColor"
              required
              pattern="#[0-9A-Fa-f]{6}"
              title="Enter a six-digit hex color, such as #134e4a."
              value={brandValues.primaryColor}
              onChange={(event) =>
                changeBrand("primaryColor", event.target.value)
              }
            />
          </label>
          <label className="field">
            <span>
              Accent color <small>Optional</small>
            </span>
            <input
              name="accentColor"
              pattern="#[0-9A-Fa-f]{6}"
              title="Enter a six-digit hex color or leave empty."
              value={brandValues.accentColor ?? ""}
              onChange={(event) =>
                changeBrand("accentColor", event.target.value || null)
              }
            />
          </label>
          <label className="field">
            <span>
              Logo URL <small>HTTPS only</small>
            </span>
            <input
              name="logoUrl"
              type="url"
              pattern="https://.+"
              title="Use a secure HTTPS URL or leave empty."
              placeholder="https://cdn.example.com/logo.svg"
              value={brandValues.logoUrl ?? ""}
              onChange={(event) =>
                changeBrand("logoUrl", event.target.value || null)
              }
            />
          </label>
          <label className="field">
            <span>Default locale</span>
            <input
              name="defaultLocale"
              required
              maxLength={35}
              placeholder="en-US"
              value={brandValues.defaultLocale}
              onChange={(event) =>
                changeBrand("defaultLocale", event.target.value)
              }
            />
          </label>
        </div>
        <div className="form-actions">
          <button className="button button-primary" disabled={working}>
            Save brand settings
          </button>
          <small>
            Brand changes are permission-checked and audited by the API.
          </small>
        </div>
      </form>

      <CustomDomainPanel projectId={project.id} />
      <AnalyticsExportPanel
        projectId={project.id}
        releases={publishedReleases}
      />
      <IntegrationOperationsPanel projectId={project.id} />
      <IntegrationSuggestionsPanel projectId={project.id} />
      <GitHubAppInstallationsPanel projectId={project.id} />

      <section className="admin-subsection" aria-labelledby="members-heading">
        <div className="section-heading">
          <div>
            <h3 id="members-heading">Project members</h3>
            <p>Assign project roles or remove access.</p>
          </div>
        </div>
        {members.length ? (
          <div className="admin-list" role="list" aria-label="Project members">
            {members.map((member) => (
              <div className="admin-list-row" role="listitem" key={member.id}>
                <div>
                  <strong>
                    {member.user.displayName || member.user.email}
                  </strong>
                  <small>
                    {member.user.email} · {member.user.status.toLowerCase()}
                  </small>
                </div>
                <label className="inline-control">
                  <span className="sr-only">Role for {member.user.email}</span>
                  <select
                    aria-label={`Role for ${member.user.email}`}
                    value={member.role}
                    disabled={working}
                    onChange={(event) =>
                      void run(
                        () =>
                          adminApi.updateMemberRole(
                            project.id,
                            member.id,
                            event.target.value as ProjectRole,
                          ),
                        `Role updated for ${member.user.email}.`,
                      )
                    }
                  >
                    {roles.map((role) => (
                      <option key={role} value={role}>
                        {role.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button button-quiet"
                  type="button"
                  disabled={working}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Remove ${member.user.email} from this project?`,
                      )
                    )
                      void run(
                        () => adminApi.removeMember(project.id, member.id),
                        `Access removed for ${member.user.email}.`,
                      );
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="inline-empty">
            No members are available, or your role cannot list members.
          </p>
        )}
        <form className="form-panel compact-form" onSubmit={addMember}>
          <h4>Add or update a member</h4>
          <div className="form-grid three">
            <label className="field">
              <span>Email</span>
              <input
                name="email"
                type="email"
                required
                maxLength={320}
                autoComplete="email"
              />
            </label>
            <label className="field">
              <span>Display name</span>
              <input name="displayName" maxLength={160} autoComplete="name" />
            </label>
            <label className="field">
              <span>Project role</span>
              <select name="role" defaultValue="DEVELOPER">
                {roles.map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-actions">
            <button className="button button-secondary" disabled={working}>
              Add member
            </button>
            <small>New accounts are marked invited by the API.</small>
          </div>
        </form>
        {invitationLink && (
          <div className="form-panel compact-form" aria-live="polite">
            <h4>Invitation link</h4>
            <p>
              Share this one-time link with the invited teammate. It expires in
              seven days.
            </p>
            <div className="form-actions">
              <input
                aria-label="One-time invitation link"
                readOnly
                value={invitationLink}
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                className="button button-secondary"
                type="button"
                onClick={() =>
                  void navigator.clipboard.writeText(invitationLink)
                }
              >
                Copy invitation link
              </button>
            </div>
          </div>
        )}
      </section>

      <ClientAudienceAdmin projectId={project.id} />

      <section
        className="admin-subsection"
        aria-labelledby="repositories-heading"
      >
        <div className="section-heading">
          <div>
            <h3 id="repositories-heading">Repositories</h3>
            <p>Link source repositories to this project.</p>
          </div>
        </div>
        {repositories.length ? (
          <div
            className="admin-list"
            role="list"
            aria-label="Connected repositories"
          >
            {repositories.map((repository) => (
              <div
                className="admin-list-row"
                role="listitem"
                key={repository.id}
              >
                <div>
                  <strong>
                    {repository.owner}/{repository.name}
                  </strong>
                  <small>
                    {repository.provider}
                    {repository.externalId ? ` · ${repository.externalId}` : ""}
                  </small>
                </div>
                <button
                  className="button button-quiet"
                  type="button"
                  disabled={working}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Remove ${repository.owner}/${repository.name}?`,
                      )
                    )
                      void run(
                        () =>
                          adminApi.removeRepository(project.id, repository.id),
                        "Repository removed.",
                      );
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="inline-empty">No repositories connected.</p>
        )}
        <form className="form-panel compact-form" onSubmit={addRepository}>
          <h4>Add repository</h4>
          <div className="form-grid three">
            <label className="field">
              <span>Provider</span>
              <input name="provider" defaultValue="github" maxLength={40} />
            </label>
            <label className="field">
              <span>Owner or organization</span>
              <input name="owner" required maxLength={120} />
            </label>
            <label className="field">
              <span>Repository name</span>
              <input name="name" required maxLength={160} />
            </label>
            <label className="field">
              <span>
                External repository ID <small>Optional</small>
              </span>
              <input name="externalId" maxLength={160} />
            </label>
          </div>
          <div className="form-actions">
            <button className="button button-secondary" disabled={working}>
              Add repository
            </button>
          </div>
        </form>
      </section>

      <section
        className="admin-subsection"
        aria-labelledby="environments-heading"
      >
        <div className="section-heading">
          <div>
            <h3 id="environments-heading">Environments</h3>
            <p>
              Review deployment targets and update their labels or enabled
              state.
            </p>
          </div>
        </div>
        {environments.length ? (
          <div
            className="admin-list"
            role="list"
            aria-label="Project environments"
          >
            {environments.map((environment) => (
              <form
                className="admin-list-row environment-row"
                role="listitem"
                key={environment.id}
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void run(
                    () =>
                      adminApi.updateEnvironment(project.id, environment.id, {
                        label: String(form.get("label") ?? "").trim() || null,
                        enabled: form.get("enabled") === "on",
                      }),
                    `${environment.name} updated.`,
                  );
                }}
              >
                <div>
                  <strong>{environment.name}</strong>
                  <small>{environment.enabled ? "Enabled" : "Disabled"}</small>
                </div>
                <label className="field">
                  <span>Label</span>
                  <input
                    name="label"
                    defaultValue={environment.label ?? ""}
                    maxLength={80}
                  />
                </label>
                <label className="checkbox-control">
                  <input
                    name="enabled"
                    type="checkbox"
                    defaultChecked={environment.enabled}
                  />
                  <span>Enabled</span>
                </label>
                <button className="button button-secondary" disabled={working}>
                  Save
                </button>
              </form>
            ))}
          </div>
        ) : (
          <p className="inline-empty">
            No environments configured for this project.
          </p>
        )}
      </section>

      <section className="admin-subsection" aria-labelledby="audit-heading">
        <div className="section-heading">
          <div>
            <h3 id="audit-heading">Audit history</h3>
            <p>
              {audit
                ? `${audit.total} recorded events`
                : "Recent project activity"}
            </p>
          </div>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void exportAudit()}
          >
            Export audit CSV
          </button>
        </div>
        {audit?.items.length ? (
          <ol className="audit-list">
            {audit.items.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>
                    {item.action.replaceAll(".", " · ").replaceAll("_", " ")}
                  </strong>
                  <small>
                    {item.actor?.displayName || item.actor?.email || "System"} ·{" "}
                    {item.entityType}
                    {item.entityId ? ` · ${item.entityId}` : ""}
                  </small>
                </div>
                <time dateTime={item.createdAt}>
                  {dateTime(item.createdAt)}
                </time>
              </li>
            ))}
          </ol>
        ) : (
          <p className="inline-empty">
            No audit events are available, or your role cannot view history.
          </p>
        )}
      </section>
    </section>
  );
}
