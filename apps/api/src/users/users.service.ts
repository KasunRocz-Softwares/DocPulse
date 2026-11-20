import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { UserStatus } from "../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";

type Actor = { id: string; isSystemAdmin: boolean };

/** One-time password links stay valid for 24 hours. */
export const PASSWORD_LINK_TTL_MS = 24 * 60 * 60 * 1000;

const listedStatuses = new Set<string>(Object.values(UserStatus));

export type UserUpdate = {
  displayName?: string;
  status?: "ACTIVE" | "SUSPENDED";
  isSystemAdmin?: boolean;
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Workspace-wide user directory with project roles. System admins only. */
  async list(actor: Actor, filters: { q?: string; status?: string } = {}) {
    this.requireSystemAdmin(actor);
    const term = filters.q?.trim().slice(0, 120);
    const status =
      filters.status && listedStatuses.has(filters.status)
        ? (filters.status as UserStatus)
        : undefined;
    const now = new Date();
    const users = await this.prisma.user.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(term
          ? {
              OR: [
                { email: { contains: term, mode: "insensitive" as const } },
                {
                  displayName: { contains: term, mode: "insensitive" as const },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ isSystemAdmin: "desc" }, { createdAt: "asc" }],
      take: 500,
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        isSystemAdmin: true,
        createdAt: true,
        passwordHash: true,
        identities: { select: { provider: true } },
        memberships: {
          select: {
            id: true,
            role: true,
            project: { select: { id: true, name: true, slug: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        sessions: {
          where: { revokedAt: null, expiresAt: { gt: now } },
          select: { lastUsedAt: true, createdAt: true },
        },
        passwordResets: {
          where: { usedAt: null, revokedAt: null, expiresAt: { gt: now } },
          select: { expiresAt: true },
          take: 1,
        },
      },
    });
    return users.map(
      ({ passwordHash, sessions, passwordResets, identities, ...user }) => {
        const lastActive = sessions
          .map((session) => session.lastUsedAt ?? session.createdAt)
          .sort((a, b) => b.getTime() - a.getTime())[0];
        return {
          ...user,
          hasPassword: Boolean(passwordHash),
          signInMethods: [
            ...(passwordHash ? ["password"] : []),
            ...identities.map(({ provider }) => provider),
          ],
          activeSessions: sessions.length,
          lastActiveAt: lastActive ?? null,
          pendingPasswordLinkExpiresAt: passwordResets[0]?.expiresAt ?? null,
        };
      },
    );
  }

  async update(actor: Actor, userId: string, input: UserUpdate) {
    this.requireSystemAdmin(actor);
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        status: true,
        isSystemAdmin: true,
        passwordHash: true,
        identities: { select: { id: true } },
      },
    });
    if (!target) throw new NotFoundException("User not found");

    const data: {
      displayName?: string;
      status?: UserStatus;
      isSystemAdmin?: boolean;
    } = {};
    if (input.displayName !== undefined) {
      const displayName = input.displayName.trim();
      if (displayName.length < 2 || displayName.length > 160)
        throw new UnprocessableEntityException(
          "Display name must be 2–160 characters",
        );
      if (displayName !== target.displayName) data.displayName = displayName;
    }
    if (input.status !== undefined && input.status !== target.status) {
      if (target.id === actor.id)
        throw new ForbiddenException("You cannot change your own status");
      if (
        input.status === UserStatus.ACTIVE &&
        !target.passwordHash &&
        target.identities.length === 0
      )
        throw new UnprocessableEntityException(
          "This user has no way to sign in yet. Issue a password link instead.",
        );
      data.status = input.status;
    }
    if (
      input.isSystemAdmin !== undefined &&
      input.isSystemAdmin !== target.isSystemAdmin
    ) {
      if (target.id === actor.id)
        throw new ForbiddenException(
          "You cannot change your own system administrator access",
        );
      data.isSystemAdmin = input.isSystemAdmin;
    }
    if (Object.keys(data).length === 0) return this.summary(userId);

    const losesAdmin =
      target.isSystemAdmin &&
      (data.isSystemAdmin === false || data.status === UserStatus.SUSPENDED);

    await this.prisma.$transaction(async (tx) => {
      if (losesAdmin) {
        const remaining = await tx.user.count({
          where: {
            isSystemAdmin: true,
            status: UserStatus.ACTIVE,
            id: { not: target.id },
          },
        });
        if (remaining === 0)
          throw new ConflictException(
            "At least one active system administrator is required",
          );
      }
      await tx.user.update({ where: { id: target.id }, data });
      if (data.status === UserStatus.SUSPENDED) {
        await tx.userSession.updateMany({
          where: { userId: target.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.passwordResetToken.updateMany({
          where: { userId: target.id, usedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "user.updated",
          entityType: "user",
          entityId: target.id,
          metadata: {
            fields: Object.keys(data),
            ...(data.status
              ? { status: { from: target.status, to: data.status } }
              : {}),
            ...(data.isSystemAdmin !== undefined
              ? { isSystemAdmin: data.isSystemAdmin }
              : {}),
          },
        },
      });
    });
    return this.summary(userId);
  }

  /**
   * Create a one-time link that lets the user set a new password (or a first
   * password for an invited account). Earlier unused links stop working.
   */
  async issuePasswordLink(actor: Actor, userId: string) {
    this.requireSystemAdmin(actor);
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    });
    if (!target) throw new NotFoundException("User not found");
    if (target.status === UserStatus.SUSPENDED)
      throw new UnprocessableEntityException(
        "Reactivate this user before issuing a password link",
      );
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PASSWORD_LINK_TTL_MS);
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: target.id, usedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });
      const created = await tx.passwordResetToken.create({
        data: {
          userId: target.id,
          tokenHash: createHash("sha256").update(token).digest("hex"),
          expiresAt,
          createdById: actor.id,
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "user.password_link_issued",
          entityType: "password_reset_token",
          entityId: created.id,
          metadata: { userId: target.id },
        },
      });
    });
    return { token, expiresAt };
  }

  private async summary(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        isSystemAdmin: true,
      },
    });
  }

  private requireSystemAdmin(actor: Actor) {
    if (!actor.isSystemAdmin)
      throw new ForbiddenException("System administrator access is required");
  }
}
