import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";
import { AuthenticatedRequest, JwtAuthGuard } from "../auth/jwt-auth.guard";
import { DeploymentOrchestrationService } from "./deployment-orchestration.service";

class DeploymentPolicyInput {
  @IsBoolean() enabled!: boolean;
  @IsBoolean() requireApprovedRelease!: boolean;
}

class DeploymentTriggerInput {
  @IsUUID() environmentId!: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

class DeploymentStatusInput {
  @IsIn(["ACCEPTED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"])
  status!: "ACCEPTED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  @IsOptional() @IsString() @MaxLength(80) resultCode?: string | null;
  @IsOptional() @IsString() @MaxLength(500) resultSummary?: string | null;
}

@ApiTags("deployment orchestration")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("internal/projects/:projectId")
export class DeploymentOrchestrationController {
  constructor(private readonly deployments: DeploymentOrchestrationService) {}

  @Get("environments/:environmentId/deployment-policy")
  getPolicy(
    @Req() req: AuthenticatedRequest,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("environmentId", ParseUUIDPipe) environmentId: string,
  ) {
    return this.deployments.getPolicy(req.user, projectId, environmentId);
  }

  @Patch("environments/:environmentId/deployment-policy")
  setPolicy(
    @Req() req: AuthenticatedRequest,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("environmentId", ParseUUIDPipe) environmentId: string,
    @Body() body: DeploymentPolicyInput,
  ) {
    return this.deployments.setPolicy(req.user, projectId, environmentId, body);
  }

  @Post("releases/:releaseId/deployment-trigger-requests")
  requestTrigger(
    @Req() req: AuthenticatedRequest,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("releaseId", ParseUUIDPipe) releaseId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body() body: DeploymentTriggerInput,
  ) {
    return this.deployments.requestTrigger(
      req.user,
      projectId,
      releaseId,
      body.environmentId,
      idempotencyKey,
      body.reason,
    );
  }

  @Get("releases/:releaseId/deployment-trigger-requests")
  listRequests(
    @Req() req: AuthenticatedRequest,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("releaseId", ParseUUIDPipe) releaseId: string,
  ) {
    return this.deployments.listRequests(req.user, projectId, releaseId);
  }

  @Get("deployment-trigger-requests/:requestId")
  getRequest(
    @Req() req: AuthenticatedRequest,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("requestId", ParseUUIDPipe) requestId: string,
  ) {
    return this.deployments.getRequest(req.user, projectId, requestId);
  }

  @Patch("deployment-trigger-requests/:requestId/status")
  updateStatus(
    @Req() req: AuthenticatedRequest,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("requestId", ParseUUIDPipe) requestId: string,
    @Body() body: DeploymentStatusInput,
  ) {
    return this.deployments.updateStatus(req.user, projectId, requestId, body);
  }
}
