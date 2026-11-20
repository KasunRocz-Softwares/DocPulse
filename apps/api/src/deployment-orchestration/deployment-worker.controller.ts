import {
  Body,
  Controller,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { IsIn, IsString, Matches, MaxLength } from "class-validator";
import { timingSafeEqual } from "node:crypto";
import { DeploymentOrchestrationService } from "./deployment-orchestration.service";

class DeploymentWorkerStatusInput {
  @IsIn(["ACCEPTED", "FAILED"])
  status!: "ACCEPTED" | "FAILED";

  @IsString()
  @Matches(/^[A-Z0-9_.-]{1,80}$/)
  resultCode!: string;

  @IsString()
  @MaxLength(500)
  resultSummary!: string;
}

@ApiTags("deployment worker callbacks")
@Controller("internal/deployment-orchestration/worker/requests")
export class DeploymentWorkerController {
  constructor(private readonly deployments: DeploymentOrchestrationService) {}

  @Post(":requestId/status")
  report(
    @Param("requestId", ParseUUIDPipe) requestId: string,
    @Body() input: DeploymentWorkerStatusInput,
    @Headers("x-rdps-worker-secret") secret?: string,
  ) {
    verifyWorkerSecret(secret);
    return this.deployments.reportDispatchStatus(requestId, input);
  }
}

function verifyWorkerSecret(candidate?: string) {
  const expected = process.env.RDPS_WORKER_SHARED_SECRET;
  if (!candidate || !expected) throw new UnauthorizedException();
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right))
    throw new UnauthorizedException();
}
