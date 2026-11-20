import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsString, Matches } from "class-validator";
import { AuthenticatedRequest, JwtAuthGuard } from "../auth/jwt-auth.guard";
import {
  sha256,
  verifyGitHubSignature,
} from "../integrations/webhook-security";
import { WebhookIngestionService } from "../integrations/webhook-ingestion.service";
import { normalizeGitHubWebhook } from "../integrations/webhook-normalization";
import { GitHubAppService } from "./github-app.service";

class LinkRepositoryInput {
  @IsString() @Matches(/^\d{1,40}$/) repositoryId!: string;
}

type RawRequest = { rawBody?: Buffer };
type RedirectResponse = { redirect(statusCode: number, url: string): void };

@ApiTags("GitHub App")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("internal/projects/:projectId/github-app")
export class GitHubAppController {
  constructor(private readonly githubApp: GitHubAppService) {}

  @Get()
  status(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
  ) {
    return this.githubApp.getStatus(request.user, projectId);
  }

  @Post("installations")
  install(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
  ) {
    return this.githubApp.beginInstallation(request.user, projectId);
  }

  @Get("installations/:installationId/repositories")
  discover(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Param("installationId") installationId: string,
  ) {
    return this.githubApp.discoverRepositories(
      request.user,
      projectId,
      installationId,
    );
  }

  @Post("installations/:installationId/repositories")
  link(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Param("installationId") installationId: string,
    @Body() body: LinkRepositoryInput,
  ) {
    return this.githubApp.linkRepository(
      request.user,
      projectId,
      installationId,
      body.repositoryId,
    );
  }

  @Delete("repositories/:repositoryId")
  disconnectRepository(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Param("repositoryId") repositoryId: string,
  ) {
    return this.githubApp.disconnectRepository(
      request.user,
      projectId,
      repositoryId,
    );
  }

  @Delete("installations/:installationId")
  disconnectInstallation(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Param("installationId") installationId: string,
  ) {
    return this.githubApp.disconnectInstallation(
      request.user,
      projectId,
      installationId,
    );
  }
}

@ApiTags("GitHub App webhooks")
@Controller("integrations/github-app")
export class GitHubAppWebhookController {
  constructor(
    private readonly githubApp: GitHubAppService,
    private readonly ingestion: WebhookIngestionService,
  ) {}

  @Get("callback")
  async callback(
    @Query("state") state?: string,
    @Query("installation_id") installationId?: string,
    @Query("setup_action") setupAction?: string,
    @Res() response?: RedirectResponse,
  ) {
    if (!state || state.length < 32 || state.length > 200 || !installationId)
      throw new BadRequestException("GitHub callback parameters are invalid");
    const result = await this.githubApp.completeInstallation({
      state,
      installationId,
      ...(setupAction ? { setupAction } : {}),
    });
    const adminOrigin = process.env.GITHUB_APP_ADMIN_ORIGIN;
    const allowedOrigins = (process.env.WEB_BASE_URL ?? "")
      .split(",")
      .map((origin) => origin.trim());
    if (!response || !adminOrigin || !allowedOrigins.includes(adminOrigin))
      throw new ServiceUnavailableException(
        "GitHub App admin redirect is not configured",
      );
    const destination = new URL(adminOrigin);
    destination.searchParams.set("github_app", "connected");
    destination.hash = `/projects/${encodeURIComponent(result.projectId)}`;
    response.redirect(302, destination.toString());
  }

  @Post("webhook")
  @HttpCode(HttpStatus.ACCEPTED)
  async webhook(
    @Req() request: RawRequest,
    @Headers("x-hub-signature-256") signature?: string,
    @Headers("x-github-delivery") deliveryId?: string,
    @Headers("x-github-event") eventType?: string,
  ) {
    const rawBody = request.rawBody;
    if (!rawBody?.length)
      throw new ServiceUnavailableException(
        "GitHub webhook body is unavailable",
      );
    if (rawBody.length > 1_000_000)
      throw new BadRequestException("GitHub webhook payload is too large");
    const secret = process.env.GITHUB_APP_WEBHOOK_SECRET;
    if (!secret)
      throw new ServiceUnavailableException(
        "GitHub webhook integration is not configured",
      );
    if (!verifyGitHubSignature(rawBody, signature, secret))
      throw new UnauthorizedException("Invalid GitHub webhook signature");
    if (
      !deliveryId ||
      deliveryId.length > 255 ||
      !eventType ||
      eventType.length > 120
    )
      throw new BadRequestException("GitHub delivery headers are invalid");

    const payload = parseObject(rawBody);
    const installationId = idString(asObject(payload.installation).id);
    if (!installationId)
      throw new BadRequestException("GitHub installation ID is missing");
    if (["push", "pull_request", "issues", "release"].includes(eventType)) {
      const job = normalizeGitHubWebhook(eventType, payload);
      if (!job) return { accepted: true, ignored: true };
      if (
        !(await this.githubApp.isRepositoryLinked(
          installationId,
          job.repository,
        ))
      )
        return { accepted: true, ignored: true };
      return this.ingestion.ingest({
        provider: "github",
        deliveryId,
        eventType,
        payloadHash: sha256(rawBody),
        job,
      });
    }
    const added = normalizeRepos(payload.repositories_added);
    const removed = normalizeRepos(payload.repositories_removed);
    return this.githubApp.handleWebhook({
      deliveryId,
      payloadHash: sha256(rawBody),
      event: eventType,
      installationId,
      repositoriesAdded: added,
      repositoriesRemoved: removed,
      ...(typeof payload.action === "string" ? { action: payload.action } : {}),
    });
  }
}

function parseObject(body: Buffer): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(body.toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error("object required");
    return value as Record<string, unknown>;
  } catch {
    throw new BadRequestException("GitHub webhook body must be a JSON object");
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function idString(value: unknown): string | null {
  const id = typeof value === "number" ? String(value) : value;
  return typeof id === "string" && /^\d{1,40}$/.test(id) ? id : null;
}

function normalizeRepos(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 2_000).flatMap((entry) => {
    const repo = asObject(entry);
    const owner = asObject(repo.owner).login;
    const id = idString(repo.id);
    if (
      !id ||
      typeof owner !== "string" ||
      owner.length > 120 ||
      typeof repo.name !== "string" ||
      repo.name.length > 160
    )
      return [];
    return [{ id, owner, name: repo.name }];
  });
}
