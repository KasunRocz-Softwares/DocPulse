import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { IntegrationsModule } from "../integrations/integrations.module";
import { PrismaModule } from "../prisma/prisma.module";
import {
  GitHubAppController,
  GitHubAppWebhookController,
} from "./github-app.controller";
import {
  GITHUB_APP_PROVIDER,
  GitHubApiAppProvider,
} from "./github-app.provider";
import { GitHubAppService } from "./github-app.service";

@Module({
  imports: [AuthModule, IntegrationsModule, PrismaModule],
  controllers: [GitHubAppController, GitHubAppWebhookController],
  providers: [
    GitHubAppService,
    GitHubApiAppProvider,
    { provide: GITHUB_APP_PROVIDER, useExisting: GitHubApiAppProvider },
  ],
})
export class GitHubAppModule {}
