import { Injectable, Module, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { createHash } from "node:crypto";
import { AuthModule } from "../auth/auth.module";
import {
  NOTIFICATION_QUEUE,
  NOTIFICATION_TOKEN_HASHER,
  NotificationsService,
} from "./notifications.service";
import {
  NotificationWorkerController,
  ProjectNotificationsController,
  PublicNotificationsController,
} from "./notifications.controller";

@Injectable()
class NotificationQueueProvider implements OnModuleDestroy {
  private readonly connection: IORedis;
  private readonly queue: Queue;
  constructor() {
    const url = process.env.REDIS_URL;
    if (!url)
      throw new Error(
        "REDIS_URL must be configured before notifications are enabled",
      );
    this.connection = new IORedis(url, { maxRetriesPerRequest: null });
    this.queue = new Queue("notifications", { connection: this.connection });
  }
  add(
    name: string,
    data: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) {
    return this.queue.add(name, data, options);
  }
  async onModuleDestroy() {
    await this.queue.close();
    await this.connection.quit();
  }
}

@Module({
  imports: [AuthModule],
  controllers: [
    PublicNotificationsController,
    ProjectNotificationsController,
    NotificationWorkerController,
  ],
  providers: [
    { provide: NOTIFICATION_QUEUE, useClass: NotificationQueueProvider },
    {
      provide: NOTIFICATION_TOKEN_HASHER,
      useValue: {
        hashToken: (token: string) =>
          createHash("sha256").update(token).digest("hex"),
      },
    },
    NotificationsService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
