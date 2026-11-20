import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PublicCacheModule } from "../public/public-cache.module";
import {
  PublicPageController,
  PublicPageDeliveryController,
} from "./public-page.controller";
import { PublicPageService } from "./public-page.service";

@Module({
  imports: [AuthModule, PublicCacheModule],
  controllers: [PublicPageController, PublicPageDeliveryController],
  providers: [PublicPageService],
  exports: [PublicPageService],
})
export class PublicPageModule {}
