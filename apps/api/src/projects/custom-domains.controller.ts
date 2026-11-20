import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsString, MaxLength } from "class-validator";
import { AuthenticatedRequest, JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CustomDomainsService } from "./custom-domains.service";

class RequestCustomDomainInput {
  @IsString() @MaxLength(253) domain!: string;
}

@ApiTags("internal project domains")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("internal/projects/:projectId/brand/custom-domain")
export class CustomDomainsController {
  constructor(private readonly domains: CustomDomainsService) {}

  @Get()
  status(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
  ) {
    return this.domains.status(request.user, projectId);
  }

  @Post()
  requestVerification(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Body() body: RequestCustomDomainInput,
  ) {
    return this.domains.requestVerification(
      request.user,
      projectId,
      body.domain,
    );
  }

  @Post("verify")
  verify(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
  ) {
    return this.domains.verify(request.user, projectId);
  }

  @Delete()
  remove(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
  ) {
    return this.domains.remove(request.user, projectId);
  }
}
