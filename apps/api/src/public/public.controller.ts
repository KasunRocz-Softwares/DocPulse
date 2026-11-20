import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Res,
  StreamableFile,
  UseInterceptors,
} from "@nestjs/common";
import { ApiQuery, ApiTags } from "@nestjs/swagger";
import { PublicAttachmentsService } from "./public-attachments.service";
import { PublicService } from "./public.service";
import { PublicResponseCacheInterceptor } from "./public-response-cache.interceptor";

type HttpResponse = { setHeader(name: string, value: string): void };

@ApiTags("public delivery")
@UseInterceptors(PublicResponseCacheInterceptor)
@Controller("public")
export class PublicController {
  constructor(
    private readonly publicDelivery: PublicService,
    private readonly publicAttachments: PublicAttachmentsService,
  ) {}

  @Get("host")
  @Header("Cache-Control", "no-store")
  @ApiQuery({ name: "hostname", required: true })
  resolveHost(@Query("hostname") hostname: string | string[] = "") {
    return this.publicDelivery.resolveHost(
      typeof hostname === "string" ? hostname : "",
    );
  }

  @Get("projects/:slug")
  project(@Param("slug") slug: string, @Query("locale") locale?: string) {
    return this.publicDelivery.project(slug, locale);
  }

  @Get("projects/:slug/releases")
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  releases(
    @Param("slug") slug: string,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
    @Query("locale") locale?: string,
  ) {
    return this.publicDelivery.releasePage(
      slug,
      Number(page),
      Number(pageSize),
      locale,
    );
  }

  @Get("projects/:slug/releases/latest")
  latest(@Param("slug") slug: string, @Query("locale") locale?: string) {
    return this.publicDelivery.latest(slug, locale);
  }

  @Get("projects/:slug/changelog")
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  changelog(
    @Param("slug") slug: string,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
    @Query("locale") locale?: string,
  ) {
    return this.publicDelivery.releasePage(
      slug,
      Number(page),
      Number(pageSize),
      locale,
    );
  }

  @Get("projects/:slug/search")
  @ApiQuery({ name: "q", required: true })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  search(
    @Param("slug") slug: string,
    @Query("q") query: string | string[] = "",
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
    @Query("locale") locale?: string,
  ) {
    return this.publicDelivery.search(
      slug,
      typeof query === "string" ? query : "",
      Number(page),
      Number(pageSize),
      locale,
    );
  }

  @Get("projects/:slug/rss.xml")
  @Header("Content-Type", "application/rss+xml; charset=utf-8")
  rss(@Param("slug") slug: string, @Query("locale") locale?: string) {
    return this.publicDelivery.rss(slug, locale);
  }

  @Get("projects/:slug/share")
  shareProject(@Param("slug") slug: string, @Query("locale") locale?: string) {
    return this.publicDelivery.shareMetadata(slug, undefined, locale);
  }

  @Get("projects/:slug/releases/:version/changes")
  changes(
    @Param("slug") slug: string,
    @Param("version") version: string,
    @Query("locale") locale?: string,
  ) {
    return this.publicDelivery.changes(slug, version, locale);
  }

  @Get("projects/:slug/releases/:version/share")
  shareRelease(
    @Param("slug") slug: string,
    @Param("version") version: string,
    @Query("locale") locale?: string,
  ) {
    return this.publicDelivery.shareMetadata(slug, version, locale);
  }

  @Get("projects/:slug/releases/:version/attachments/:attachmentId/download")
  @Header("Cache-Control", "no-store")
  async downloadAttachment(
    @Param("slug") slug: string,
    @Param("version") version: string,
    @Param("attachmentId") attachmentId: string,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const result = await this.publicAttachments.download(
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
    return new StreamableFile(result.bytes);
  }

  @Get("projects/:slug/releases/:version")
  release(
    @Param("slug") slug: string,
    @Param("version") version: string,
    @Query("locale") locale?: string,
  ) {
    return this.publicDelivery.release(slug, version, locale);
  }
}
