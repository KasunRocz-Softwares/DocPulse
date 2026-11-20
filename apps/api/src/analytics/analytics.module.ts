import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from "@nestjs/common";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { AuthModule } from "../auth/auth.module";
import { AnalyticsService } from "./analytics.service";
import {
  AnalyticsWorkerController,
  ProjectAnalyticsController,
  PublicAnalyticsController,
} from "./analytics.controller";
import { ANALYTICS_EXPORT_QUEUE } from "./analytics.tokens";

@Module({
  imports: [AuthModule],
  controllers: [
    PublicAnalyticsController,
    ProjectAnalyticsController,
    AnalyticsWorkerController,
  ],
  providers: [
    AnalyticsService,
    {
      provide: ANALYTICS_EXPORT_QUEUE,
      useFactory: () => {
        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl)
          throw new Error("REDIS_URL must be configured for analytics exports");
        return new Queue("analytics-exports", {
          connection: new IORedis(redisUrl, { maxRetriesPerRequest: null }),
        });
      },
    },
  ],
})
export class AnalyticsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    const express = require("express") as {
      raw: (options: {
        type: string;
        limit: string;
      }) => (...args: never[]) => void;
    };
    consumer
      .apply(express.raw({ type: "application/octet-stream", limit: "8mb" }))
      .forRoutes({
        path: "internal/analytics/worker/exports/:exportId/complete",
        method: RequestMethod.POST,
      });
  }
}
