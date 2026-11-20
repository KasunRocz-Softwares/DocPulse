import type { WebhookEventHandlers } from "./webhook-processor.js";

export function createApiWebhookHandlers(
  apiBaseUrl = process.env.RDPS_API_URL,
  workerSecret = process.env.RDPS_WORKER_SHARED_SECRET,
): WebhookEventHandlers {
  if (!apiBaseUrl)
    throw new Error("RDPS_API_URL must be configured for webhook processing");
  if (!workerSecret)
    throw new Error(
      "RDPS_WORKER_SHARED_SECRET must be configured for webhook processing",
    );
  const endpoint = new URL(
    "/api/v1/integrations/internal/webhook-events",
    apiBaseUrl,
  );

  const post = async (event: { eventId?: string }): Promise<void> => {
    if (!event.eventId)
      throw new Error("Webhook event is missing its persisted event ID");
    const response = await fetch(
      `${endpoint}/${encodeURIComponent(event.eventId)}/process`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-rdps-worker-token": workerSecret,
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      const error = new Error(
        `Webhook processing API returned HTTP ${response.status}`,
      ) as Error & { code: string };
      error.code = `HTTP_${response.status}`;
      throw error;
    }
    const result: unknown = await response.json();
    if (
      typeof result !== "object" ||
      result === null ||
      !("processed" in result) ||
      result.processed !== true
    ) {
      throw new Error("Webhook processing API did not confirm processing");
    }
  };

  return { processGitHub: post, processDeployment: post };
}
