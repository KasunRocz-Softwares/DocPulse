import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { IntegrationOperationsController } from "./integration-operations.controller";
import { IntegrationOperationsQueueProvider } from "./integration-operations.queue";
import { INTEGRATION_OPERATIONS_QUEUE } from "./integration-operations.tokens";
import { IntegrationOperationsService } from "./integration-operations.service";

@Module({
  imports: [PrismaModule],
  controllers: [IntegrationOperationsController],
  providers: [
    IntegrationOperationsQueueProvider,
    {
      provide: INTEGRATION_OPERATIONS_QUEUE,
      useExisting: IntegrationOperationsQueueProvider,
    },
    IntegrationOperationsService,
  ],
})
export class IntegrationOperationsModule {}
