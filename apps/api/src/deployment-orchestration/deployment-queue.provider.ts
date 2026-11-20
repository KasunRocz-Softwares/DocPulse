import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import {
  DEPLOYMENT_TRIGGER_QUEUE,
  type DeploymentTriggerJob,
} from "./deployment-contracts";

@Injectable()
export class DeploymentQueueProvider implements OnModuleDestroy {
  private readonly connection: IORedis;
  private readonly queue: Queue<DeploymentTriggerJob>;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl)
      throw new Error("REDIS_URL must be configured for deployment triggers");
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(DEPLOYMENT_TRIGGER_QUEUE, {
      connection: this.connection,
    });
  }

  add(
    name: string,
    data: DeploymentTriggerJob,
    options: Parameters<Queue<DeploymentTriggerJob>["add"]>[2],
  ) {
    return this.queue.add(name, data, options);
  }

  async onModuleDestroy() {
    await this.queue.close();
    await this.connection.quit();
  }
}
