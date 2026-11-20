import type {
  DeploymentWebhookJob,
  GithubWebhookJob,
} from "./webhook-contracts.js";

const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const SHA = /^[a-f0-9]{40,64}$/i;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const own = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function normalizeGitHubWebhook(
  eventType: string,
  payload: unknown,
): GithubWebhookJob | undefined {
  if (!own(payload) || !own(payload.repository)) return undefined;
  const repository = payload.repository.full_name;
  if (typeof repository !== "string" || !REPOSITORY.test(repository))
    return undefined;
  const action =
    typeof payload.action === "string"
      ? payload.action.slice(0, 80)
      : eventType;

  if (eventType === "push") {
    const revision = payload.after;
    if (
      typeof revision !== "string" ||
      !SHA.test(revision) ||
      /^0+$/.test(revision)
    )
      return undefined;
    return {
      kind: "github",
      eventType,
      repository,
      action: "push",
      reference: { kind: "commit", externalId: revision, revision },
    };
  }
  if (eventType === "pull_request" && own(payload.pull_request)) {
    const number = payload.pull_request.number;
    const head = own(payload.pull_request.head)
      ? payload.pull_request.head.sha
      : undefined;
    if (
      !Number.isSafeInteger(number) ||
      Number(number) <= 0 ||
      typeof head !== "string" ||
      !SHA.test(head)
    )
      return undefined;
    return {
      kind: "github",
      eventType,
      repository,
      action,
      reference: {
        kind: "pull_request",
        externalId: String(number),
        revision: head,
      },
    };
  }
  if (eventType === "issues" && own(payload.issue)) {
    const number = payload.issue.number;
    if (!Number.isSafeInteger(number) || Number(number) <= 0) return undefined;
    return {
      kind: "github",
      eventType,
      repository,
      action,
      reference: { kind: "issue", externalId: String(number) },
    };
  }
  if (eventType === "release" && own(payload.release)) {
    const tag = payload.release.tag_name;
    if (typeof tag !== "string" || !tag.trim() || tag.length > 160)
      return undefined;
    return {
      kind: "github",
      eventType,
      repository,
      action,
      reference: { kind: "tag", externalId: tag },
    };
  }
  return undefined;
}

export function normalizeDeploymentWebhook(
  provider: string,
  payload: unknown,
): DeploymentWebhookJob | undefined {
  if (!own(payload)) return undefined;
  const {
    deploymentId,
    projectId,
    releaseId,
    environmentId,
    status,
    occurredAt,
  } = payload;
  const statuses = [
    "queued",
    "in_progress",
    "succeeded",
    "failed",
    "cancelled",
  ];
  if (
    typeof deploymentId !== "string" ||
    !deploymentId.trim() ||
    deploymentId.length > 255
  )
    return undefined;
  if (
    ![projectId, releaseId, environmentId].every(
      (id) => typeof id === "string" && UUID.test(id),
    )
  )
    return undefined;
  if (typeof status !== "string" || !statuses.includes(status))
    return undefined;
  if (
    typeof occurredAt !== "string" ||
    !Number.isFinite(Date.parse(occurredAt))
  )
    return undefined;
  return {
    kind: "deployment",
    provider,
    deploymentId,
    projectId: projectId as string,
    releaseId: releaseId as string,
    environmentId: environmentId as string,
    status: status as DeploymentWebhookJob["status"],
    occurredAt: new Date(occurredAt).toISOString(),
  };
}
