import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { timingSafeEqual } from "node:crypto";
import {
  AnalyticsEventKind,
  AnalyticsExportKind,
} from "../generated/prisma/enums";
import { AuthenticatedRequest, JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AnalyticsService } from "./analytics.service";

class PublicEventInput {
  [key: string]: unknown;
  @IsString() @MaxLength(80) projectSlug!: string;
  @IsEnum(AnalyticsEventKind) kind!: AnalyticsEventKind;
  @IsOptional() @IsString() @MaxLength(64) version?: string;
}

class ExportInput {
  @IsEnum(AnalyticsExportKind) kind!: AnalyticsExportKind;
  @IsOptional() @IsInt() @Min(1) @Max(90) days?: number;
  @IsOptional() @IsString() @MaxLength(64) releaseId?: string;
}

@ApiTags("public analytics")
@Controller("public/analytics/events")
export class PublicAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}
  @Post() record(@Body() input: PublicEventInput) {
    return this.analytics.recordPublicEvent(input);
  }
}

@ApiTags("internal analytics")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("internal/projects/:projectId/analytics")
export class ProjectAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}
  @Get() dashboard(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Query("days") days?: string,
  ) {
    const parsed = days === undefined ? 30 : Number(days);
    return this.analytics.dashboard(request.user, projectId, parsed);
  }
  @Post("exports") createExport(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Body() input: ExportInput,
  ) {
    return this.analytics.requestExport(request.user, projectId, input);
  }
  @Get("exports") listExports(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
  ) {
    return this.analytics.listExports(request.user, projectId);
  }
  @Get("exports/:exportId/download") async download(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Param("exportId") exportId: string,
    @Res() response: any,
  ) {
    const file = await this.analytics.getExport(
      request.user,
      projectId,
      exportId,
    );
    response.setHeader("Content-Type", file.contentType);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${file.filename}"`,
    );
    response.setHeader("Cache-Control", "private, no-store");
    response.send(file.artifact);
  }
}

@ApiTags("analytics worker callbacks")
@Controller("internal/analytics/worker/exports")
export class AnalyticsWorkerController {
  constructor(private readonly analytics: AnalyticsService) {}
  @Post(":exportId/processing") async processing(
    @Param("exportId") exportId: string,
    @Headers("x-rdps-worker-secret") secret?: string,
  ) {
    verifyWorkerSecret(secret);
    return this.analytics.markProcessing(exportId);
  }
  @Post(":exportId/complete") async complete(
    @Param("exportId") exportId: string,
    @Headers("x-rdps-worker-secret") secret: string | undefined,
    @Headers("x-export-content-type") contentType: string | undefined,
    @Req() request: { body?: unknown },
  ) {
    verifyWorkerSecret(secret);
    if (!Buffer.isBuffer(request.body) || !contentType)
      throw new UnauthorizedException("Invalid worker artifact request");
    return this.analytics.completeExport(exportId, request.body, contentType);
  }
  @Post(":exportId/failed") async failed(
    @Param("exportId") exportId: string,
    @Headers("x-rdps-worker-secret") secret: string | undefined,
    @Body() body: { code?: string },
  ) {
    verifyWorkerSecret(secret);
    return this.analytics.failExport(
      exportId,
      body.code ?? "EXPORT_PROCESSING_FAILED",
    );
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
