import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { IntegrationOperationsQueue } from "./integration-operations.types";

@Injectable()
export class IntegrationOperationsQueueProvider
  implements IntegrationOperationsQueue, OnModuleDestroy
{
  private readonly connection: IORedis;
  private readonly queue: Queue;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl)
      throw new Error(
        "REDIS_URL must be configured for integration diagnostics",
      );
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue("webhooks", { connection: this.connection });
  }

  getJobs(types: string[], start: number, end: number, ascending?: boolean) {
    return this.queue.getJobs(types as any, start, end, ascending) as any;
  }

  getJob(id: string) {
    return this.queue.getJob(id) as any;
  }

  async onModuleDestroy() {
    await this.queue.close();
    await this.connection.quit();
  }
}
