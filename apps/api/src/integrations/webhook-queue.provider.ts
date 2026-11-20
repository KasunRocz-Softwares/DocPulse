import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import {
  WEBHOOK_QUEUE,
  type WebhookJob,
  type WebhookQueue,
} from "./webhook-contracts";

@Injectable()
export class WebhookQueueProvider implements WebhookQueue, OnModuleDestroy {
  private readonly connection: IORedis;
  private readonly queue: Queue<WebhookJob & { eventId: string }>;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl)
      throw new Error(
        "REDIS_URL must be configured before the API starts webhook integration",
      );
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue("webhooks", { connection: this.connection });
  }

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
  ) {
    return this.queue.add(name, data, options);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.connection.quit();
  }
}

export const webhookQueueProvider = {
  provide: WEBHOOK_QUEUE,
  useClass: WebhookQueueProvider,
};
