import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { WebhookController } from "./webhook.controller";
import { WebhookIngestionService } from "./webhook-ingestion.service";
import { WebhookProcessingController } from "./webhook-processing.controller";
import { WebhookProcessingService } from "./webhook-processing.service";
import { IntegrationSuggestionsController } from "./integration-suggestions.controller";
import { IntegrationSuggestionsService } from "./integration-suggestions.service";
import { webhookQueueProvider } from "./webhook-queue.provider";

@Module({
  imports: [PrismaModule],
  controllers: [
    WebhookController,
    WebhookProcessingController,
    IntegrationSuggestionsController,
  ],
  providers: [
    webhookQueueProvider,
    WebhookIngestionService,
    WebhookProcessingService,
    IntegrationSuggestionsService,
  ],
  exports: [
    WebhookIngestionService,
    WebhookProcessingService,
    IntegrationSuggestionsService,
  ],
})
export class IntegrationsModule {}
