import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  IsDateString,
  IsEnum,
  IsArray,
  IsInt,
  IsUUID,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ArrayMaxSize,
  ArrayMinSize,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import {
  ChangeCategory,
  ChangeVisibility,
  ReleaseAudienceMode,
  ReleaseChannel,
  ReleaseType,
} from "../generated/prisma/enums";
import { AuthenticatedRequest, JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ReleasesService } from "./releases.service";

class CreateReleaseInput {
  @IsString()
  @Matches(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/)
  version!: string;
  @IsString() @MinLength(2) @MaxLength(200) title!: string;
  @IsEnum(ReleaseType) type!: ReleaseType;
  @IsOptional() @IsEnum(ReleaseChannel) channel?: ReleaseChannel;
  @IsOptional() @IsDateString() releaseDate?: string;
  @IsOptional() @IsString() @MaxLength(10000) internalSummary?: string;
}

class CreateChangeInput {
  @IsString() @MinLength(2) @MaxLength(240) title!: string;
  @IsEnum(ChangeCategory) category!: ChangeCategory;
  @IsString() @MinLength(1) @MaxLength(20000) internalDescription!: string;
  @IsOptional() @IsString() @MaxLength(10000) publicDescription?: string;
}

class UpdateReleaseInput {
  @IsOptional()
  @IsString()
  @Matches(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/)
  version?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) title?: string;
  @IsOptional() @IsEnum(ReleaseType) type?: ReleaseType;
  @IsOptional() @IsEnum(ReleaseChannel) channel?: ReleaseChannel;
  @IsOptional() @IsDateString() releaseDate?: string | null;
  @IsOptional() @IsString() @MaxLength(10000) internalSummary?: string | null;
  @IsOptional() @IsString() @MaxLength(10000) publicSummary?: string | null;
}

class BulkChangeItemInput {
  @IsUUID() id!: string;
  @IsInt() @Min(0) sortOrder!: number;
  @IsOptional() @IsEnum(ChangeCategory) category?: ChangeCategory;
  @IsOptional() @IsEnum(ChangeVisibility) visibility?: ChangeVisibility;
}

class BulkUpdateChangesInput {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkChangeItemInput)
  changes!: BulkChangeItemInput[];
}

class SetReleaseAudienceInput {
  @IsEnum(ReleaseAudienceMode) mode!: ReleaseAudienceMode;
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID("all", { each: true })
  audienceIds!: string[];
}

class ReleaseTranslationChangeInput {
  @IsUUID() changeId!: string;
  @IsString() @MinLength(1) @MaxLength(10000) description!: string;
}

class ReleaseTranslationInput {
  @IsString() @MinLength(2) @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(10000) summary?: string | null;
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ReleaseTranslationChangeInput)
  changes!: ReleaseTranslationChangeInput[];
}

type ExportResponse = { setHeader(name: string, value: string): void };

@ApiTags("internal releases")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("internal")
export class ReleasesController {
  constructor(private readonly releases: ReleasesService) {}
  @Get("search")
  search(
    @Req() req: AuthenticatedRequest,
    @Query("q") query: string | string[] = "",
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "30",
  ) {
    return this.releases.search(
      req.user,
      typeof query === "string" ? query : "",
      Number(page),
      Number(pageSize),
    );
  }
  @Get("releases/:releaseId/export.csv")
  async exportCsv(
    @Req() req: AuthenticatedRequest,
    @Param("releaseId", ParseUUIDPipe) releaseId: string,
    @Res({ passthrough: true }) response: ExportResponse,
  ) {
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="release-${releaseId}.csv"`,
    );
    response.setHeader("Cache-Control", "no-store");
    return this.releases.exportCsv(req.user, releaseId);
  }
  @Get("projects/:projectId/releases")
  list(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
  ) {
    return this.releases.list(req.user, projectId);
  }
  @Post("projects/:projectId/releases")
  create(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Body() body: CreateReleaseInput,
  ) {
    return this.releases.create(req.user, projectId, body);
  }
  @Get("projects/:projectId/releases/compare")
  compare(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Query("from", new ParseUUIDPipe()) fromReleaseId: string,
    @Query("to", new ParseUUIDPipe()) toReleaseId: string,
  ) {
    return this.releases.compare(
      req.user,
      projectId,
      fromReleaseId,
      toReleaseId,
    );
  }
  @Get("projects/:projectId/releases/compare/export")
  async exportComparison(
    @Req() req: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Query("from", new ParseUUIDPipe()) fromReleaseId: string,
    @Query("to", new ParseUUIDPipe()) toReleaseId: string,
    @Res({ passthrough: true }) response: ExportResponse,
    @Query("format") format = "csv",
  ) {
    const isJson = format === "json";
    response.setHeader(
      "Content-Type",
      isJson ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
    );
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="release-comparison-${fromReleaseId}-to-${toReleaseId}.${format}"`,
    );
    response.setHeader("Cache-Control", "no-store");
    return this.releases.exportComparison(
      req.user,
      projectId,
      fromReleaseId,
      toReleaseId,
      format,
    );
  }
  @Get("releases/:releaseId")
  get(@Req() req: AuthenticatedRequest, @Param("releaseId") releaseId: string) {
    return this.releases.get(req.user, releaseId);
  }
  @Put("releases/:releaseId/translations/:locale")
  saveTranslation(
    @Req() req: AuthenticatedRequest,
    @Param("releaseId", ParseUUIDPipe) releaseId: string,
    @Param("locale") locale: string,
    @Body() body: ReleaseTranslationInput,
  ) {
    return this.releases.saveTranslation(req.user, releaseId, locale, body);
  }
  @Get("releases/:releaseId/audience")
  getAudience(
    @Req() req: AuthenticatedRequest,
    @Param("releaseId") releaseId: string,
  ) {
    return this.releases.getAudience(req.user, releaseId);
  }
  @Patch("releases/:releaseId/audience")
  setAudience(
    @Req() req: AuthenticatedRequest,
    @Param("releaseId") releaseId: string,
    @Body() body: SetReleaseAudienceInput,
  ) {
    return this.releases.setAudience(req.user, releaseId, body);
  }
  @Patch("releases/:releaseId")
  update(
    @Req() req: AuthenticatedRequest,
    @Param("releaseId") releaseId: string,
    @Body() body: UpdateReleaseInput,
  ) {
    return this.releases.update(req.user, releaseId, body);
  }
  @Patch("releases/:releaseId/archive")
  archive(
    @Req() req: AuthenticatedRequest,
    @Param("releaseId") releaseId: string,
  ) {
    return this.releases.archive(req.user, releaseId);
  }
  @Post("releases/:releaseId/changes")
  addChange(
    @Req() req: AuthenticatedRequest,
    @Param("releaseId") releaseId: string,
    @Body() body: CreateChangeInput,
  ) {
    return this.releases.addChange(req.user, releaseId, body);
  }
  @Patch("releases/:releaseId/changes/bulk")
  bulkUpdateChanges(
    @Req() req: AuthenticatedRequest,
    @Param("releaseId") releaseId: string,
    @Body() body: BulkUpdateChangesInput,
  ) {
    return this.releases.bulkUpdateChanges(req.user, releaseId, body.changes);
  }
  @Patch("releases/:releaseId/changes/:changeId")
  updateChange(
    @Req() req: AuthenticatedRequest,
    @Param("releaseId") releaseId: string,
    @Param("changeId") changeId: string,
    @Body() body: CreateChangeInput,
  ) {
    return this.releases.updateChange(req.user, releaseId, changeId, body);
  }
  @Patch("releases/:releaseId/submit-review")
  submitForReview(
    @Req() req: AuthenticatedRequest,
    @Param("releaseId") releaseId: string,
  ) {
    return this.releases.submitForReview(req.user, releaseId);
  }
}
