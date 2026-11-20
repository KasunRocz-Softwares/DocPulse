import { FormEvent, useEffect, useState } from "react";
import { adminApi } from "./api";

type Audience = { id: string; name: string; slug: string };
type Member = {
  id: string;
  role: string;
  clientAudienceId: string | null;
  user: { displayName: string; email: string };
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Could not update client audiences.";

export function ClientAudienceAdmin({ projectId }: { projectId: string }) {
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [workingId, setWorkingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const [nextAudiences, nextMembers] = await Promise.all([
      adminApi.listClientAudiences<Audience[]>(projectId),
      adminApi.listMembers<Member[]>(projectId),
    ]);
    setAudiences(nextAudiences);
    setMembers(nextMembers.filter((member) => member.role === "CLIENT"));
  }

  useEffect(() => {
    let active = true;
    void Promise.all([
      adminApi.listClientAudiences<Audience[]>(projectId),
      adminApi.listMembers<Member[]>(projectId),
    ])
      .then(([nextAudiences, nextMembers]) => {
        if (!active) return;
        setAudiences(nextAudiences);
        setMembers(nextMembers.filter((member) => member.role === "CLIENT"));
      })
      .catch((cause: unknown) => active && setError(errorMessage(cause)));
    return () => {
      active = false;
    };
  }, [projectId]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    try {
      await adminApi.createClientAudience(projectId, {
        name: name.trim(),
        slug: slug.trim(),
      });
      setName("");
      setSlug("");
      await load();
      setNotice("Client audience created.");
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function assign(member: Member, clientAudienceId: string) {
    setWorkingId(member.id);
    setError("");
    setNotice("");
    try {
      await adminApi.assignClientAudience(
        projectId,
        member.id,
        clientAudienceId || null,
      );
      await load();
      setNotice(`Audience updated for ${member.user.displayName}.`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setWorkingId("");
    }
  }

  return (
    <section
      className="admin-subsection"
      aria-labelledby="client-audiences-heading"
    >
      <h2 id="client-audiences-heading">Client audiences</h2>
      <p>
        Group client members so restricted release notes reach only their
        assigned audience.
      </p>
      {error && (
        <p className="error-copy" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success-copy" role="status">
          {notice}
        </p>
      )}
      <form onSubmit={(event) => void create(event)}>
        <label>
          Audience name
          <input
            required
            minLength={2}
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Audience key
          <input
            required
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            maxLength={80}
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
          />
        </label>
        <button className="button button-secondary" type="submit">
          Create audience
        </button>
      </form>
      <h3>Client member assignments</h3>
      {members.length === 0 ? (
        <p>No CLIENT members are assigned to this project yet.</p>
      ) : (
        <ul>
          {members.map((member) => (
            <li key={member.id}>
              <span>
                {member.user.displayName} · {member.user.email}
              </span>
              <label>
                <span className="sr-only">
                  Audience for {member.user.displayName}
                </span>
                <select
                  value={member.clientAudienceId ?? ""}
                  disabled={workingId === member.id}
                  onChange={(event) => void assign(member, event.target.value)}
                >
                  <option value="">Unassigned</option>
                  {audiences.map((audience) => (
                    <option key={audience.id} value={audience.id}>
                      {audience.name}
                    </option>
                  ))}
                </select>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
