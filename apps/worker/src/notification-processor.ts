export const NOTIFICATION_JOB_DEFAULTS = {
  attempts: 8,
  backoff: { type: "exponential" as const, delay: 1_000 },
};

export type NotificationMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};
export interface NotificationDelivery {
  id: string;
  status: string;
  recipient: string;
  projectName: string;
  version: string;
  title: string;
  summary?: string | null;
  publicUrl: string;
  unsubscribeUrl: string;
}
export interface NotificationHandlers {
  loadDelivery(
    id: string,
    jobData?: unknown,
  ): Promise<NotificationDelivery | null>;
  send(message: NotificationMessage): Promise<void>;
  markSent(id: string): Promise<void>;
  markFailed(
    id: string,
    diagnostic: { errorName: string; errorCode?: string },
  ): Promise<void>;
}

export function createNotificationProcessor(handlers: NotificationHandlers) {
  return async (job: { data: unknown }): Promise<void> => {
    if (!isRecord(job.data) || typeof job.data.deliveryId !== "string")
      throw new Error("Invalid notification job");
    const id = job.data.deliveryId;
    const jobData = job.data;
    const message =
      isRecord(jobData) && isRecord(jobData.message)
        ? asMessage(jobData.message)
        : null;
    const delivery = message ? null : await handlers.loadDelivery(id, jobData);
    if (!message && !delivery) return;
    if (delivery?.status === "SENT") return;
    try {
      if (message) {
        await handlers.send(message);
        await handlers.markSent(id);
        return;
      }
      if (!delivery) return;
      const summary = delivery.summary
        ? `<p>${escapeHtml(delivery.summary)}</p>`
        : "";
      const html = `<h1>${escapeHtml(delivery.title)}</h1><p>${escapeHtml(delivery.projectName)} · ${escapeHtml(delivery.version)}</p>${summary}<p><a href="${escapeHtml(delivery.publicUrl)}">Read release notes</a></p><p><a href="${escapeHtml(delivery.unsubscribeUrl)}">Unsubscribe</a></p>`;
      await handlers.send({
        to: delivery.recipient,
        subject: `${delivery.projectName} ${delivery.version}: ${delivery.title}`,
        html,
        text: `${delivery.projectName} ${delivery.version}: ${delivery.title}\n${delivery.summary ?? ""}\n${delivery.publicUrl}\nUnsubscribe: ${delivery.unsubscribeUrl}`,
      });
      await handlers.markSent(id);
    } catch (error) {
      const diagnostic = failureDiagnostic(error);
      await handlers.markFailed(id, diagnostic);
      // Raw transport errors may contain service credentials; keep only the sanitized diagnostic.
      throw new Error("Notification delivery failed", {
        // eslint-disable-next-line preserve-caught-error -- cause contains only the sanitized diagnostic
        cause: new Error(
          [diagnostic.errorName, diagnostic.errorCode]
            .filter(Boolean)
            .join(":"),
        ),
      });
    }
  };
}

function asMessage(value: Record<string, unknown>): NotificationMessage | null {
  if (
    typeof value.to !== "string" ||
    typeof value.subject !== "string" ||
    typeof value.html !== "string" ||
    typeof value.text !== "string"
  )
    return null;
  return {
    to: value.to,
    subject: value.subject,
    html: value.html,
    text: value.text,
  };
}

export function failureDiagnostic(error: unknown): {
  errorName: string;
  errorCode?: string;
} {
  const value =
    error !== null && typeof error === "object"
      ? (error as { name?: unknown; code?: unknown })
      : {};
  const name =
    typeof value.name === "string" &&
    /^[A-Za-z][A-Za-z0-9_.]{0,79}$/.test(value.name)
      ? value.name
      : "Error";
  const code =
    typeof value.code === "string" && /^[A-Z0-9_-]{1,40}$/.test(value.code)
      ? value.code
      : undefined;
  return { errorName: name, ...(code ? { errorCode: code } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}
