import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsObject } from "class-validator";
import { AuthenticatedRequest, JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PublicResponseCacheInterceptor } from "../public/public-response-cache.interceptor";
import { PublicPageService } from "./public-page.service";

class SavePublicPageDraftInput {
  /** Full page configuration; validated by PublicPageService. */
  @IsObject() config!: Record<string, unknown>;
}

@ApiTags("internal project public page")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("internal/projects/:projectId/public-page")
export class PublicPageController {
  constructor(private readonly pages: PublicPageService) {}

  @Get()
  get(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
  ) {
    return this.pages.get(request.user, projectId);
  }

  @Put("draft")
  saveDraft(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Body() body: SavePublicPageDraftInput,
  ) {
    return this.pages.saveDraft(request.user, projectId, body.config);
  }

  @Post("publish")
  publish(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
  ) {
    return this.pages.publish(request.user, projectId);
  }
}

@ApiTags("public delivery")
@UseInterceptors(PublicResponseCacheInterceptor)
@Controller("public")
export class PublicPageDeliveryController {
  constructor(private readonly pages: PublicPageService) {}

  /** Published page layout and theme for a project with public release notes. */
  @Get("projects/:slug/page")
  page(@Param("slug") slug: string) {
    return this.pages.publicConfig(slug);
  }
}
