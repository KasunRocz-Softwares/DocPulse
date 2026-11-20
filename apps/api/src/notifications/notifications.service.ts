import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";

export const NOTIFICATION_QUEUE = "RDPS_NOTIFICATION_QUEUE";
export const NOTIFICATION_TOKEN_HASHER = "RDPS_NOTIFICATION_TOKEN_HASHER";
export interface NotificationQueue {
  add(
    name: string,
    data: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
}
type Actor = { id: string; isSystemAdmin: boolean };
type TokenHasher = { hashToken(token: string): string };
const defaultHasher: TokenHasher = {
  hashToken: (token) => createHash("sha256").update(token).digest("hex"),
};
const editableRoles = ["ADMIN", "RELEASE_MANAGER"];
const defaultPreferences = { newReleases: true, securityOnly: false };

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(NOTIFICATION_TOKEN_HASHER)
    private readonly tokenHasher: TokenHasher = defaultHasher,
    @Optional()
    @Inject(NOTIFICATION_QUEUE)
    private readonly queue?: NotificationQueue,
  ) {}

  async subscribe(
    projectSlug: string,
    input: { email: string; locale?: string; releaseId?: string },
  ) {
    const project = await this.prisma.project.findUnique({
      where: { slug: projectSlug },
      select: { id: true, slug: true, name: true },
    });
    if (!project) throw new NotFoundException("Project not found");
    if (input.releaseId) {
      const release = await this.prisma.release.findFirst({
        where: { id: input.releaseId, projectId: project.id },
        select: { id: true },
      });
      if (!release) throw new NotFoundException("Release not found");
    }
    const email = input.email.trim().toLowerCase();
    const verificationToken = randomBytes(32).toString("hex");
    const unsubscribeToken = randomBytes(32).toString("hex");
    const subscription = await this.upsertSubscription({
      id: randomUUID(),
      email,
      projectId: project.id,
      releaseId: input.releaseId ?? null,
      locale: input.locale ?? "en",
      verificationTokenHash: this.tokenHasher.hashToken(verificationToken),
      unsubscribeTokenHash: this.tokenHasher.hashToken(unsubscribeToken),
    });
    const delivery = await this.prisma.notificationDelivery.create({
      data: {
        projectId: project.id,
        subscriptionId: subscription.id,
        kind: "VERIFICATION",
        payload: {},
      },
      select: { id: true },
    });
    await this.prisma.auditLog.create({
      data: {
        projectId: project.id,
        action: "subscription.verification_requested",
        entityType: "Subscription",
        entityId: subscription.id,
        metadata: {
          emailDomain: email.split("@")[1] ?? "",
          releaseId: input.releaseId ?? null,
        },
      },
    });
    const verifyJobId = delivery.id;
    const publicBase = (
      process.env.PUBLIC_BASE_URL ?? "http://localhost:5174"
    ).replace(/\/$/, "");
    const verifyUrl = `${publicBase}/#/verify-subscription?project=${encodeURIComponent(project.slug)}&token=${verificationToken}`;
    const unsubscribeUrl = `${publicBase}/#/unsubscribe?project=${encodeURIComponent(project.slug)}&token=${unsubscribeToken}`;
    await this.queue?.add(
      "verify-subscription",
      {
        deliveryId: verifyJobId,
        kind: "VERIFICATION",
        message: {
          to: email,
          subject: `Confirm updates from ${project.name}`,
          html: `<h1>Confirm your subscription</h1><p>Confirm that you want release updates from ${escapeHtml(project.name)}${input.releaseId ? ` for one release` : ""}.</p><p><a href="${escapeHtml(verifyUrl)}">Confirm subscription</a></p><p><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a></p>`,
          text: `Confirm your subscription to ${project.name}: ${verifyUrl}\nUnsubscribe: ${unsubscribeUrl}`,
        },
      },
      jobOptions(verifyJobId),
    );
    return { accepted: true, subscriptionId: subscription.id };
  }

  async confirm(token: string) {
    const hash = this.tokenHasher.hashToken(token);
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        verificationTokenHash: hash,
        verifiedAt: null,
        unsubscribedAt: null,
      },
      select: { id: true },
    });
    if (!subscription) return { verified: false };
    const result = await this.prisma.subscription.updateMany({
      where: {
        id: subscription.id,
        verificationTokenHash: hash,
        verifiedAt: null,
        unsubscribedAt: null,
      },
      data: { verifiedAt: new Date(), verificationTokenHash: null },
    });
    return { verified: result.count === 1 };
  }

  async unsubscribe(projectSlug: string, token: string) {
    const project = await this.prisma.project.findUnique({
      where: { slug: projectSlug },
      select: { id: true },
    });
    if (!project) return { unsubscribed: false };
    const hash = this.tokenHasher.hashToken(token);
    let subscription = await this.prisma.subscription.findFirst({
      where: {
        projectId: project.id,
        unsubscribeTokenHash: hash,
        unsubscribedAt: null,
      },
      select: { id: true },
    });
    if (!subscription) {
      const delivery = await this.prisma.notificationDelivery.findFirst({
        where: {
          projectId: project.id,
          unsubscribeTokenHash: hash,
          subscription: { unsubscribedAt: null },
        },
        select: { subscriptionId: true },
      });
      if (delivery) subscription = { id: delivery.subscriptionId };
    }
    if (!subscription) return { unsubscribed: false };
    const result = await this.prisma.subscription.updateMany({
      where: { id: subscription.id, unsubscribedAt: null },
      data: { unsubscribedAt: new Date(), verificationTokenHash: null },
    });
    return { unsubscribed: result.count === 1 };
  }

  async listSubscriptions(actor: Actor, projectId: string, releaseId?: string) {
    await this.requireProjectRole(actor, projectId);
    if (releaseId) await this.requireRelease(projectId, releaseId);
    const scopeFilter = releaseId
      ? 'AND s."releaseId" = $2::uuid'
      : 'AND s."releaseId" IS NULL';
    const values = releaseId ? [projectId, releaseId] : [projectId];
    return this.prisma.$queryRawUnsafe(
      `SELECT s."id", s."email", s."releaseId", s."locale", s."preferences", s."verifiedAt", s."unsubscribedAt", s."createdAt", jsonb_build_object('deliveries', COUNT(d."id")::int) AS "_count" FROM "Subscription" s LEFT JOIN "NotificationDelivery" d ON d."subscriptionId" = s."id" WHERE s."projectId" = $1::uuid ${scopeFilter} GROUP BY s."id" ORDER BY s."createdAt" DESC`,
      ...values,
    );
  }

  async updatePreferences(
    actor: Actor,
    projectId: string,
    subscriptionId: string,
    preferences: { newReleases?: boolean; securityOnly?: boolean },
    releaseId?: string,
  ) {
    await this.requireProjectRole(actor, projectId);
    if (releaseId) await this.requireRelease(projectId, releaseId);
    const patch = JSON.stringify(preferences);
    const result = await this.prisma.$queryRawUnsafe(
      `UPDATE "Subscription" SET "preferences" = COALESCE("preferences", '{"newReleases":true,"securityOnly":false}'::jsonb) || $4::jsonb, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $1::uuid AND "projectId" = $2::uuid AND "releaseId" IS NOT DISTINCT FROM $3::uuid RETURNING "id", "email", "preferences"`,
      subscriptionId,
      projectId,
      releaseId ?? null,
      patch,
    );
    const subscription = Array.isArray(result) ? result[0] : undefined;
    if (!subscription) throw new NotFoundException("Subscription not found");
    return subscription;
  }

  async queuePublication(projectId: string, snapshotId: string) {
    const snapshot = await this.prisma.publicReleaseSnapshot.findUnique({
      where: { id: snapshotId },
      select: {
        id: true,
        projectSlug: true,
        projectName: true,
        version: true,
        title: true,
        summary: true,
        publishedAt: true,
        changes: {
          select: {
            title: true,
            category: true,
            description: true,
            sortOrder: true,
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    if (!snapshot) return;
    const publication = await this.prisma.$queryRawUnsafe(
      `SELECT r."id" AS "releaseId" FROM "PublicReleaseSnapshot" s JOIN "ReleasePublication" p ON p."id" = s."publicationId" JOIN "Release" r ON r."id" = p."releaseId" WHERE s."id" = $1::uuid AND r."projectId" = $2::uuid`,
      snapshotId,
      projectId,
    );
    const releaseId = Array.isArray(publication)
      ? (publication[0] as { releaseId?: string } | undefined)?.releaseId
      : undefined;
    if (!releaseId) return;
    const subscriptions = await this.prisma.$queryRawUnsafe(
      `SELECT "id", "email", "locale", "preferences" FROM "Subscription" WHERE "projectId" = $1::uuid AND ("releaseId" IS NULL OR "releaseId" = $2::uuid) AND "verifiedAt" IS NOT NULL AND "unsubscribedAt" IS NULL ORDER BY "createdAt" ASC`,
      projectId,
      releaseId,
    );
    const publicBase = (
      process.env.PUBLIC_BASE_URL ?? "http://localhost:5174"
    ).replace(/\/$/, "");
    for (const subscription of Array.isArray(subscriptions)
      ? subscriptions
      : []) {
      const preferences = (
        isRecord(subscription.preferences)
          ? subscription.preferences
          : defaultPreferences
      ) as Record<string, unknown>;
      if (preferences.newReleases === false) continue;
      const changes = snapshot.changes.filter(
        (change) => !preferences.securityOnly || change.category === "SECURITY",
      );
      if (preferences.securityOnly && changes.length === 0) continue;
      const unsubscribeToken = randomBytes(32).toString("hex");
      const delivery = await this.prisma.notificationDelivery.create({
        data: {
          projectId,
          subscriptionId: subscription.id,
          publicationId: snapshot.id,
          kind: "PUBLICATION",
          unsubscribeTokenHash: this.tokenHasher.hashToken(unsubscribeToken),
          payload: { snapshotId: snapshot.id },
        },
        select: { id: true },
      });
      const unsubscribeUrl = `${publicBase}/#/unsubscribe?project=${encodeURIComponent(snapshot.projectSlug)}&token=${unsubscribeToken}`;
      const publicUrl = `${publicBase}/projects/${encodeURIComponent(snapshot.projectSlug)}/releases/${encodeURIComponent(snapshot.version)}`;
      const content = `${snapshot.summary ? `<p>${escapeHtml(snapshot.summary)}</p>` : ""}<ul>${changes.map((change) => `<li><strong>${escapeHtml(change.title)}</strong><p>${escapeHtml(change.description)}</p></li>`).join("")}</ul>`;
      await this.queue?.add(
        "published-release",
        {
          deliveryId: delivery.id,
          kind: "PUBLICATION",
          message: {
            to: subscription.email,
            subject: `${snapshot.projectName} ${snapshot.version}: ${snapshot.title}`,
            html: `<h1>${escapeHtml(snapshot.title)}</h1><p>${escapeHtml(snapshot.projectName)} · ${escapeHtml(snapshot.version)}</p>${content}<p><a href="${escapeHtml(publicUrl)}">Read release notes</a></p><p><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a></p>`,
            text: `${snapshot.projectName} ${snapshot.version}: ${snapshot.title}\n${snapshot.summary ?? ""}\n${publicUrl}\nUnsubscribe: ${unsubscribeUrl}`,
          },
        },
        jobOptions(delivery.id),
      );
    }
  }

  async markDelivery(
    id: string,
    status: "SENT" | "FAILED" | "DEAD",
    errorCode?: string,
  ) {
    return this.prisma.notificationDelivery.updateMany({
      where: { id, status: { in: ["PENDING", "PROCESSING", "FAILED"] } },
      data: {
        status,
        attemptCount: { increment: 1 },
        ...(status === "SENT"
          ? { sentAt: new Date(), lastErrorCode: null }
          : { lastErrorCode: safeErrorCode(errorCode) }),
      },
    });
  }

  private async requireProjectRole(actor: Actor, projectId: string) {
    if (actor.isSystemAdmin) return;
    const membership = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: actor.id } },
      select: { role: true },
    });
    if (!membership || !editableRoles.includes(membership.role))
      throw new ForbiddenException(
        "Project subscription management requires an administrator or release manager",
      );
  }

  private async requireRelease(projectId: string, releaseId: string) {
    const release = await this.prisma.release.findFirst({
      where: { id: releaseId, projectId },
      select: { id: true },
    });
    if (!release) throw new NotFoundException("Release not found");
  }

  private async upsertSubscription(input: {
    id: string;
    email: string;
    projectId: string;
    releaseId: string | null;
    locale: string;
    verificationTokenHash: string;
    unsubscribeTokenHash: string;
  }): Promise<{ id: string; email: string }> {
    const conflictTarget = input.releaseId
      ? 'ON CONFLICT ("email", "projectId", "releaseId") DO UPDATE'
      : 'ON CONFLICT ("email", "projectId") WHERE "releaseId" IS NULL DO UPDATE';
    const rows = await this.prisma.$queryRawUnsafe(
      `INSERT INTO "Subscription" ("id", "email", "projectId", "releaseId", "locale", "preferences", "verificationTokenHash", "unsubscribeTokenHash", "verifiedAt", "unsubscribedAt", "createdAt", "updatedAt") VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, '{"newReleases":true,"securityOnly":false}'::jsonb, $6, $7, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ${conflictTarget} SET "locale" = EXCLUDED."locale", "verificationTokenHash" = EXCLUDED."verificationTokenHash", "unsubscribeTokenHash" = EXCLUDED."unsubscribeTokenHash", "verifiedAt" = NULL, "unsubscribedAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP RETURNING "id", "email"`,
      input.id,
      input.email,
      input.projectId,
      input.releaseId,
      input.locale,
      input.verificationTokenHash,
      input.unsubscribeTokenHash,
    );
    const subscription = Array.isArray(rows) ? rows[0] : undefined;
    if (!subscription) throw new Error("Subscription could not be created");
    return subscription as { id: string; email: string };
  }
}

function jobOptions(jobId: string) {
  return {
    jobId,
    attempts: 8,
    backoff: { type: "exponential", delay: 1_000 },
    removeOnComplete: 1_000,
    removeOnFail: false,
  };
}
function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function safeErrorCode(value?: string) {
  return value && /^[A-Z0-9_-]{1,80}$/.test(value) ? value : "DELIVERY_FAILED";
}
function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}
