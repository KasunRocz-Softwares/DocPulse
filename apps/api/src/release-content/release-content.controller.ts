import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsISO8601,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { AuthenticatedRequest, JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ReleaseContentService } from "./release-content.service";

type HttpResponse = { setHeader(name: string, value: string): void };
type UploadedAttachment = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

class DocumentInput {
  @IsString() @MinLength(1) @MaxLength(120) section!: string;
  @IsString() @MinLength(1) @MaxLength(240) title!: string;
  @IsObject() content!: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}
class DocumentUpdateInput {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) section?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(240) title?: string;
  @IsOptional() @IsObject() content?: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}
class ReorderInput {
  @IsArray() @IsString({ each: true }) documentIds!: string[];
}
class PublicAttachmentInput {
  @IsBoolean() publicAllowed!: boolean;
}
class DeploymentInput {
  @IsString() environmentId!: string;
  @IsString() @MinLength(1) @MaxLength(40) status!: string;
  @IsOptional() @IsString() @MaxLength(255) externalId?: string;
  @IsOptional() @IsISO8601() deployedAt?: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}
class DeploymentUpdateInput {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(40) status?: string;
  @IsOptional() @IsString() @MaxLength(255) externalId?: string | null;
  @IsOptional() @IsISO8601() deployedAt?: string | null;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

@ApiTags("release content")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("internal/projects/:projectId/releases/:releaseId")
export class ReleaseContentController {
  constructor(private readonly content: ReleaseContentService) {}

  @Get("documents") listDocuments(
    @Req() req: AuthenticatedRequest,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("releaseId", ParseUUIDPipe) releaseId: string,
  ) {
    return this.content.listDocuments(req.user, projectId, releaseId);
  }
  @Get("documents/:documentId") getDocument(
    @Req() req: AuthenticatedRequest,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("documentId", ParseUUIDPipe) documentId: string,
  ) {
    return this.content.getDocument(req.user, projectId, documentId);
  }
  @Post("documents") createDocument(
    @Req() req: AuthenticatedRequest,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("releaseId", ParseUUIDPipe) releaseId: string,
    @Body() body: DocumentInput,
  ) {
    return this.content.createDocument(req.user, projectId, releaseId, body);
  }
  @Patch("documents/reorder") reorderDocuments(
    @Req() req: AuthenticatedRequest,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("releaseId", ParseUUIDPipe) releaseId: string,
    @Body() body: ReorderInput,
  ) {
    return this.content.reorderDocuments(
      req.user,
      projectId,
      releaseId,
      body.documentIds,
    );
  }
  @Patch("documents/:documentId") updateDocument(
    @Req() req: AuthenticatedRequest,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("documentId", ParseUUIDPipe) documentId: string,
    @Body() body: DocumentUpdateInput,
  ) {
    return this.content.updateDocument(req.user, projectId, documentId, body);
  }
  @Delete("documents/:documentId") deleteDocument(
    @Req() req: AuthenticatedRequest,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("documentId", ParseUUIDPipe) documentId: string,
  ) {
    return this.content.deleteDocument(req.user, projectId, documentId);
  }

  @Get("attachments") listAttachments(
    @Req() req: AuthenticatedRequest,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("releaseId", ParseUUIDPipe) releaseId: string,
  ) {
    return this.content.listAttachments(req.user, projectId, releaseId);
  }
  @Post("attachments")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 25 * 1024 * 1024, files: 1 },
    }),
  )
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  uploadAttachment(
    @Req() req: AuthenticatedRequest,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("releaseId", ParseUUIDPipe) releaseId: string,
    @UploadedFile() file: UploadedAttachment,
  ) {
    return this.content.uploadAttachment(req.user, projectId, releaseId, file);
  }
  @Post("attachments/:attachmentId/scan") scanAttachment(
    @Req() req: AuthenticatedRequest,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("attachmentId", ParseUUIDPipe) attachmentId: string,
  ) {
    return this.content.scanAttachment(req.user, projectId, attachmentId);
  }
  @Patch("attachments/:attachmentId/public") setAttachmentPublic(
    @Req() req: AuthenticatedRequest,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("attachmentId", ParseUUIDPipe) attachmentId: string,
    @Body() body: PublicAttachmentInput,
  ) {
    return this.content.setAttachmentPublic(
      req.user,
      projectId,
      attachmentId,
      body.publicAllowed,
    );
  }
  @Get("attachments/:attachmentId/download") async downloadPrivate(
    @Req() req: AuthenticatedRequest,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("attachmentId", ParseUUIDPipe) attachmentId: string,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const result = await this.content.getPrivateAttachment(
      req.user,
      projectId,
      attachmentId,
    );
    response.setHeader("Content-Type", result.metadata.contentType);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(result.metadata.fileName)}`,
    );
    return new StreamableFile(result.bytes);
  }

  @Get("deployments") listDeployments(
    @Req() req: AuthenticatedRequest,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("releaseId", ParseUUIDPipe) releaseId: string,
  ) {
    return this.content.listDeployments(req.user, projectId, releaseId);
  }
  @Post("deployments") createDeployment(
    @Req() req: AuthenticatedRequest,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("releaseId", ParseUUIDPipe) releaseId: string,
    @Body() body: DeploymentInput,
  ) {
    return this.content.createDeployment(req.user, projectId, releaseId, body);
  }
  @Patch("deployments/:deploymentId") updateDeployment(
    @Req() req: AuthenticatedRequest,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("deploymentId", ParseUUIDPipe) deploymentId: string,
    @Body() body: DeploymentUpdateInput,
  ) {
    return this.content.updateDeployment(
      req.user,
      projectId,
      deploymentId,
      body,
    );
  }
}
