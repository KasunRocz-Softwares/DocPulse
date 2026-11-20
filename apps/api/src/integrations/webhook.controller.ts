import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import {
  sha256,
  verifyDeploymentSignature,
  verifyGitHubSignature,
} from "./webhook-security";
import {
  normalizeDeploymentWebhook,
  normalizeGitHubWebhook,
} from "./webhook-normalization";
import { WebhookIngestionService } from "./webhook-ingestion.service";

type RequestWithRawBody = { rawBody?: Buffer };

@Controller("integrations")
export class WebhookController {
  constructor(private readonly ingestion: WebhookIngestionService) {}

  @Post("github/webhook")
  @HttpCode(HttpStatus.ACCEPTED)
  async github(
    @Req() request: RequestWithRawBody,
    @Headers("x-hub-signature-256") signature?: string,
    @Headers("x-github-delivery") deliveryId?: string,
    @Headers("x-github-event") eventType?: string,
  ) {
    const rawBody = this.requireRawBody(request);
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret)
      throw new ServiceUnavailableException(
        "GitHub webhook integration is not configured",
      );
    if (!verifyGitHubSignature(rawBody, signature, secret))
      throw new UnauthorizedException("Invalid webhook signature");
    if (
      !deliveryId ||
      deliveryId.length > 255 ||
      !eventType ||
      eventType.length > 120
    ) {
      throw new BadRequestException(
        "Required GitHub delivery headers are missing or invalid",
      );
    }
    const payload = parseJson(rawBody);
    const job = normalizeGitHubWebhook(eventType, payload);
    if (!job) return { accepted: true, ignored: true };
    return this.ingestion.ingest({
      provider: "github",
      deliveryId,
      eventType,
      payloadHash: sha256(rawBody),
      job,
    });
  }

  @Post("deployments/webhook")
  @HttpCode(HttpStatus.ACCEPTED)
  async deployment(
    @Req() request: RequestWithRawBody,
    @Headers("x-rdps-signature") signature?: string,
    @Headers("x-rdps-timestamp") timestamp?: string,
    @Headers("x-rdps-delivery-id") deliveryId?: string,
  ) {
    const rawBody = this.requireRawBody(request);
    const secret = process.env.DEPLOYMENT_WEBHOOK_SECRET;
    if (!secret)
      throw new ServiceUnavailableException(
        "Deployment webhook integration is not configured",
      );
    if (!verifyDeploymentSignature(rawBody, timestamp, signature, secret)) {
      throw new UnauthorizedException("Invalid or expired webhook signature");
    }
    if (!deliveryId || deliveryId.length > 255)
      throw new BadRequestException("Delivery ID is missing or invalid");
    const payload = parseJson(rawBody);
    const provider =
      typeof payload.provider === "string" &&
      /^[a-z0-9_-]{1,40}$/i.test(payload.provider)
        ? payload.provider.toLowerCase()
        : "generic";
    const job = normalizeDeploymentWebhook(provider, payload);
    if (!job)
      throw new BadRequestException(
        "Deployment event does not match the ingestion contract",
      );
    return this.ingestion.ingest({
      provider: "deployment",
      deliveryId,
      eventType: "deployment",
      payloadHash: sha256(rawBody),
      job,
    });
  }

  private requireRawBody(request: RequestWithRawBody): Buffer {
    if (!request.rawBody?.length)
      throw new ServiceUnavailableException(
        "Raw-body capture must be enabled in the API bootstrap",
      );
    return request.rawBody;
  }
}

function parseJson(rawBody: Buffer): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(rawBody.toString("utf8"));
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object")
      throw new Error("object required");
    return parsed as Record<string, unknown>;
  } catch {
    throw new BadRequestException("Webhook body must be a JSON object");
  }
}
