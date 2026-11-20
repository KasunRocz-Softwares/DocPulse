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
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from "class-validator";
import { AuthenticatedRequest, JwtAuthGuard } from "../auth/jwt-auth.guard";
import { NotificationsService } from "./notifications.service";

class SubscribeInput {
  @IsEmail() @MaxLength(320) email!: string;
  @IsOptional()
  @Matches(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
  locale?: string;
}
class TokenInput {
  @IsString() @MaxLength(256) token!: string;
  @IsString() @MaxLength(80) project!: string;
}
class PreferencesInput {
  @IsOptional() @IsBoolean() newReleases?: boolean;
  @IsOptional() @IsBoolean() securityOnly?: boolean;
}
@ApiTags("public subscriptions")
@Controller("public")
export class PublicNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}
  @Post("projects/:slug/subscriptions") subscribe(
    @Param("slug") slug: string,
    @Body() input: SubscribeInput,
  ) {
    return this.notifications.subscribe(slug, input);
  }
  @Post("projects/:slug/releases/:releaseId/subscriptions") subscribeRelease(
    @Param("slug") slug: string,
    @Param("releaseId", new ParseUUIDPipe()) releaseId: string,
    @Body() input: SubscribeInput,
  ) {
    return this.notifications.subscribe(slug, { ...input, releaseId });
  }
  @Post("subscriptions/verify") confirm(@Body() input: TokenInput) {
    return this.notifications.confirm(input.token);
  }
  @Post("subscriptions/unsubscribe") unsubscribe(@Body() input: TokenInput) {
    return this.notifications.unsubscribe(input.project, input.token);
  }
}

@ApiTags("internal notifications")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("internal/projects/:projectId/subscriptions")
export class ProjectNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}
  @Get() list(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
  ) {
    return this.notifications.listSubscriptions(request.user, projectId);
  }
  @Get("releases/:releaseId") listRelease(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Param("releaseId", new ParseUUIDPipe()) releaseId: string,
  ) {
    return this.notifications.listSubscriptions(
      request.user,
      projectId,
      releaseId,
    );
  }
  @Patch(":subscriptionId/preferences") update(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Param("subscriptionId") id: string,
    @Body() input: PreferencesInput,
  ) {
    return this.notifications.updatePreferences(
      request.user,
      projectId,
      id,
      input,
    );
  }
  @Patch("releases/:releaseId/:subscriptionId/preferences") updateRelease(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Param("releaseId", new ParseUUIDPipe()) releaseId: string,
    @Param("subscriptionId") id: string,
    @Body() input: PreferencesInput,
  ) {
    return this.notifications.updatePreferences(
      request.user,
      projectId,
      id,
      input,
      releaseId,
    );
  }
}

@ApiTags("notification worker")
@Controller("internal/notifications/worker")
export class NotificationWorkerController {
  constructor(private readonly notifications: NotificationsService) {}
  @Post("deliveries/:id/sent") sent(
    @Param("id") id: string,
    @Headers("x-rdps-worker-secret") secret?: string,
  ) {
    this.assertSecret(secret);
    return this.notifications.markDelivery(id, "SENT");
  }
  @Post("deliveries/:id/failed") failed(
    @Param("id") id: string,
    @Body() input: { code?: string },
    @Headers("x-rdps-worker-secret") secret?: string,
  ) {
    this.assertSecret(secret);
    return this.notifications.markDelivery(id, "FAILED", input.code);
  }
  @Post("deliveries/:id/dead") dead(
    @Param("id") id: string,
    @Headers("x-rdps-worker-secret") secret?: string,
  ) {
    this.assertSecret(secret);
    return this.notifications.markDelivery(id, "DEAD", "RETRIES_EXHAUSTED");
  }
  private assertSecret(value?: string) {
    const expected = process.env.NOTIFICATION_WORKER_SECRET;
    if (!expected || value !== expected) throw new UnauthorizedException();
  }
}
