import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Patch,
  Param,
  ParseUUIDPipe,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";
import { AuthService } from "./auth.service";
import { AuthenticatedRequest, JwtAuthGuard } from "./jwt-auth.guard";
import { OidcService } from "./oidc.service";

type AuthHttpResponse = { setHeader(name: string, value: string): void };
type AuthRedirectResponse = {
  setHeader(name: string, value: string | string[]): void;
  redirect(status: number, url: string): void;
};
type AuthRequest = {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
};
const REFRESH_COOKIE = "rdps_refresh";
const REFRESH_COOKIE_PATH = "/api/v1/internal/auth";
const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
const OIDC_TRANSACTION_COOKIE = "rdps_oidc_transaction";
const OIDC_TRANSACTION_COOKIE_PATH = "/api/v1/internal/auth/oidc";

class BootstrapInput {
  @IsEmail() @MaxLength(320) email!: string;
  @IsString() @MinLength(2) @MaxLength(160) displayName!: string;
  @IsString() @MinLength(12) @MaxLength(128) password!: string;
  @IsString() @MinLength(20) @MaxLength(256) bootstrapSecret!: string;
}
class LoginInput {
  @IsEmail() @MaxLength(320) email!: string;
  @IsString() @MinLength(1) @MaxLength(128) password!: string;
}
class ChangePasswordInput {
  @IsString() @MinLength(12) @MaxLength(128) currentPassword!: string;
  @IsString() @MinLength(12) @MaxLength(128) newPassword!: string;
}
class CompletePasswordResetInput {
  @IsString() @MinLength(32) @MaxLength(256) token!: string;
  @IsString() @MinLength(12) @MaxLength(128) password!: string;
}
class AcceptInvitationInput {
  @IsString() @MinLength(32) @MaxLength(256) token!: string;
  @IsString() @MinLength(12) @MaxLength(128) password!: string;
}

@ApiTags("auth")
@Controller("internal/auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly oidc: OidcService,
  ) {}
  @Post("bootstrap")
  @HttpCode(HttpStatus.OK)
  async bootstrap(
    @Body() body: BootstrapInput,
    @Res({ passthrough: true }) response: AuthHttpResponse,
  ) {
    const result = await this.auth.bootstrap(body);
    this.setRefreshCookie(response, result.refreshToken);
    return this.publicAuthResult(result);
  }
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginInput,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: AuthHttpResponse,
  ) {
    const userAgent = request.headers["user-agent"];
    const result = await this.auth.login(body, {
      ...(request.ip ? { ipAddress: request.ip } : {}),
      ...(Array.isArray(userAgent)
        ? userAgent[0]
          ? { userAgent: userAgent[0] }
          : {}
        : userAgent
          ? { userAgent }
          : {}),
    });
    this.setRefreshCookie(response, result.refreshToken);
    return this.publicAuthResult(result);
  }

  @Get("oidc/config")
  oidcConfig() {
    return { enabled: this.oidc.isEnabled() };
  }

  @Get("oidc/start")
  async startOidc(@Res() response: AuthRedirectResponse) {
    const result = await this.oidc.start();
    response.setHeader(
      "Set-Cookie",
      this.oidcTransactionCookie(result.transactionCookie),
    );
    response.redirect(302, result.authorizationUrl);
  }

  @Post("oidc/link/start")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async startOidcLink(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: AuthHttpResponse,
  ) {
    const result = await this.oidc.startLink(request.user.id);
    response.setHeader(
      "Set-Cookie",
      this.oidcTransactionCookie(result.transactionCookie),
    );
    return { authorizationUrl: result.authorizationUrl };
  }

  @Get("oidc/callback")
  async completeOidc(
    @Req() request: AuthRequest,
    @Res() response: AuthRedirectResponse,
  ) {
    const transactionCookie = this.readCookie(
      request.headers.cookie,
      OIDC_TRANSACTION_COOKIE,
    );
    try {
      const result = await this.oidc.complete(
        request.query ?? {},
        transactionCookie,
        {
          ...(request.ip ? { ipAddress: request.ip } : {}),
          ...this.userAgent(request.headers["user-agent"]),
        },
      );
      if ("linked" in result) {
        response.setHeader("Set-Cookie", this.clearOidcTransactionCookie());
        response.redirect(302, this.oidc.adminReturnUrl("linked"));
      } else {
        response.setHeader("Set-Cookie", [
          this.refreshCookie(result.refreshToken),
          this.clearOidcTransactionCookie(),
        ]);
        response.redirect(302, this.oidc.adminReturnUrl("success"));
      }
    } catch {
      response.setHeader("Set-Cookie", this.clearOidcTransactionCookie());
      response.redirect(302, this.oidc.adminReturnUrl("error"));
    }
  }
  @Post("invitations/accept")
  @HttpCode(HttpStatus.OK)
  async acceptInvitation(
    @Body() body: AcceptInvitationInput,
    @Res({ passthrough: true }) response: AuthHttpResponse,
  ) {
    const result = await this.auth.acceptInvitation(body.token, body.password);
    this.setRefreshCookie(response, result.refreshToken);
    return this.publicAuthResult(result);
  }
  @Post("password-reset/complete")
  @HttpCode(HttpStatus.OK)
  async completePasswordReset(
    @Body() body: CompletePasswordResetInput,
    @Res({ passthrough: true }) response: AuthHttpResponse,
  ) {
    const result = await this.auth.completePasswordReset(
      body.token,
      body.password,
    );
    this.setRefreshCookie(response, result.refreshToken);
    return this.publicAuthResult(result);
  }
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: AuthHttpResponse,
  ) {
    const refreshToken = this.readRefreshCookie(request.headers.cookie);
    if (!refreshToken) return this.clearRefreshCookie(response);
    const result = await this.auth.refresh(refreshToken);
    this.setRefreshCookie(response, result.refreshToken);
    return this.publicAuthResult(result);
  }
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: AuthHttpResponse,
  ) {
    const result = await this.auth.logout(
      this.readRefreshCookie(request.headers.cookie),
    );
    this.clearRefreshCookie(response);
    return result;
  }
  @Get("me")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  me(@Req() request: AuthenticatedRequest) {
    return this.auth.currentUser(request.user.id);
  }

  @Get("sessions")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  sessions(@Req() request: AuthenticatedRequest) {
    return this.auth.listSessions(request.user.id, request.user.sessionId);
  }

  @Delete("sessions/:sessionId")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  revokeSession(
    @Req() request: AuthenticatedRequest,
    @Param("sessionId", ParseUUIDPipe) sessionId: string,
  ) {
    return this.auth.revokeSession(request.user.id, sessionId);
  }

  @Patch("password")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  changePassword(
    @Req() request: AuthenticatedRequest,
    @Body() body: ChangePasswordInput,
  ) {
    return this.auth.changePassword(
      request.user.id,
      request.user.sessionId,
      body.currentPassword,
      body.newPassword,
    );
  }

  private publicAuthResult<T extends { refreshToken: string }>(
    result: T,
  ): Omit<T, "refreshToken"> {
    const { refreshToken: _refreshToken, ...publicResult } = result;
    return publicResult;
  }

  private setRefreshCookie(response: AuthHttpResponse, token: string) {
    response.setHeader("Set-Cookie", this.refreshCookie(token));
  }

  private refreshCookie(token: string) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return `${REFRESH_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=${REFRESH_COOKIE_PATH}; Max-Age=${REFRESH_COOKIE_MAX_AGE}${secure}`;
  }

  private oidcTransactionCookie(value: string) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return `${OIDC_TRANSACTION_COOKIE}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=${OIDC_TRANSACTION_COOKIE_PATH}; Max-Age=300${secure}`;
  }

  private clearOidcTransactionCookie() {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return `${OIDC_TRANSACTION_COOKIE}=; HttpOnly; SameSite=Lax; Path=${OIDC_TRANSACTION_COOKIE_PATH}; Max-Age=0${secure}`;
  }

  private userAgent(value?: string | string[]) {
    const userAgent = Array.isArray(value) ? value[0] : value;
    return userAgent ? { userAgent } : {};
  }

  private clearRefreshCookie(response: AuthHttpResponse) {
    response.setHeader(
      "Set-Cookie",
      `${REFRESH_COOKIE}=; HttpOnly; SameSite=Strict; Path=${REFRESH_COOKIE_PATH}; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
    );
    return { revoked: false };
  }

  private readRefreshCookie(
    cookieHeader?: string | string[],
  ): string | undefined {
    return this.readCookie(cookieHeader, REFRESH_COOKIE);
  }

  private readCookie(
    cookieHeader: string | string[] | undefined,
    cookieName: string,
  ): string | undefined {
    const header = Array.isArray(cookieHeader)
      ? cookieHeader.join(";")
      : cookieHeader;
    if (!header) return undefined;
    const item = header
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`));
    if (!item) return undefined;
    try {
      return decodeURIComponent(item.slice(cookieName.length + 1)) || undefined;
    } catch {
      return undefined;
    }
  }
}
