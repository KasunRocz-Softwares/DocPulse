import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { AuthenticatedRequest, JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PublishingService } from "./publishing.service";

class ReviewComment {
  @IsOptional() @IsString() @MaxLength(4000) comment?: string;
}

@ApiTags("internal publishing")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("internal/approval-revisions")
export class ApprovalQueueController {
  constructor(private readonly publishing: PublishingService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.publishing.listReviewQueue(req.user);
  }

  /** Approved revisions waiting to be published, for publishers. */
  @Get("ready-to-publish")
  readyToPublish(@Req() req: AuthenticatedRequest) {
    return this.publishing.listReadyToPublish(req.user);
  }
}

@ApiTags("internal publishing")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("internal/releases/:releaseId")
export class PublishingController {
  constructor(private readonly publishing: PublishingService) {}
  @Post("approval-revisions") submit(
    @Req() req: AuthenticatedRequest,
    @Param("releaseId") id: string,
  ) {
    return this.publishing.submit(req.user, id);
  }
  @Patch("approval-revisions/:revisionId/approve") approve(
    @Req() req: AuthenticatedRequest,
    @Param("releaseId") id: string,
    @Param("revisionId") revisionId: string,
    @Body() body: ReviewComment,
  ) {
    return this.publishing.decide(req.user, id, revisionId, true, body.comment);
  }
  @Patch("approval-revisions/:revisionId/reject") reject(
    @Req() req: AuthenticatedRequest,
    @Param("releaseId") id: string,
    @Param("revisionId") revisionId: string,
    @Body() body: ReviewComment,
  ) {
    return this.publishing.decide(
      req.user,
      id,
      revisionId,
      false,
      body.comment,
    );
  }
  @Post("approval-revisions/:revisionId/publish") publish(
    @Req() req: AuthenticatedRequest,
    @Param("releaseId") id: string,
    @Param("revisionId") revisionId: string,
  ) {
    return this.publishing.publish(req.user, id, revisionId);
  }
  @Post("publications/:publicationId/unpublish") unpublish(
    @Req() req: AuthenticatedRequest,
    @Param("releaseId") id: string,
    @Param("publicationId") publicationId: string,
  ) {
    return this.publishing.unpublish(req.user, id, publicationId);
  }
}
