import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { ServerResponse } from "node:http";
import { once } from "node:events";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { AuthenticatedRequest, JwtAuthGuard } from "../auth/jwt-auth.guard";
import { auditCsvCell, ProjectsService } from "./projects.service";
import { ProjectRole, ProjectStatus } from "../generated/prisma/enums";

class CreateProjectInput {
  @IsString() @MinLength(2) @MaxLength(160) name!: string;
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(80)
  slug!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
}

class AddProjectMemberInput {
  @IsEmail() @MaxLength(320) email!: string;
  @IsOptional() @IsString() @MaxLength(160) displayName?: string;
  @IsEnum(ProjectRole) role!: ProjectRole;
}

class UpdateProjectMemberInput {
  @IsEnum(ProjectRole) role!: ProjectRole;
}

class CreateRepositoryInput {
  @IsOptional() @IsString() @MaxLength(40) provider?: string;
  @IsString() @MinLength(1) @MaxLength(120) owner!: string;
  @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(160) externalId?: string;
}

class UpdateEnvironmentInput {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) label?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

class UpdateProjectInput {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(160) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @IsOptional() @IsEnum(ProjectStatus) status?: ProjectStatus;
}

class UpdateProjectBrandInput {
  @IsOptional() @Matches(/^#[0-9A-Fa-f]{6}$/) primaryColor?: string;
  @IsOptional() @Matches(/^#[0-9A-Fa-f]{6}$/) accentColor?: string | null;
  @IsOptional() @IsString() @MaxLength(2048) logoUrl?: string | null;
  @IsOptional()
  @Matches(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
  defaultLocale?: string;
}

@ApiTags("internal projects")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("internal/projects")
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}
  @Get() list(@Req() request: AuthenticatedRequest) {
    return this.projects.listForUser(
      request.user.id,
      request.user.isSystemAdmin,
    );
  }
  @Post() create(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateProjectInput,
  ) {
    return this.projects.create(request.user, body);
  }
  @Get(":projectId") get(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
  ) {
    return this.projects.getForUser(
      projectId,
      request.user.id,
      request.user.isSystemAdmin,
    );
  }
  @Patch(":projectId") update(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Body() body: UpdateProjectInput,
  ) {
    return this.projects.updateProject(request.user, projectId, body);
  }
  @Get(":projectId/brand") getBrand(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
  ) {
    return this.projects.getBrand(request.user, projectId);
  }
  @Patch(":projectId/brand") updateBrand(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Body() body: UpdateProjectBrandInput,
  ) {
    return this.projects.updateBrand(request.user, projectId, body);
  }
  @Get(":projectId/members") listMembers(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
  ) {
    return this.projects.listMembers(request.user, projectId);
  }
  @Post(":projectId/members") addMember(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Body() body: AddProjectMemberInput,
  ) {
    return this.projects.addMember(request.user, projectId, body);
  }
  @Patch(":projectId/members/:membershipId") updateMemberRole(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Param("membershipId") membershipId: string,
    @Body() body: UpdateProjectMemberInput,
  ) {
    return this.projects.updateMemberRole(
      request.user,
      projectId,
      membershipId,
      body.role,
    );
  }
  @Delete(":projectId/members/:membershipId") removeMember(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Param("membershipId") membershipId: string,
  ) {
    return this.projects.removeMember(request.user, projectId, membershipId);
  }
  @Get(":projectId/repositories") listRepositories(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
  ) {
    return this.projects.listRepositories(request.user, projectId);
  }
  @Post(":projectId/repositories") addRepository(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Body() body: CreateRepositoryInput,
  ) {
    return this.projects.addRepository(request.user, projectId, body);
  }
  @Delete(":projectId/repositories/:repositoryId") removeRepository(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Param("repositoryId") repositoryId: string,
  ) {
    return this.projects.removeRepository(
      request.user,
      projectId,
      repositoryId,
    );
  }
  @Get(":projectId/environments") listEnvironments(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
  ) {
    return this.projects.listEnvironments(request.user, projectId);
  }
  @Patch(":projectId/environments/:environmentId") updateEnvironment(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Param("environmentId") environmentId: string,
    @Body() body: UpdateEnvironmentInput,
  ) {
    return this.projects.updateEnvironment(
      request.user,
      projectId,
      environmentId,
      body,
    );
  }
  @Get(":projectId/audit") listAuditEvents(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.projects.listAuditEvents(
      request.user,
      projectId,
      Number(page ?? 1),
      Number(pageSize ?? 50),
    );
  }

  @Get(":projectId/audit/export.csv")
  async exportAuditEvents(
    @Req() request: AuthenticatedRequest,
    @Param("projectId") projectId: string,
    @Res() response: ServerResponse,
  ) {
    const events = await this.projects.exportAuditEvents(
      request.user,
      projectId,
    );
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="project-audit.csv"',
    );
    response.write("timestamp,actor,action,entity,metadata\n");

    try {
      for await (const event of events) {
        if (response.destroyed) return;
        const actor = event.actor
          ? `${event.actor.displayName} <${event.actor.email}> (${event.actor.id})`
          : "";
        const row = [
          event.createdAt.toISOString(),
          actor,
          event.action,
          `${event.entityType}:${event.entityId ?? ""}`,
          event.metadata == null ? "" : JSON.stringify(event.metadata),
        ]
          .map(auditCsvCell)
          .join(",");
        if (!response.write(`${row}\n`)) await once(response, "drain");
      }
      response.end();
    } catch (error) {
      response.destroy(error instanceof Error ? error : undefined);
    }
  }
}
