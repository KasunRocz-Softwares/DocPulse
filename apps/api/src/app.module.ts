import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { ProjectsModule } from "./projects/projects.module";
import { ReleasesModule } from "./releases/releases.module";
import { PublishingModule } from "./publishing/publishing.module";
import { PublicModule } from "./public/public.module";
import { PublicPageModule } from "./public-page/public-page.module";
import { UsersModule } from "./users/users.module";
import { IntegrationsModule } from "./integrations/integrations.module";
import { ReleaseContentModule } from "./release-content/release-content.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { AiSummariesModule } from "./ai-summaries/ai-summaries.module";
import { DeploymentOrchestrationModule } from "./deployment-orchestration/deployment-orchestration.module";
import { ClientVisibilityModule } from "./client-visibility/client-visibility.module";
import { IntegrationOperationsModule } from "./integration-operations/integration-operations.module";
import { GitHubAppModule } from "./github-app/github-app.module";
import { ApiMetricsModule } from "./metrics/api-metrics.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    ProjectsModule,
    ReleasesModule,
    PublishingModule,
    PublicModule,
    PublicPageModule,
    UsersModule,
    IntegrationsModule,
    ReleaseContentModule,
    NotificationsModule,
    AnalyticsModule,
    AiSummariesModule,
    DeploymentOrchestrationModule,
    ClientVisibilityModule,
    IntegrationOperationsModule,
    GitHubAppModule,
    ApiMetricsModule,
    HealthModule,
  ],
})
export class AppModule {}
