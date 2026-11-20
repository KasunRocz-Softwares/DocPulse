import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ReleaseContentModule } from "../release-content/release-content.module";
import {
  ClientAudienceAdminController,
  ClientReleaseController,
} from "./client-visibility.controller";
import { ClientVisibilityService } from "./client-visibility.service";

@Module({
  imports: [AuthModule, PrismaModule, ReleaseContentModule],
  controllers: [ClientAudienceAdminController, ClientReleaseController],
  providers: [ClientVisibilityService],
})
export class ClientVisibilityModule {}
