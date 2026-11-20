import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { UserStatus } from "../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";
import {
  LocalPasswordIdentityProvider,
  PASSWORD_IDENTITY_PROVIDER,
  PasswordIdentityProvider,
  type ExternalIdentity,
} from "./identity-provider";

const userProjection = {
  id: true,
  email: true,
  displayName: true,
  status: true,
  isSystemAdmin: true,
} as const;

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const LOGIN_IP_MAX_FAILURES = 60;

type SessionClient = { ipAddress?: string; userAgent?: string };
type ActiveUser = {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
  isSystemAdmin: boolean;
};

@Injectable()
export class AuthService {
  private readonly passwords: PasswordIdentityProvider;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Optional()
    @Inject(PASSWORD_IDENTITY_PROVIDER)
    passwords?: PasswordIdentityProvider,
  ) {
    this.passwords = passwords ?? new LocalPasswordIdentityProvider();
  }

  async bootstrap(input: {
    email: string;
    displayName: string;
    password: string;
    bootstrapSecret: string;
  }) {
    const expectedSecret = process.env.BOOTSTRAP_SECRET;
    if (!expectedSecret || input.bootstrapSecret !== expectedSecret)
      throw new UnauthorizedException("Invalid bootstrap credentials");
    const refreshToken = this.newRefreshToken();
    const now = new Date();
    try {
      const created = await this.prisma.$transaction(
        async (tx) => {
          if (await tx.user.count())
            throw new ConflictException(
              "Initial administrator has already been created",
            );
          const created = await tx.user.create({
            data: {
              email: input.email.toLowerCase().trim(),
              displayName: input.displayName.trim(),
              passwordHash: await this.passwords.hashPassword(
                input.password,
                12,
              ),
              status: UserStatus.ACTIVE,
              isSystemAdmin: true,
            },
            select: userProjection,
          });
          await tx.auditLog.create({
            data: {
              actorId: created.id,
              action: "identity.bootstrap",
              entityType: "user",
              entityId: created.id,
            },
          });
          const session = await tx.userSession.create({
            data: {
              userId: created.id,
              refreshTokenHash: this.hashSecret(refreshToken),
              expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
            },
          });
          await tx.auditLog.create({
            data: {
              actorId: created.id,
              action: "identity.session.created",
              entityType: "user_session",
              entityId: session.id,
            },
          });
          return { user: created, session };
        },
        { isolationLevel: "Serializable" },
      );
      return {
        ...this.issue(created.user, created.session.id),
        refreshToken,
      };
    } catch (error) {
      if (isPrismaCode(error, "P2034"))
        throw new ConflictException(
          "Initial administrator has already been created",
        );
      throw error;
    }
  }

  async login(
    input: { email: string; password: string },
    client: SessionClient = {},
  ) {
    const email = input.email.toLowerCase().trim();
    const attemptKeys = this.loginAttemptKeys(email, client.ipAddress);
    await Promise.all(
      attemptKeys.map(({ identifierHash }) =>
        this.assertLoginAllowed(identifierHash),
      ),
    );
    const user = await this.prisma.user.findUnique({
      where: { email },
    });
    if (
      !user?.passwordHash ||
      user.status !== UserStatus.ACTIVE ||
      !(await this.passwords.verifyPassword(input.password, user.passwordHash))
    ) {
      await this.recordLoginFailures(attemptKeys);
      throw new UnauthorizedException("Email or password is incorrect");
    }
    await this.prisma.loginAttempt.deleteMany({
      where: { identifierHash: this.loginAttemptKey(email, client.ipAddress) },
    });
    return this.createSession(
      {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        status: user.status,
        isSystemAdmin: user.isSystemAdmin,
      },
      client,
    );
  }

  async loginWithOidc(identity: ExternalIdentity, client: SessionClient = {}) {
    const issuer = identity.issuer.trim();
    const subject = identity.subject;
    const email = identity.email.trim().toLowerCase();
    const displayName = identity.displayName.trim();
    if (
      !issuer ||
      issuer.length > 2048 ||
      !subject ||
      subject.length > 255 ||
      !email ||
      email.length > 320 ||
      !displayName ||
      displayName.length > 160
    )
      throw new UnauthorizedException("OIDC identity is invalid");

    const provider = "oidc";
    const providerSubject = oidcProviderSubject(issuer, subject);

    const linked = await this.prisma.identity.findUnique({
      where: { provider_providerSubject: { provider, providerSubject } },
      include: { user: true },
    });
    if (linked) {
      if (linked.user.status !== UserStatus.ACTIVE)
        throw new UnauthorizedException("RDPS account is inactive");
      return this.createSession(
        {
          id: linked.user.id,
          email: linked.user.email,
          displayName: linked.user.displayName,
          status: linked.user.status,
          isSystemAdmin: linked.user.isSystemAdmin,
        },
        client,
      );
    }

    if (
      await this.prisma.user.findUnique({
        where: { email },
        select: { id: true },
      })
    )
      throw new UnauthorizedException(
        "OIDC identity is not linked to this RDPS account",
      );
    if (process.env.OIDC_AUTO_PROVISION !== "true")
      throw new UnauthorizedException("OIDC account provisioning is disabled");

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email, displayName, status: UserStatus.ACTIVE },
          select: userProjection,
        });
        await tx.identity.create({
          data: { userId: user.id, provider, providerSubject },
        });
        await tx.auditLog.create({
          data: {
            actorId: user.id,
            action: "identity.oidc.provisioned",
            entityType: "user",
            entityId: user.id,
            metadata: { issuer },
          },
        });
        return user;
      });
      return this.createSession(created, client);
    } catch (error) {
      if (isPrismaCode(error, "P2002"))
        throw new UnauthorizedException(
          "OIDC identity could not be provisioned; contact an administrator",
        );
      throw error;
    }
  }

  async linkOidcIdentity(identity: ExternalIdentity, userId: string) {
    const issuer = identity.issuer.trim();
    const subject = identity.subject;
    const email = identity.email.trim().toLowerCase();
    if (!issuer || issuer.length > 2048 || !subject || subject.length > 255)
      throw new UnauthorizedException("OIDC identity is invalid");
    const provider = "oidc";
    const providerSubject = oidcProviderSubject(issuer, subject);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true, status: true },
        });
        if (!user || user.status !== UserStatus.ACTIVE)
          throw new UnauthorizedException("RDPS account is inactive");
        if (user.email.toLowerCase() !== email)
          throw new UnauthorizedException(
            "Verified organization email must match the signed-in RDPS account",
          );
        const existing = await tx.identity.findUnique({
          where: { provider_providerSubject: { provider, providerSubject } },
          select: { userId: true },
        });
        if (existing) {
          if (existing.userId === userId)
            return { linked: true, alreadyLinked: true };
          throw new ConflictException(
            "This organization identity is already linked to another RDPS account",
          );
        }
        const link = await tx.identity.create({
          data: { userId, provider, providerSubject },
        });
        await tx.auditLog.create({
          data: {
            actorId: userId,
            action: "identity.oidc.linked",
            entityType: "identity",
            entityId: link.id,
            metadata: { issuer },
          },
        });
        return { linked: true, alreadyLinked: false };
      });
    } catch (error) {
      if (isPrismaCode(error, "P2002"))
        throw new ConflictException(
          "This organization identity is already linked to an RDPS account",
        );
      throw error;
    }
  }

  async acceptInvitation(token: string, password: string) {
    const tokenHash = this.hashSecret(token);
    const now = new Date();
    const invitation = await this.prisma.projectInvitation.findUnique({
      where: { tokenHash },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt.getTime() <= now.getTime()
    )
      throw new UnauthorizedException("Invitation is invalid or expired");
    const user = await this.prisma.user.findUnique({
      where: { email: invitation.email },
      select: userProjection,
    });
    if (!user || user.status !== UserStatus.INVITED)
      throw new UnauthorizedException("Invitation is invalid or expired");
    const passwordHash = await this.passwords.hashPassword(password, 12);
    const refreshToken = this.newRefreshToken();
    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.projectInvitation.updateMany({
        where: {
          id: invitation.id,
          tokenHash,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { acceptedAt: now },
      });
      if (claimed.count !== 1)
        throw new UnauthorizedException("Invitation is invalid or expired");
      const activated = await tx.user.updateMany({
        where: { id: user.id, status: UserStatus.INVITED, passwordHash: null },
        data: { status: UserStatus.ACTIVE, passwordHash },
      });
      if (activated.count !== 1)
        throw new UnauthorizedException("Invitation is invalid or expired");
      const session = await tx.userSession.create({
        data: {
          userId: user.id,
          refreshTokenHash: this.hashSecret(refreshToken),
          expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          projectId: invitation.projectId,
          action: "identity.invitation.accepted",
          entityType: "project_invitation",
          entityId: invitation.id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "identity.session.created",
          entityType: "user_session",
          entityId: session.id,
        },
      });
      return { session };
    });
    return {
      ...this.issue({ ...user, status: UserStatus.ACTIVE }, result.session.id),
      refreshToken,
    };
  }

  /** Complete a one-time password link issued by a system administrator. */
  async completePasswordReset(token: string, password: string) {
    const tokenHash = this.hashSecret(token);
    const now = new Date();
    const reset = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        usedAt: true,
        revokedAt: true,
        expiresAt: true,
        user: { select: { ...userProjection } },
      },
    });
    if (
      !reset ||
      reset.usedAt ||
      reset.revokedAt ||
      reset.expiresAt.getTime() <= now.getTime() ||
      reset.user.status === UserStatus.SUSPENDED
    )
      throw new UnauthorizedException("Password link is invalid or expired");
    const user = reset.user;
    const passwordHash = await this.passwords.hashPassword(password, 12);
    const refreshToken = this.newRefreshToken();
    const session = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: {
          id: reset.id,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (claimed.count !== 1)
        throw new UnauthorizedException("Password link is invalid or expired");
      const updated = await tx.user.updateMany({
        where: { id: user.id, status: { not: UserStatus.SUSPENDED } },
        data: { passwordHash, status: UserStatus.ACTIVE },
      });
      if (updated.count !== 1)
        throw new UnauthorizedException("Password link is invalid or expired");
      // A new password signs the user out everywhere else.
      await tx.userSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });
      // Setting a first password also completes any pending invitations.
      if (user.status === UserStatus.INVITED)
        await tx.projectInvitation.updateMany({
          where: { email: user.email, acceptedAt: null, revokedAt: null },
          data: { acceptedAt: now },
        });
      const created = await tx.userSession.create({
        data: {
          userId: user.id,
          refreshTokenHash: this.hashSecret(refreshToken),
          expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "identity.password.reset",
          entityType: "password_reset_token",
          entityId: reset.id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "identity.session.created",
          entityType: "user_session",
          entityId: created.id,
        },
      });
      return created;
    });
    return {
      ...this.issue({ ...user, status: UserStatus.ACTIVE }, session.id),
      refreshToken,
    };
  }

  async refresh(refreshToken: string): Promise<{
    accessToken: string;
    tokenType: string;
    expiresIn: number;
    user: ActiveUser;
    refreshToken: string;
  }> {
    const previousHash = this.hashSecret(refreshToken);
    const now = new Date();
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash: previousHash },
      include: { user: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.user.status !== UserStatus.ACTIVE
    )
      throw new UnauthorizedException("Refresh session is invalid or expired");

    const nextRefreshToken = this.newRefreshToken();
    const nextExpiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    return this.prisma.$transaction(async (tx) => {
      const rotated = await tx.userSession.updateMany({
        where: {
          id: session.id,
          refreshTokenHash: previousHash,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: {
          refreshTokenHash: this.hashSecret(nextRefreshToken),
          expiresAt: nextExpiresAt,
          lastUsedAt: now,
        },
      });
      if (rotated.count !== 1)
        throw new UnauthorizedException("Refresh token has already been used");
      await tx.auditLog.create({
        data: {
          actorId: session.userId,
          action: "identity.session.refreshed",
          entityType: "user_session",
          entityId: session.id,
        },
      });
      return {
        ...this.issue(session.user, session.id),
        refreshToken: nextRefreshToken,
      };
    });
  }

  async logout(refreshToken?: string): Promise<{ revoked: boolean }> {
    if (!refreshToken) return { revoked: false };
    const refreshTokenHash = this.hashSecret(refreshToken);
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash },
      select: { id: true, userId: true },
    });
    if (!session) return { revoked: false };
    return this.prisma.$transaction(async (tx) => {
      const revoked = await tx.userSession.updateMany({
        where: { id: session.id, refreshTokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count === 1)
        await tx.auditLog.create({
          data: {
            actorId: session.userId,
            action: "identity.session.revoked",
            entityType: "user_session",
            entityId: session.id,
          },
        });
      return { revoked: revoked.count === 1 };
    });
  }

  async currentUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: userProjection,
    });
    if (!user || user.status !== UserStatus.ACTIVE)
      throw new UnauthorizedException();
    const memberships = await this.prisma.projectMember.findMany({
      where: { userId },
      select: {
        role: true,
        project: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { project: { name: "asc" } },
    });
    return { ...user, memberships };
  }

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        userAgent: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
    return sessions.map((session) => ({
      ...session,
      current: session.id === currentSessionId,
    }));
  }

  async revokeSession(userId: string, sessionId: string) {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.userSession.findFirst({
        where: { id: sessionId, userId, revokedAt: null },
        select: { id: true },
      });
      if (!session) return { revoked: false };
      const result = await tx.userSession.updateMany({
        where: { id: session.id, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (result.count !== 1) return { revoked: false };
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: "identity.session.revoked",
          entityType: "user_session",
          entityId: session.id,
        },
      });
      return { revoked: true };
    });
  }

  async changePassword(
    userId: string,
    currentSessionId: string,
    currentPassword: string,
    nextPassword: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true, status: true },
    });
    if (
      !user?.passwordHash ||
      user.status !== UserStatus.ACTIVE ||
      !(await this.passwords.verifyPassword(currentPassword, user.passwordHash))
    ) {
      throw new UnauthorizedException("Current password is incorrect");
    }
    const passwordHash = await this.passwords.hashPassword(nextPassword, 12);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await tx.userSession.updateMany({
        where: { userId, id: { not: currentSessionId }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: "identity.password.changed",
          entityType: "user",
          entityId: userId,
        },
      });
    });
    return { changed: true };
  }

  private issue(user: ActiveUser, sessionId: string) {
    return {
      accessToken: this.jwt.sign({ sub: user.id, sid: sessionId }),
      tokenType: "Bearer",
      expiresIn: 900,
      user,
    };
  }

  private async createSession(user: ActiveUser, client: SessionClient) {
    const refreshToken = this.newRefreshToken();
    const now = new Date();
    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.userSession.create({
        data: {
          userId: user.id,
          refreshTokenHash: this.hashSecret(refreshToken),
          expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
          ipAddressHash: client.ipAddress
            ? this.hashSecret(client.ipAddress)
            : null,
          userAgent: client.userAgent?.slice(0, 400) || null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "identity.session.created",
          entityType: "user_session",
          entityId: created.id,
        },
      });
      return created;
    });
    return { ...this.issue(user, session.id), refreshToken };
  }

  private async assertLoginAllowed(identifierHash: string) {
    const attempt = await this.prisma.loginAttempt.findUnique({
      where: { identifierHash },
      select: { blockedUntil: true },
    });
    if (attempt?.blockedUntil && attempt.blockedUntil.getTime() > Date.now())
      throw new HttpException(
        "Too many login attempts; try again later",
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  private async recordLoginFailures(
    attempts: Array<{ identifierHash: string; maxFailures: number }>,
  ) {
    const now = new Date();
    await this.prisma.$transaction(
      async (tx) => {
        for (const { identifierHash, maxFailures } of attempts) {
          const existing = await tx.loginAttempt.findUnique({
            where: { identifierHash },
          });
          const inWindow =
            existing &&
            now.getTime() - existing.windowStartedAt.getTime() <
              LOGIN_WINDOW_MS;
          const failureCount = inWindow ? existing.failureCount + 1 : 1;
          const windowStartedAt = inWindow ? existing.windowStartedAt : now;
          const blockedUntil =
            failureCount >= maxFailures
              ? new Date(now.getTime() + LOGIN_WINDOW_MS)
              : null;
          await tx.loginAttempt.upsert({
            where: { identifierHash },
            create: {
              identifierHash,
              windowStartedAt,
              failureCount,
              blockedUntil,
            },
            update: { windowStartedAt, failureCount, blockedUntil },
          });
        }
      },
      { isolationLevel: "Serializable" },
    );
  }

  private loginAttemptKeys(email: string, ipAddress?: string) {
    const attempts = [
      {
        identifierHash: this.loginAttemptKey(email, ipAddress),
        maxFailures: LOGIN_MAX_FAILURES,
      },
    ];
    const normalizedIp = ipAddress?.trim();
    if (normalizedIp)
      attempts.push({
        identifierHash: this.loginIpAttemptKey(normalizedIp),
        maxFailures: LOGIN_IP_MAX_FAILURES,
      });
    return attempts;
  }

  private loginAttemptKey(email: string, ipAddress?: string) {
    const secret =
      process.env.JWT_ACCESS_SECRET || "rdps-local-auth-rate-limit";
    const identifier = `login:${ipAddress?.trim() || "unknown"}:${email}`;
    return createHmac("sha256", secret).update(identifier).digest("hex");
  }

  private loginIpAttemptKey(ipAddress: string) {
    const secret =
      process.env.JWT_ACCESS_SECRET || "rdps-local-auth-rate-limit";
    return createHmac("sha256", secret)
      .update(`login-ip:${ipAddress}`)
      .digest("hex");
  }

  private newRefreshToken() {
    return randomBytes(32).toString("base64url");
  }

  private hashSecret(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
}

function isPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function oidcProviderSubject(issuer: string, subject: string) {
  return createHash("sha256")
    .update(issuer)
    .update("\0")
    .update(subject)
    .digest("hex");
}
