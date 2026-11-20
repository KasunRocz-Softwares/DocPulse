import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import type { WebhookJob } from "./webhook-contracts";
import { WebhookProcessingService } from "./webhook-processing.service";

@Controller("integrations/internal/webhook-events")
export class WebhookProcessingController {
  constructor(private readonly processing: WebhookProcessingService) {}

  @Post(":eventId/process")
  @HttpCode(HttpStatus.OK)
  async process(
    @Param("eventId") eventId: string,
    @Body() job: WebhookJob,
    @Headers("x-rdps-worker-token") token?: string,
  ) {
    const expected = process.env.RDPS_WORKER_SHARED_SECRET;
    if (!expected || !token || !constantTimeSecretMatch(expected, token)) {
      throw new UnauthorizedException("Invalid worker authentication");
    }
    if (
      !job ||
      (job.kind !== "github" && job.kind !== "deployment") ||
      job.eventId !== eventId
    ) {
      return { processed: false, outcome: "invalid_job_contract" };
    }
    return this.processing.process(eventId, job);
  }
}

function constantTimeSecretMatch(expected: string, supplied: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}
