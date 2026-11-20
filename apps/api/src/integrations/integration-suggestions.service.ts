import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ProjectRole } from "../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";

type Actor = { id: string; isSystemAdmin: boolean };
type SuggestionAction = "accept" | "dismiss";

const LIST_ROLES = [
  ProjectRole.ADMIN,
  ProjectRole.RELEASE_MANAGER,
  ProjectRole.DEVELOPER,
  ProjectRole.REVIEWER,
  ProjectRole.CLIENT,
];
const ACCEPT_ROLES = [
  ProjectRole.ADMIN,
  ProjectRole.RELEASE_MANAGER,
  ProjectRole.DEVELOPER,
];
const DISMISS_ROLES = [ProjectRole.ADMIN, ProjectRole.RELEASE_MANAGER];
const MAX_PAGE_SIZE = 250;

@Injectable()
export class IntegrationSuggestionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: Actor, projectId: string, limit = 100) {
    await this.requireProjectRole(actor, projectId, LIST_ROLES);
    const take = Number.isSafeInteger(limit)
      ? Math.min(Math.max(limit, 1), MAX_PAGE_SIZE)
      : 100;
    return this.prisma.integrationSuggestion.findMany({
      where: { projectId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take,
    });
  }

  accept(
    actor: Actor,
    projectId: string,
    suggestionId: string,
    releaseId: string,
  ) {
    return this.review(actor, projectId, suggestionId, "accept", releaseId);
  }

  dismiss(actor: Actor, projectId: string, suggestionId: string) {
    return this.review(actor, projectId, suggestionId, "dismiss");
  }

  private async review(
    actor: Actor,
    projectId: string,
    suggestionId: string,
    action: SuggestionAction,
    releaseId?: string,
  ) {
    const allowed = action === "accept" ? ACCEPT_ROLES : DISMISS_ROLES;
    return this.prisma.$transaction(async (tx) => {
      await this.requireProjectRole(actor, projectId, allowed, tx);
      const suggestion = await tx.integrationSuggestion.findFirst({
        where: { id: suggestionId, projectId },
        select: {
          id: true,
          projectId: true,
          repository: true,
          referenceKind: true,
          externalId: true,
          revision: true,
          status: true,
        },
      });
      if (!suggestion)
        throw new NotFoundException("Integration suggestion not found");
      if (suggestion.status !== "PENDING")
        throw new ConflictException(
          "Integration suggestion is no longer pending",
        );

      let reference: ReturnType<typeof validateReference> | undefined;
      if (action === "accept") {
        if (!releaseId)
          throw new BadRequestException(
            "A release ID is required to accept a suggestion",
          );
        const release = await tx.release.findFirst({
          where: { id: releaseId, projectId },
          select: { id: true },
        });
        if (!release)
          throw new NotFoundException("Release not found in this project");
        reference = validateReference(suggestion);
      }

      const status = action === "accept" ? "ACCEPTED" : "DISMISSED";
      const changed = await tx.integrationSuggestion.updateMany({
        where: { id: suggestionId, projectId, status: "PENDING" },
        data: { status, reviewedAt: new Date() },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          "Integration suggestion is no longer pending",
        );

      if (action === "accept" && reference && releaseId) {
        await tx.gitReference.create({ data: { ...reference, releaseId } });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId,
          action: `integration.suggestion.${action === "accept" ? "accepted" : "dismissed"}`,
          entityType: "IntegrationSuggestion",
          entityId: suggestionId,
          metadata: {
            ...(releaseId ? { releaseId } : {}),
            referenceKind: suggestion.referenceKind,
            externalId: suggestion.externalId,
          },
        },
      });
      return action === "accept" ? { accepted: true } : { dismissed: true };
    });
  }

  private async requireProjectRole(
    actor: Actor,
    projectId: string,
    allowed: ProjectRole[],
    client: Pick<PrismaService, "projectMember"> = this.prisma,
  ) {
    if (actor.isSystemAdmin) return;
    const membership = await client.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: actor.id } },
      select: { role: true },
    });
    if (!membership) throw new NotFoundException("Project not found");
    if (!allowed.includes(membership.role))
      throw new ForbiddenException(
        "Your project role does not allow this action",
      );
  }
}

function validateReference(suggestion: {
  repository: string;
  referenceKind: string;
  externalId: string;
  revision: string | null;
}) {
  const repository = suggestion.repository.trim();
  const match = /^([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})$/.exec(
    repository,
  );
  if (
    !match ||
    match[1] === "." ||
    match[1] === ".." ||
    match[2] === "." ||
    match[2] === ".."
  )
    throw new BadRequestException("Suggestion repository is invalid");

  const id = suggestion.externalId.trim();
  let path: string;
  switch (suggestion.referenceKind) {
    case "pull_request":
    case "issue":
      if (!/^[1-9]\d{0,9}$/.test(id))
        throw new BadRequestException(
          "Suggestion issue or pull request number is invalid",
        );
      path = `${suggestion.referenceKind === "pull_request" ? "pull" : "issues"}/${id}`;
      break;
    case "commit": {
      const revision = suggestion.revision?.trim() || id;
      if (!/^[a-f0-9]{7,40}$/i.test(revision))
        throw new BadRequestException("Suggestion commit revision is invalid");
      path = `commit/${revision}`;
      break;
    }
    case "tag":
      if (!id || id.length > 160 || /[\u0000-\u001f\u007f]/.test(id))
        throw new BadRequestException("Suggestion tag is invalid");
      path = `tree/${encodeURIComponent(id)}`;
      break;
    default:
      throw new BadRequestException(
        "Suggestion reference kind cannot be accepted",
      );
  }

  return {
    repository,
    kind: suggestion.referenceKind,
    externalId: id,
    url: `https://github.com/${repository}/${path}`,
    title: null,
  };
}
