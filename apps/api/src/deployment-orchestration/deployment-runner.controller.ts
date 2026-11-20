import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";
import { createHmac, timingSafeEqual } from "node:crypto";
import { DeploymentOrchestrationService } from "./deployment-orchestration.service";

type RequestWithRawBody = { rawBody?: Buffer };

class DeploymentRunnerStatusInput {
  @IsIn(["ACCEPTED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"])
  status!: "ACCEPTED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9_.-]{1,80}$/)
  resultCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  resultSummary?: string | null;
}

@ApiTags("deployment runner callbacks")
@Controller("internal/deployment-orchestration/runner/requests")
export class DeploymentRunnerController {
  constructor(private readonly deployments: DeploymentOrchestrationService) {}

  @Post(":requestId/status")
  @HttpCode(HttpStatus.OK)
  report(
    @Param("requestId", ParseUUIDPipe) requestId: string,
    @Body() input: DeploymentRunnerStatusInput,
    @Req() request: RequestWithRawBody,
    @Headers("x-rdps-timestamp") timestamp?: string,
    @Headers("x-rdps-signature") signature?: string,
  ) {
    verifyRunnerSignature(request.rawBody, timestamp, signature);
    return this.deployments.reportRunnerStatus(requestId, input);
  }
}

function verifyRunnerSignature(
  rawBody?: Buffer,
  timestamp?: string,
  signature?: string,
) {
  const secret = process.env.DEPLOYMENT_RUNNER_SIGNING_SECRET;
  if (
    !rawBody?.length ||
    !secret ||
    !timestamp ||
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000 ||
    !signature?.startsWith("sha256=")
  )
    throw new UnauthorizedException("Invalid runner callback signature");

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest();
  const suppliedHex = signature.slice("sha256=".length);
  if (!/^[a-f0-9]{64}$/i.test(suppliedHex))
    throw new UnauthorizedException("Invalid runner callback signature");
  const supplied = Buffer.from(suppliedHex, "hex");
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(expected, supplied)
  )
    throw new UnauthorizedException("Invalid runner callback signature");
}
