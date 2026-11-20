import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { AI_SUMMARY_PROVIDER } from "./ai-summary-provider";
import { AiSummariesController } from "./ai-summaries.controller";
import { AiSummariesService } from "./ai-summaries.service";
import { HttpAiSummaryProvider } from "./http-ai-summary.provider";

@Module({
  imports: [AuthModule, ConfigModule, PrismaModule],
  controllers: [AiSummariesController],
  providers: [
    AiSummariesService,
    HttpAiSummaryProvider,
    { provide: AI_SUMMARY_PROVIDER, useExisting: HttpAiSummaryProvider },
  ],
  exports: [AiSummariesService],
})
export class AiSummariesModule {}
