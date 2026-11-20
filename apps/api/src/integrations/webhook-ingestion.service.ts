import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  WEBHOOK_QUEUE,
  type WebhookJob,
  type WebhookQueue,
} from "./webhook-contracts";

const JOB_OPTIONS = {
  attempts: 8,
  backoff: { type: "exponential" as const, delay: 1_000 },
  removeOnComplete: 1_000,
  removeOnFail: 1_000,
};

@Injectable()
export class WebhookIngestionService {
  private readonly logger = new Logger(WebhookIngestionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WEBHOOK_QUEUE) private readonly queue: WebhookQueue,
  ) {}

  async ingest(input: {
    provider: "github" | "deployment";
    deliveryId: string;
    eventType: string;
    payloadHash: string;
    job: WebhookJob;
  }): Promise<{ accepted: true; duplicate: boolean; eventId: string }> {
    type EventRecord = { id: string; status: string };
    let event: EventRecord | null;
    let duplicate: boolean;
    try {
      const persisted = await this.prisma.$transaction(
        async (tx) => {
          const events = tx.webhookEvent;
          const delivery = await events.findUnique({
            where: {
              provider_deliveryId: {
                provider: input.provider,
                deliveryId: input.deliveryId,
              },
            },
            select: { id: true, status: true },
          });
          if (delivery) return { event: delivery, duplicate: true };
          const replay = await events.findFirst({
            where: { provider: input.provider, payloadHash: input.payloadHash },
            orderBy: { receivedAt: "desc" },
            select: { id: true, status: true },
          });
          if (replay) return { event: replay, duplicate: true };
          const created = await events.create({
            data: {
              provider: input.provider,
              deliveryId: input.deliveryId,
              eventType: input.eventType,
              payloadHash: input.payloadHash,
            },
            select: { id: true, status: true },
          });
          return { event: created, duplicate: false };
        },
        { isolationLevel: "Serializable" },
      );
      event = persisted.event;
      duplicate = persisted.duplicate;
    } catch (error) {
      if (!isPersistenceRace(error)) throw error;
      const events = this.prisma.webhookEvent;
      event =
        (await events.findUnique({
          where: {
            provider_deliveryId: {
              provider: input.provider,
              deliveryId: input.deliveryId,
            },
          },
          select: { id: true, status: true },
        })) ??
        (await events.findFirst({
          where: { provider: input.provider, payloadHash: input.payloadHash },
          orderBy: { receivedAt: "desc" },
          select: { id: true, status: true },
        }));
      if (!event) throw error;
      duplicate = true;
    }

    if (event.status === "RECEIVED") {
      await this.queue.add(
        input.job.kind,
        { ...input.job, eventId: event.id },
        {
          ...JOB_OPTIONS,
          jobId: `webhook-${event.id}`,
        },
      );
    }

    this.logger.log(
      JSON.stringify({
        event: "webhook.accepted",
        provider: input.provider,
        eventId: event.id,
        duplicate,
      }),
    );
    return { accepted: true, duplicate, eventId: event.id };
  }
}

function isPersistenceRace(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "P2002" || error.code === "P2034")
  );
}
