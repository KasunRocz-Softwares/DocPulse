import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { DeploymentOrchestrationController } from "./deployment-orchestration.controller";
import { DeploymentQueueProvider } from "./deployment-queue.provider";
import { DeploymentOrchestrationService } from "./deployment-orchestration.service";
import { DeploymentWorkerController } from "./deployment-worker.controller";
import { DeploymentRunnerController } from "./deployment-runner.controller";
import { DEPLOYMENT_TRIGGER_QUEUE_PROVIDER } from "./deployment-contracts";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [
    DeploymentOrchestrationController,
    DeploymentWorkerController,
    DeploymentRunnerController,
  ],
  providers: [
    DeploymentOrchestrationService,
    {
      provide: DEPLOYMENT_TRIGGER_QUEUE_PROVIDER,
      useClass: DeploymentQueueProvider,
    },
  ],
  exports: [DeploymentOrchestrationService],
})
export class DeploymentOrchestrationModule {}
