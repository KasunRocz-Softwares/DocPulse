import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";
import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { AuthenticatedRequest, JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ClientVisibilityService } from "./client-visibility.service";

type HttpResponse = { setHeader(name: string, value: string): void };

class CreateClientAudienceInput {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MinLength(1)
  @MaxLength(80)
  slug!: string;
}

class AssignClientAudienceInput {
  @IsOptional()
  @IsUUID()
  clientAudienceId!: string | null;
}

@ApiTags("client visibility administration")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("internal/projects/:projectId")
export class ClientAudienceAdminController {
  constructor(private readonly visibility: ClientVisibilityService) {}

  @Get("client-audiences")
  list(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
  ) {
    return this.visibility.listAudiences(req.user, projectId);
  }

  @Post("client-audiences")
  create(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Body() body: CreateClientAudienceInput,
  ) {
    return this.visibility.createAudience(req.user, projectId, body);
  }

  @Patch("members/:membershipId/client-audience")
  assign(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Param("membershipId") membershipId: string,
    @Body() body: AssignClientAudienceInput,
  ) {
    if (body.clientAudienceId === undefined)
      throw new BadRequestException(
        "clientAudienceId is required; use null to unassign",
      );
    return this.visibility.assignMember(
      req.user,
      projectId,
      membershipId,
      body.clientAudienceId,
    );
  }
}

@ApiTags("authenticated client releases")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("client/projects/:projectSlug")
export class ClientReleaseController {
  constructor(private readonly visibility: ClientVisibilityService) {}

  @Get("releases")
  @ApiParam({ name: "projectSlug", type: String })
  @ApiQuery({
    name: "page",
    required: false,
    type: Number,
    description: "1-based page number (default 1).",
  })
  @ApiQuery({
    name: "pageSize",
    required: false,
    type: Number,
    description: "Results per page, from 1 to 100 (default 20).",
  })
  list(
    @Req() req: AuthenticatedRequest,
    @Param("projectSlug") slug: string,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
  ) {
    return this.visibility.clientReleases(
      req.user,
      slug,
      Number(page),
      Number(pageSize),
    );
  }

  @Get("releases/:version/attachments/:attachmentId/download")
  async downloadAttachment(
    @Req() req: AuthenticatedRequest,
    @Param("projectSlug") slug: string,
    @Param("version") version: string,
    @Param("attachmentId") attachmentId: string,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const result = await this.visibility.downloadClientAttachment(
      req.user,
      slug,
      version,
      attachmentId,
    );
    response.setHeader("Content-Type", result.metadata.contentType);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(result.metadata.fileName)}`,
    );
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Length", result.metadata.sizeBytes);
    response.setHeader("Cache-Control", "no-store");
    return new StreamableFile(result.bytes);
  }
}
