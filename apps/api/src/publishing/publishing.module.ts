import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import {
  ApprovalQueueController,
  PublishingController,
} from "./publishing.controller";
import { PublishingService } from "./publishing.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { PublicCacheModule } from "../public/public-cache.module";

@Module({
  imports: [AuthModule, NotificationsModule, PublicCacheModule],
  controllers: [PublishingController, ApprovalQueueController],
  providers: [PublishingService],
})
export class PublishingModule {}
