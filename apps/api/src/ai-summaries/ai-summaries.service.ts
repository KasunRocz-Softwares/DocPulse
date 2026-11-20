import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ChangeVisibility, ProjectRole } from "../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";
import {
  AI_SUMMARY_PROVIDER,
  AiSummaryProvider,
  AiSummarySourceChange,
} from "./ai-summary-provider";

export type AiSummaryActor = { id: string; isSystemAdmin: boolean };

const MAX_SOURCE_CHANGES = 100;
const MAX_SOURCE_CHARACTERS = 40_000;

@Injectable()
export class AiSummariesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_SUMMARY_PROVIDER)
    private readonly provider: AiSummaryProvider,
  ) {}

  async suggest(actor: AiSummaryActor, releaseId: string) {
    const release = await this.prisma.release.findUnique({
      where: { id: releaseId },
      select: { id: true, projectId: true },
    });
    if (!release) throw new NotFoundException("Release not found");

    if (!actor.isSystemAdmin) {
      const membership = await this.prisma.projectMember.findUnique({
        where: {
          projectId_userId: { projectId: release.projectId, userId: actor.id },
        },
        select: { role: true },
      });
      const allowedRoles: ProjectRole[] = [
        ProjectRole.ADMIN,
        ProjectRole.RELEASE_MANAGER,
        ProjectRole.DEVELOPER,
      ];
      if (!membership || !allowedRoles.includes(membership.role)) {
        throw new ForbiddenException(
          "You cannot generate a summary for this project",
        );
      }
    }

    const rows = await this.prisma.releaseChange.findMany({
      where: {
        releaseId,
        visibility: ChangeVisibility.PUBLIC_CANDIDATE,
        publicDescription: { not: null },
      },
      orderBy: { sortOrder: "asc" },
      take: MAX_SOURCE_CHANGES + 1,
      select: {
        id: true,
        title: true,
        category: true,
        publicDescription: true,
      },
    });
    const sourceChanges: AiSummarySourceChange[] = rows.flatMap((change) => {
      const publicDescription = change.publicDescription?.trim();
      if (!publicDescription) return [];
      return [
        {
          id: change.id,
          title: change.title,
          category: change.category,
          publicDescription,
        },
      ];
    });
    if (sourceChanges.length === 0) {
      throw new UnprocessableEntityException(
        "Release has no public candidate changes with descriptions",
      );
    }
    if (sourceChanges.length > MAX_SOURCE_CHANGES) {
      throw new UnprocessableEntityException(
        `AI summaries support at most ${MAX_SOURCE_CHANGES} public changes per release`,
      );
    }
    const sourceCharacterCount = sourceChanges.reduce(
      (total, change) =>
        total +
        change.id.length +
        change.title.length +
        change.category.length +
        change.publicDescription.length,
      0,
    );
    if (sourceCharacterCount > MAX_SOURCE_CHARACTERS) {
      throw new UnprocessableEntityException(
        "Public change descriptions exceed the AI summary input limit",
      );
    }

    const generated = await this.provider.generate({ changes: sourceChanges });
    const summary = generated.summary.trim();
    if (!summary || summary.length > 5_000) {
      throw new UnprocessableEntityException(
        "AI summary provider returned an invalid suggestion",
      );
    }
    const generatedAt = new Date().toISOString();
    const sourceChangeIds = sourceChanges.map((change) => change.id);

    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        projectId: release.projectId,
        action: "release.ai_summary_suggested",
        entityType: "release",
        entityId: release.id,
        metadata: {
          provider: this.provider.providerName,
          model: generated.model.slice(0, 120),
          sourceChangeIds,
          sourceCount: sourceChangeIds.length,
          generatedAt,
        },
      },
    });

    return {
      summary,
      sourceChangeIds,
      generation: {
        provider: this.provider.providerName,
        model: generated.model.slice(0, 120),
        generatedAt,
      },
    };
  }
}
