import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import {
  AnalyticsEventKind,
  AnalyticsExportKind,
  AnalyticsExportStatus,
  ProjectRole,
} from "../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";
import { ANALYTICS_EXPORT_QUEUE } from "./analytics.tokens";
import { Inject } from "@nestjs/common";
import type { Queue } from "bullmq";

export type AnalyticsActor = { id: string; isSystemAdmin: boolean };
const dashboardRoles = [
  ProjectRole.ADMIN,
  ProjectRole.RELEASE_MANAGER,
  ProjectRole.DEVELOPER,
  ProjectRole.REVIEWER,
];
const exportRoles = [ProjectRole.ADMIN, ProjectRole.RELEASE_MANAGER];

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ANALYTICS_EXPORT_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleDestroy() {
    await this.queue.close();
  }

  async recordPublicEvent(input: {
    projectSlug: string;
    kind: string;
    version?: string;
    [key: string]: unknown;
  }) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.projectSlug))
      throw new BadRequestException("Invalid project slug");
    if (
      input.kind !== AnalyticsEventKind.PROJECT_VIEW &&
      input.kind !== AnalyticsEventKind.RELEASE_VIEW
    )
      throw new BadRequestException("Unsupported analytics event");
    const project = await this.prisma.project.findUnique({
      where: { slug: input.projectSlug },
      select: { id: true },
    });
    if (!project) throw new NotFoundException("Project not found");
    let snapshotId: string | null = null;
    if (input.kind === AnalyticsEventKind.RELEASE_VIEW) {
      if (!input.version || input.version.length > 64)
        throw new BadRequestException("A valid release version is required");
      const snapshot = await this.prisma.publicReleaseSnapshot.findFirst({
        where: {
          projectSlug: input.projectSlug,
          version: input.version,
          audienceMode: "PUBLIC",
          publication: { is: { revokedAt: null } },
        },
        select: { id: true },
      });
      if (!snapshot) throw new NotFoundException("Published release not found");
      snapshotId = snapshot.id;
    }
    const now = new Date();
    const occurredOn = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    await this.prisma.analyticsEvent.create({
      data: { projectId: project.id, snapshotId, kind: input.kind, occurredOn },
    });
    return { accepted: true };
  }

  async dashboard(actor: AnalyticsActor, projectId: string, days = 30) {
    if (!Number.isInteger(days) || days < 1 || days > 90)
      throw new BadRequestException(
        "Analytics range must be between 1 and 90 days",
      );
    await this.requireRole(actor, projectId, dashboardRoles);
    const from = new Date();
    from.setUTCHours(0, 0, 0, 0);
    from.setUTCDate(from.getUTCDate() - (days - 1));
    const where = { projectId, occurredOn: { gte: from } };
    const [daily, byRelease] = await Promise.all([
      this.prisma.analyticsEvent.groupBy({
        by: ["occurredOn", "kind"],
        where,
        _count: { _all: true },
        orderBy: { occurredOn: "asc" },
      }),
      this.prisma.analyticsEvent.groupBy({
        by: ["snapshotId", "kind"],
        where: { ...where, snapshotId: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const snapshots = await this.prisma.publicReleaseSnapshot.findMany({
      where: {
        id: { in: byRelease.map((row: any) => row.snapshotId).filter(Boolean) },
        publication: { is: { revokedAt: null } },
      },
      select: { id: true, version: true, title: true, publishedAt: true },
    });
    const countsByDay = new Map<
      string,
      { day: string; projectViews: number; releaseViews: number }
    >();
    for (const row of daily) {
      const day = new Date(row.occurredOn).toISOString().slice(0, 10);
      const value = countsByDay.get(day) ?? {
        day,
        projectViews: 0,
        releaseViews: 0,
      };
      if (row.kind === AnalyticsEventKind.PROJECT_VIEW)
        value.projectViews = row._count._all;
      else value.releaseViews = row._count._all;
      countsByDay.set(day, value);
    }
    const releaseCounts = new Map<string, number>();
    for (const row of byRelease)
      if (row.snapshotId && row.kind === AnalyticsEventKind.RELEASE_VIEW)
        releaseCounts.set(row.snapshotId, row._count._all);
    const topReleases = snapshots
      .map((snapshot: any) => ({
        id: snapshot.id,
        version: snapshot.version,
        title: snapshot.title,
        views: releaseCounts.get(snapshot.id) ?? 0,
      }))
      .sort((a: any, b: any) => b.views - a.views)
      .slice(0, 10);
    const series = [...countsByDay.values()];
    return {
      projectId,
      rangeDays: days,
      totals: {
        projectViews: series.reduce((n, row) => n + row.projectViews, 0),
        releaseViews: series.reduce((n, row) => n + row.releaseViews, 0),
      },
      daily: series,
      topReleases,
    };
  }

  async requestExport(
    actor: AnalyticsActor,
    projectId: string,
    request: { kind: string; days?: number; releaseId?: string },
  ) {
    await this.requireRole(actor, projectId, exportRoles);
    let kind: AnalyticsExportKind;
    let filename: string;
    let requestData: Record<string, unknown>;
    if (request.kind === AnalyticsExportKind.ANALYTICS_CSV) {
      const days = request.days ?? 30;
      if (!Number.isInteger(days) || days < 1 || days > 90)
        throw new BadRequestException(
          "Export range must be between 1 and 90 days",
        );
      const report = await this.dashboard(actor, projectId, days);
      kind = AnalyticsExportKind.ANALYTICS_CSV;
      filename = `analytics-${projectId}-${new Date().toISOString().slice(0, 10)}.csv`;
      requestData = { rows: report.daily };
    } else if (request.kind === AnalyticsExportKind.RELEASE_PDF) {
      if (!request.releaseId)
        throw new BadRequestException("A release is required for PDF export");
      const snapshot = await this.prisma.publicReleaseSnapshot.findFirst({
        where: {
          publication: {
            is: {
              revokedAt: null,
              release: { is: { id: request.releaseId, projectId } },
            },
          },
        },
        select: {
          projectName: true,
          version: true,
          title: true,
          summary: true,
          publishedAt: true,
          changes: {
            orderBy: { sortOrder: "asc" },
            select: { title: true, category: true, description: true },
          },
        },
      });
      if (!snapshot) throw new NotFoundException("Published release not found");
      kind = AnalyticsExportKind.RELEASE_PDF;
      filename = `${safeFilePart(snapshot.version)}-release-notes.pdf`;
      requestData = { snapshot };
    } else {
      throw new BadRequestException("Unsupported export type");
    }
    let job: any;
    await this.prisma.$transaction(async (tx: any) => {
      job = await tx.analyticsExportJob.create({
        data: {
          projectId,
          requestedById: actor.id,
          kind,
          filename,
          requestData,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId,
          action: "analytics.export_requested",
          entityType: "analytics_export",
          entityId: job.id,
          metadata: { kind },
        },
      });
    });
    try {
      await this.queue.add(
        "generate-export",
        { exportId: job.id, kind, filename, ...requestData },
        {
          jobId: `analytics-${job.id}`,
          attempts: 5,
          backoff: { type: "exponential", delay: 1000 },
          removeOnComplete: 100,
          removeOnFail: false,
        },
      );
    } catch {
      await this.failExport(job.id, "EXPORT_ENQUEUE_FAILED");
      throw new InternalServerErrorException("Export could not be queued");
    }
    return {
      id: job.id,
      kind,
      status: "PENDING",
      filename,
      createdAt: job.createdAt,
    };
  }

  async listExports(actor: AnalyticsActor, projectId: string) {
    await this.requireRole(actor, projectId, exportRoles);
    return this.prisma.analyticsExportJob.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        kind: true,
        status: true,
        filename: true,
        errorCode: true,
        completedAt: true,
        createdAt: true,
      },
    });
  }

  async getExport(actor: AnalyticsActor, projectId: string, exportId: string) {
    await this.requireRole(actor, projectId, exportRoles);
    const job = await this.prisma.analyticsExportJob.findFirst({
      where: { id: exportId, projectId },
    });
    if (!job) throw new NotFoundException("Export not found");
    if (job.status !== AnalyticsExportStatus.COMPLETED || !job.artifact)
      throw new BadRequestException("Export is not ready for download");
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        projectId,
        action: "analytics.export_downloaded",
        entityType: "analytics_export",
        entityId: exportId,
      },
    });
    return {
      filename: job.filename,
      contentType: job.contentType ?? "application/octet-stream",
      artifact: Buffer.from(job.artifact),
    };
  }

  async markProcessing(exportId: string) {
    await this.prisma.analyticsExportJob.updateMany({
      where: {
        id: exportId,
        status: {
          in: [AnalyticsExportStatus.PENDING, AnalyticsExportStatus.PROCESSING],
        },
      },
      data: { status: AnalyticsExportStatus.PROCESSING, errorCode: null },
    });
    return { accepted: true };
  }

  async completeExport(
    exportId: string,
    artifact: Buffer,
    contentType: string,
  ) {
    if (
      !Buffer.isBuffer(artifact) ||
      !artifact.length ||
      artifact.length > 8_000_000
    )
      throw new BadRequestException("Export artifact is invalid or too large");
    if (
      contentType !== "application/pdf" &&
      contentType !== "text/csv; charset=utf-8"
    )
      throw new BadRequestException("Unsupported export content type");
    const job = await this.prisma.analyticsExportJob.findUnique({
      where: { id: exportId },
      select: { projectId: true, status: true },
    });
    if (!job) throw new NotFoundException("Export not found");
    if (job.status === AnalyticsExportStatus.COMPLETED)
      return { accepted: true };
    await this.prisma.$transaction(async (tx: any) => {
      await tx.analyticsExportJob.update({
        where: { id: exportId },
        data: {
          status: AnalyticsExportStatus.COMPLETED,
          contentType,
          artifact,
          errorCode: null,
          completedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          projectId: job.projectId,
          action: "analytics.export_completed",
          entityType: "analytics_export",
          entityId: exportId,
        },
      });
    });
    return { accepted: true };
  }

  async failExport(exportId: string, errorCode: string) {
    const job = await this.prisma.analyticsExportJob.findUnique({
      where: { id: exportId },
      select: { projectId: true },
    });
    if (!job) return { accepted: false };
    await this.prisma.$transaction(async (tx: any) => {
      await tx.analyticsExportJob.updateMany({
        where: {
          id: exportId,
          status: { not: AnalyticsExportStatus.COMPLETED },
        },
        data: {
          status: AnalyticsExportStatus.FAILED,
          errorCode: /^[A-Z0-9_-]{1,80}$/.test(errorCode)
            ? errorCode
            : "EXPORT_PROCESSING_FAILED",
          completedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          projectId: job.projectId,
          action: "analytics.export_failed",
          entityType: "analytics_export",
          entityId: exportId,
        },
      });
    });
    return { accepted: true };
  }

  private async requireRole(
    actor: AnalyticsActor,
    projectId: string,
    allowed: ProjectRole[],
  ) {
    if (actor.isSystemAdmin) return;
    const membership = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: actor.id } },
      select: { role: true },
    });
    if (!membership) throw new ForbiddenException("Project access is required");
    if (!allowed.includes(membership.role))
      throw new ForbiddenException(
        "This project role cannot access analytics or exports",
      );
  }
}

function safeFilePart(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "release";
}
