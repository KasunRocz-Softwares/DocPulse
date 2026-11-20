import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { isEmail } from "class-validator";
import {
  createOidcTransactionCookie,
  readOidcTransactionCookie,
  resolveOidcAdminRedirect,
  resolveOidcCallbackUrl,
} from "@rdps/auth/oidc";
import { AuthService } from "./auth.service";
import {
  OIDC_PROTOCOL,
  type OidcProtocol,
  type OidcSettings,
} from "./oidc.protocol";

export type OidcClient = { ipAddress?: string; userAgent?: string };
export type OidcStartResult = {
  authorizationUrl: string;
  transactionCookie: string;
};

@Injectable()
export class OidcService {
  constructor(
    private readonly auth: AuthService,
    @Inject(OIDC_PROTOCOL) private readonly protocol: OidcProtocol,
  ) {}

  isEnabled() {
    try {
      this.settings();
      return true;
    } catch {
      return false;
    }
  }

  async start(): Promise<OidcStartResult> {
    return this.startFlow();
  }

  async startLink(userId: string): Promise<OidcStartResult> {
    return this.startFlow(userId);
  }

  private async startFlow(linkUserId?: string): Promise<OidcStartResult> {
    const settings = this.settings();
    const transaction = await this.protocol.createTransaction();
    const authorizationUrl = await this.protocol.authorizationUrl(
      settings,
      transaction,
    );
    return {
      authorizationUrl,
      transactionCookie: createOidcTransactionCookie(
        {
          ...transaction,
          purpose: linkUserId ? "link" : "login",
          ...(linkUserId ? { userId: linkUserId } : {}),
        },
        this.required("OIDC_STATE_SECRET"),
      ),
    };
  }

  async complete(
    callbackQuery: Record<string, unknown>,
    transactionCookie: string | undefined,
    client: OidcClient,
  ) {
    const settings = this.settings();
    const state = queryString(callbackQuery.state);
    const code = queryString(callbackQuery.code);
    if (!state || !code || callbackQuery.error)
      throw new UnauthorizedException("OIDC sign-in was cancelled or rejected");
    const transaction = readOidcTransactionCookie(
      transactionCookie,
      this.required("OIDC_STATE_SECRET"),
      state,
    );
    if (!transaction)
      throw new UnauthorizedException(
        "OIDC sign-in transaction is invalid or expired",
      );

    const callback = new URL(settings.callbackUrl);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", state);
    if (callbackQuery.iss !== undefined) {
      const responseIssuer = queryString(callbackQuery.iss);
      if (!responseIssuer)
        throw new UnauthorizedException(
          "OIDC authorization response issuer is invalid",
        );
      callback.searchParams.set("iss", responseIssuer);
    }
    const claims = await this.protocol.exchange(
      settings,
      callback.toString(),
      transaction,
    );
    const identity = this.validateClaims(claims, settings);
    if (transaction.purpose === "link") {
      if (!transaction.userId)
        throw new UnauthorizedException(
          "OIDC account link transaction is invalid",
        );
      return this.auth.linkOidcIdentity(identity, transaction.userId);
    }
    if (transaction.purpose && transaction.purpose !== "login")
      throw new UnauthorizedException("OIDC transaction purpose is invalid");
    return this.auth.loginWithOidc(identity, client);
  }

  adminReturnUrl(result: "success" | "linked" | "error" = "success") {
    const target = resolveOidcAdminRedirect(
      this.required("RDPS_OIDC_ADMIN_ORIGIN"),
      process.env.WEB_BASE_URL ?? "",
    );
    const url = new URL(target);
    if (result === "error")
      url.searchParams.set("oidc_error", "authentication_failed");
    else url.searchParams.set("oidc", result);
    return url.toString();
  }

  private settings(): OidcSettings {
    if (Buffer.byteLength(this.required("OIDC_STATE_SECRET")) < 32)
      throw new ServiceUnavailableException(
        "OIDC_STATE_SECRET must contain at least 32 bytes",
      );
    const issuer = this.required("OIDC_ISSUER");
    let issuerUrl: URL;
    try {
      issuerUrl = new URL(issuer);
    } catch {
      throw new ServiceUnavailableException(
        "OIDC issuer must be an absolute URL",
      );
    }
    const loopback =
      issuerUrl.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(issuerUrl.hostname);
    if (issuerUrl.protocol !== "https:" && !loopback)
      throw new ServiceUnavailableException(
        "OIDC issuer must use HTTPS outside loopback development",
      );
    if (
      issuerUrl.username ||
      issuerUrl.password ||
      issuerUrl.search ||
      issuerUrl.hash
    )
      throw new ServiceUnavailableException("OIDC issuer URL is invalid");
    const callbackUrl = resolveOidcCallbackUrl(
      this.required("OIDC_CALLBACK_URL"),
      this.required("RDPS_API_PUBLIC_ORIGIN"),
    );
    resolveOidcAdminRedirect(
      this.required("RDPS_OIDC_ADMIN_ORIGIN"),
      process.env.WEB_BASE_URL ?? "",
    );
    return {
      issuer: issuerUrl.toString(),
      clientId: this.required("OIDC_CLIENT_ID"),
      clientSecret: this.required("OIDC_CLIENT_SECRET"),
      callbackUrl,
    };
  }

  private validateClaims(
    claims: Record<string, unknown>,
    settings: OidcSettings,
  ) {
    const audience = claims.aud;
    const audienceMatches =
      typeof audience === "string"
        ? audience === settings.clientId
        : Array.isArray(audience) && audience.includes(settings.clientId);
    const authorizedPartyMatches =
      claims.azp === undefined
        ? !Array.isArray(audience) || audience.length <= 1
        : claims.azp === settings.clientId;
    const expiry = claims.exp;
    if (
      claims.iss !== settings.issuer ||
      !audienceMatches ||
      !authorizedPartyMatches ||
      typeof expiry !== "number" ||
      !Number.isFinite(expiry) ||
      expiry <= Math.floor(Date.now() / 1000) ||
      typeof claims.sub !== "string" ||
      !claims.sub ||
      claims.sub.length > 255 ||
      claims.email_verified !== true ||
      typeof claims.email !== "string" ||
      !isEmail(claims.email) ||
      claims.email.length > 320
    )
      throw new UnauthorizedException(
        "OIDC identity claims are invalid or unverified",
      );
    const displayName = [
      claims.name,
      claims.preferred_username,
      claims.email,
    ].find(
      (value): value is string =>
        typeof value === "string" && Boolean(value.trim()),
    );
    if (!displayName || displayName.trim().length > 160)
      throw new UnauthorizedException(
        "OIDC profile does not contain a usable display name",
      );
    return {
      issuer: settings.issuer,
      subject: claims.sub,
      email: claims.email,
      displayName: displayName.trim(),
    };
  }

  private required(name: string) {
    const value = process.env[name]?.trim();
    if (!value)
      throw new ServiceUnavailableException(`OIDC is not configured (${name})`);
    return value;
  }
}

function queryString(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= 4096
    ? value
    : null;
}
