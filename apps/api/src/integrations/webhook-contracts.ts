export const WEBHOOK_QUEUE = "RDPS_WEBHOOK_QUEUE";

export type GithubReferenceKind = "commit" | "pull_request" | "issue" | "tag";

export interface GithubWebhookJob {
  kind: "github";
  eventId?: string;
  eventType: "push" | "pull_request" | "issues" | "release";
  repository: string;
  action: string;
  reference: {
    kind: GithubReferenceKind;
    externalId: string;
    revision?: string;
  };
}

export interface DeploymentWebhookJob {
  kind: "deployment";
  eventId?: string;
  provider: string;
  deploymentId: string;
  projectId: string;
  releaseId: string;
  environmentId: string;
  status: "queued" | "in_progress" | "succeeded" | "failed" | "cancelled";
  occurredAt: string;
}

export type WebhookJob = GithubWebhookJob | DeploymentWebhookJob;

export interface WebhookQueue {
  add(
    name: string,
    data: WebhookJob & { eventId: string },
    options: {
      jobId: string;
      attempts: number;
      backoff: { type: "exponential"; delay: number };
      removeOnComplete: number;
      removeOnFail: number;
    },
  ): Promise<unknown>;
}

export interface WebhookEventRepository {
  findByDelivery(
    provider: string,
    deliveryId: string,
  ): Promise<StoredWebhookEvent | null>;
  findByPayload(
    provider: string,
    payloadHash: string,
  ): Promise<StoredWebhookEvent | null>;
  create(input: {
    provider: string;
    deliveryId: string;
    eventType: string;
    payloadHash: string;
  }): Promise<StoredWebhookEvent>;
}

export interface StoredWebhookEvent {
  id: string;
  status: string;
}
