import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  GitHubAppConnectionStatus,
  ProjectRole,
} from "../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";
import {
  GITHUB_APP_PROVIDER,
  type GitHubAppProvider,
  type GitHubRepository,
} from "./github-app.provider";

type Actor = { id: string; isSystemAdmin: boolean };
const INSTALL_STATE_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class GitHubAppService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(GITHUB_APP_PROVIDER) private readonly github: GitHubAppProvider,
  ) {}

  async getStatus(actor: Actor, projectId: string) {
    await this.requireProjectAdmin(actor, projectId);
    const connections = await this.prisma.gitHubAppProjectConnection.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
      include: {
        project: {
          select: { repositories: { where: { provider: "github" } } },
        },
      },
    });
    return {
      configured: this.github.isConfigured(),
      installUrlAvailable: this.github.isConfigured(),
      webhookPath: "/api/v1/integrations/github-app/webhook",
      connections: connections.map(({ project, ...connection }) => ({
        ...connection,
        repositories: project.repositories.filter(
          (repository) => repository.externalId !== null,
        ),
      })),
    };
  }

  async beginInstallation(actor: Actor, projectId: string) {
    await this.requireProjectAdmin(actor, projectId);
    if (!this.github.isConfigured())
      throw new ServiceUnavailableException(
        "GitHub App is not configured for this environment",
      );
    const state = randomBytes(32).toString("base64url");
    const stateHash = hashState(state);
    const expiresAt = new Date(Date.now() + INSTALL_STATE_TTL_MS);
    const installUrl = this.github.getInstallUrl(state);
    await this.prisma.$transaction(async (tx) => {
      await tx.gitHubAppInstallState.deleteMany({
        where: { expiresAt: { lte: new Date() } },
      });
      await tx.gitHubAppInstallState.create({
        data: { stateHash, projectId, userId: actor.id, expiresAt },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId,
          action: "github_app.installation_started",
          entityType: "github_app_installation",
          metadata: { expiresAt: expiresAt.toISOString() },
        },
      });
    });
    return { installUrl, expiresAt };
  }

  async completeInstallation(input: {
    state: string;
    installationId: string;
    setupAction?: string;
  }) {
    if (input.setupAction && input.setupAction !== "install")
      throw new BadRequestException("GitHub installation was not completed");
    if (!/^\d{1,40}$/.test(input.installationId))
      throw new BadRequestException("Invalid GitHub installation ID");
    const stateHash = hashState(input.state);
    const now = new Date();
    const pending = await this.prisma.gitHubAppInstallState.findUnique({
      where: { stateHash },
    });
    if (
      !pending ||
      pending.consumedAt ||
      pending.expiresAt <= now ||
      !safeHashEqual(stateHash, pending.stateHash)
    )
      throw new UnauthorizedException(
        "GitHub installation state is invalid or expired",
      );
    const consumed = await this.prisma.gitHubAppInstallState.updateMany({
      where: {
        stateHash,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1)
      throw new UnauthorizedException(
        "GitHub installation state was already used",
      );

    const [user, membership] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: pending.userId },
        select: { isSystemAdmin: true, status: true },
      }),
      this.prisma.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId: pending.projectId,
            userId: pending.userId,
          },
        },
        select: { role: true },
      }),
    ]);
    if (
      user?.status !== "ACTIVE" ||
      (!user.isSystemAdmin && membership?.role !== ProjectRole.ADMIN)
    )
      throw new ForbiddenException(
        "Project admin role is required to complete installation",
      );

    const installation = await this.github.getInstallation(
      input.installationId,
    );
    return this.prisma.$transaction(async (tx) => {
      const connection = await tx.gitHubAppProjectConnection.upsert({
        where: {
          projectId_installationId: {
            projectId: pending.projectId,
            installationId: installation.id,
          },
        },
        create: {
          projectId: pending.projectId,
          installationId: installation.id,
          accountLogin: installation.accountLogin,
          accountType: installation.accountType,
          status: GitHubAppConnectionStatus.ACTIVE,
          disconnectedAt: null,
        },
        update: {
          accountLogin: installation.accountLogin,
          accountType: installation.accountType,
          status: GitHubAppConnectionStatus.ACTIVE,
          disconnectedAt: null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: pending.userId,
          projectId: pending.projectId,
          action: "github_app.installation_connected",
          entityType: "github_app_installation",
          entityId: connection.id,
          metadata: {
            installationId: installation.id,
            accountLogin: installation.accountLogin,
            accountType: installation.accountType,
          },
        },
      });
      return {
        connected: true,
        projectId: pending.projectId,
        installationId: connection.installationId,
      };
    });
  }

  async discoverRepositories(
    actor: Actor,
    projectId: string,
    installationId: string,
  ): Promise<GitHubRepository[]> {
    await this.requireProjectAdmin(actor, projectId);
    const connection = await this.findActiveConnection(
      projectId,
      installationId,
    );
    return this.github.listRepositories(connection.installationId);
  }

  async isRepositoryLinked(
    installationId: string,
    fullName: string,
  ): Promise<boolean> {
    const [owner, name] = fullName.split("/");
    if (!owner || !name || !/^\d{1,40}$/.test(installationId)) return false;
    const repository = await this.prisma.projectRepository.findFirst({
      where: {
        provider: "github",
        owner: { equals: owner, mode: "insensitive" },
        name: { equals: name, mode: "insensitive" },
        githubInstallationId: installationId,
      },
      select: { id: true },
    });
    return repository !== null;
  }

  async linkRepository(
    actor: Actor,
    projectId: string,
    installationId: string,
    repositoryId: string,
  ) {
    await this.requireProjectAdmin(actor, projectId);
    if (!/^\d{1,40}$/.test(repositoryId))
      throw new BadRequestException("Invalid GitHub repository ID");
    const connection = await this.findActiveConnection(
      projectId,
      installationId,
    );
    const repos = await this.github.listRepositories(connection.installationId);
    const remote = repos.find((repository) => repository.id === repositoryId);
    if (!remote)
      throw new NotFoundException(
        "Repository is not available to this installation",
      );

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.projectRepository.findFirst({
        where: { projectId, provider: "github", externalId: remote.id },
      });
      if (existing)
        throw new ConflictException("GitHub repository is already linked");
      const repository = await tx.projectRepository.create({
        data: {
          projectId,
          provider: "github",
          owner: remote.owner,
          name: remote.name,
          externalId: remote.id,
          githubInstallationId: connection.installationId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId,
          action: "github_app.repository_linked",
          entityType: "project_repository",
          entityId: repository.id,
          metadata: {
            installationId: connection.installationId,
            repositoryId: remote.id,
            fullName: remote.fullName,
          },
        },
      });
      return repository;
    });
  }

  async disconnectRepository(
    actor: Actor,
    projectId: string,
    repositoryId: string,
  ) {
    await this.requireProjectAdmin(actor, projectId);
    const repository = await this.prisma.projectRepository.findFirst({
      where: { id: repositoryId, projectId, provider: "github" },
    });
    if (!repository) throw new NotFoundException("GitHub repository not found");
    await this.prisma.$transaction(async (tx) => {
      await tx.projectRepository.delete({ where: { id: repository.id } });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId,
          action: "github_app.repository_disconnected",
          entityType: "project_repository",
          entityId: repository.id,
          metadata: {
            repositoryId: repository.externalId,
            fullName: `${repository.owner}/${repository.name}`,
          },
        },
      });
    });
    return { disconnected: true };
  }

  async disconnectInstallation(
    actor: Actor,
    projectId: string,
    installationId: string,
  ) {
    await this.requireProjectAdmin(actor, projectId);
    const connection = await this.findConnection(projectId, installationId);
    await this.prisma.$transaction(async (tx) => {
      await tx.gitHubAppProjectConnection.update({
        where: { id: connection.id },
        data: {
          status: GitHubAppConnectionStatus.REMOVED,
          disconnectedAt: new Date(),
        },
      });
      const linked = await tx.projectRepository.findMany({
        where: {
          projectId,
          provider: "github",
          githubInstallationId: installationId,
        },
        select: { id: true, externalId: true, owner: true, name: true },
      });
      if (linked.length) {
        await tx.projectRepository.deleteMany({
          where: {
            projectId,
            provider: "github",
            githubInstallationId: installationId,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          projectId,
          action: "github_app.installation_disconnected",
          entityType: "github_app_installation",
          entityId: connection.id,
          metadata: {
            installationId,
            disconnectedRepositoryCount: linked.length,
          },
        },
      });
      for (const repository of linked) {
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            projectId,
            action: "github_app.repository_disconnected",
            entityType: "project_repository",
            entityId: repository.id,
            metadata: {
              repositoryId: repository.externalId,
              fullName: `${repository.owner}/${repository.name}`,
              reason: "installation_disconnected",
            },
          },
        });
      }
    });
    return { disconnected: true };
  }

  async handleWebhook(input: {
    deliveryId: string;
    payloadHash: string;
    event: string;
    action?: string;
    installationId: string;
    repositoriesAdded?: Array<{ id: string; owner: string; name: string }>;
    repositoriesRemoved?: Array<{ id: string; owner: string; name: string }>;
  }) {
    if (!/^\d{1,40}$/.test(input.installationId))
      throw new BadRequestException("Invalid GitHub installation ID");
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.gitHubAppWebhookDelivery.create({
          data: {
            deliveryId: input.deliveryId,
            payloadHash: input.payloadHash,
            eventType: input.event,
          },
        });
        const connections = await tx.gitHubAppProjectConnection.findMany({
          where: { installationId: input.installationId },
        });
        if (input.event === "installation") {
          const status =
            input.action === "suspend"
              ? GitHubAppConnectionStatus.SUSPENDED
              : input.action === "unsuspend" || input.action === "created"
                ? GitHubAppConnectionStatus.ACTIVE
                : input.action === "deleted"
                  ? GitHubAppConnectionStatus.REMOVED
                  : null;
          if (!status) return { accepted: true, ignored: true };
          for (const connection of connections) {
            await tx.gitHubAppProjectConnection.update({
              where: { id: connection.id },
              data: {
                status,
                disconnectedAt:
                  status === GitHubAppConnectionStatus.REMOVED
                    ? new Date()
                    : null,
              },
            });
            await tx.auditLog.create({
              data: {
                projectId: connection.projectId,
                action: `github_app.installation_${input.action}`,
                entityType: "github_app_installation",
                entityId: connection.id,
                metadata: { installationId: input.installationId },
              },
            });
            if (status === GitHubAppConnectionStatus.REMOVED) {
              await tx.projectRepository.deleteMany({
                where: {
                  projectId: connection.projectId,
                  provider: "github",
                  githubInstallationId: input.installationId,
                },
              });
            }
          }
          return { accepted: true, affectedProjects: connections.length };
        }
        if (input.event === "installation_repositories") {
          const changed = [
            ...(input.repositoriesAdded ?? []),
            ...(input.repositoriesRemoved ?? []),
          ];
          for (const connection of connections) {
            for (const repo of input.repositoriesRemoved ?? []) {
              await tx.projectRepository.deleteMany({
                where: {
                  projectId: connection.projectId,
                  provider: "github",
                  githubInstallationId: input.installationId,
                  externalId: repo.id,
                },
              });
            }
            await tx.auditLog.create({
              data: {
                projectId: connection.projectId,
                action: "github_app.installation_repositories_changed",
                entityType: "github_app_installation",
                entityId: connection.id,
                metadata: {
                  installationId: input.installationId,
                  addedIds: (input.repositoriesAdded ?? []).map(
                    (repo) => repo.id,
                  ),
                  removedIds: (input.repositoriesRemoved ?? []).map(
                    (repo) => repo.id,
                  ),
                },
              },
            });
          }
          return {
            accepted: true,
            affectedProjects: connections.length,
            changed: changed.length,
          };
        }
        return { accepted: true, ignored: true };
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002"
      )
        return { accepted: true, duplicate: true };
      throw error;
    }
  }

  private async findConnection(projectId: string, installationId: string) {
    const connection = await this.prisma.gitHubAppProjectConnection.findUnique({
      where: { projectId_installationId: { projectId, installationId } },
    });
    if (!connection)
      throw new NotFoundException("GitHub installation not found");
    return connection;
  }

  private async findActiveConnection(
    projectId: string,
    installationId: string,
  ) {
    if (!/^\d{1,40}$/.test(installationId))
      throw new BadRequestException("Invalid GitHub installation ID");
    const connection = await this.findConnection(projectId, installationId);
    if (connection.status !== GitHubAppConnectionStatus.ACTIVE)
      throw new ConflictException("GitHub installation is not active");
    return connection;
  }

  private async requireProjectAdmin(actor: Actor, projectId: string) {
    if (actor.isSystemAdmin) return;
    const membership = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: actor.id } },
      select: { role: true },
    });
    if (!membership) throw new NotFoundException("Project not found");
    if (membership.role !== ProjectRole.ADMIN)
      throw new ForbiddenException("Project admin role required");
  }
}

function hashState(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeHashEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
