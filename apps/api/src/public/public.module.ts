import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { PrismaModule } from "../prisma/prisma.module";
import { ReleaseContentModule } from "../release-content/release-content.module";
import { PublicCacheModule } from "./public-cache.module";
import { PublicController } from "./public.controller";
import { PublicAttachmentsService } from "./public-attachments.service";
import { PublicService } from "./public.service";
import { parsePublicApiRateLimitOptions } from "./public-api-rate-limit.config";
import {
  PUBLIC_API_RATE_LIMIT_OPTIONS,
  PublicApiRateLimitGuard,
  PublicApiRateLimitRedisConnection,
} from "./public-api-rate-limit.guard";

@Module({
  imports: [PrismaModule, ReleaseContentModule, PublicCacheModule],
  controllers: [PublicController],
  providers: [
    PublicService,
    PublicAttachmentsService,
    PublicApiRateLimitRedisConnection,
    {
      provide: PUBLIC_API_RATE_LIMIT_OPTIONS,
      useFactory: () => parsePublicApiRateLimitOptions(),
    },
    { provide: APP_GUARD, useClass: PublicApiRateLimitGuard },
  ],
})
export class PublicModule {}
