import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { ProjectRole } from "../generated/prisma/enums";
import { PrismaService } from "../prisma/prisma.service";
import {
  AttachmentScanner,
  AttachmentStorage,
} from "./release-content.adapters";
import { validateAttachmentType } from "./attachment-type.validation";
import {
  validateDeploymentMetadata,
  validateReleaseDocumentAst,
  validateReleaseText,
} from "./release-content.validation";

export type ReleaseContentActor = { id: string; isSystemAdmin: boolean };

const WRITE_ROLES = [
  ProjectRole.ADMIN,
  ProjectRole.RELEASE_MANAGER,
  ProjectRole.DEVELOPER,
];
const READ_ROLES: ProjectRole[] = [
  ProjectRole.ADMIN,
  ProjectRole.RELEASE_MANAGER,
  ProjectRole.DEVELOPER,
  ProjectRole.REVIEWER,
];
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const ATTACHMENT_STORAGE = "ATTACHMENT_STORAGE";
export const ATTACHMENT_SCANNER = "ATTACHMENT_SCANNER";

@Injectable()
export class ReleaseContentService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
    @Inject(ATTACHMENT_SCANNER) private readonly scanner: AttachmentScanner,
  ) {}

  async listDocuments(
    actor: ReleaseContentActor,
    projectId: string,
    releaseId: string,
  ) {
    await this.requireRelease(actor, projectId, releaseId, false);
    return this.prisma.releaseDocument.findMany({
      where: { releaseId },
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "asc" }],
    });
  }

  async getDocument(
    actor: ReleaseContentActor,
    projectId: string,
    documentId: string,
  ) {
    return this.findDocument(actor, projectId, documentId, false);
  }

  async createDocument(
    actor: ReleaseContentActor,
    projectId: string,
    releaseId: string,
    input: {
      section: string;
      title: string;
      content: unknown;
      sortOrder?: number;
    },
  ) {
    await this.requireRelease(actor, projectId, releaseId, true);
    validateReleaseText(input.section, "Document section");
    validateReleaseText(input.title, "Document title");
    validateReleaseDocumentAst(input.content);
    return this.prisma.$transaction(async (tx) => {
      const document = await tx.releaseDocument.create({
        data: {
          releaseId,
          section: input.section,
          title: input.title,
          content: input.content as any,
          sortOrder: input.sortOrder ?? 0,
        },
      });
      await this.writeAudit(
        tx,
        actor,
        projectId,
        "release_content.document.created",
        "release_document",
        document.id,
        { fields: ["section", "title", "content", "sortOrder"] },
      );
      return document;
    });
  }

  async updateDocument(
    actor: ReleaseContentActor,
    projectId: string,
    documentId: string,
    input: {
      section?: string;
      title?: string;
      content?: unknown;
      sortOrder?: number;
    },
  ) {
    const document = await this.findDocument(
      actor,
      projectId,
      documentId,
      true,
    );
    if (input.section !== undefined)
      validateReleaseText(input.section, "Document section");
    if (input.title !== undefined)
      validateReleaseText(input.title, "Document title");
    if (input.content !== undefined) validateReleaseDocumentAst(input.content);
    const data = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    );
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.releaseDocument.update({
        where: { id: document.id },
        data: {
          ...data,
          ...(input.content === undefined
            ? {}
            : { content: input.content as any }),
        },
      });
      await this.writeAudit(
        tx,
        actor,
        projectId,
        "release_content.document.updated",
        "release_document",
        document.id,
        { fields: Object.keys(data) },
      );
      return updated;
    });
  }

  async deleteDocument(
    actor: ReleaseContentActor,
    projectId: string,
    documentId: string,
  ) {
    const document = await this.findDocument(
      actor,
      projectId,
      documentId,
      true,
    );
    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.releaseDocument.delete({
        where: { id: document.id },
      });
      await this.writeAudit(
        tx,
        actor,
        projectId,
        "release_content.document.deleted",
        "release_document",
        document.id,
        {},
      );
      return deleted;
    });
  }

  async reorderDocuments(
    actor: ReleaseContentActor,
    projectId: string,
    releaseId: string,
    documentIds: string[],
  ) {
    await this.requireRelease(actor, projectId, releaseId, true);
    if (!documentIds.length || new Set(documentIds).size !== documentIds.length)
      throw new ForbiddenException(
        "Reorder must include each release document exactly once",
      );
    const documents = await this.prisma.releaseDocument.findMany({
      where: { releaseId },
      select: { id: true },
    });
    if (
      documents.length !== documentIds.length ||
      documents.some((document) => !documentIds.includes(document.id))
    )
      throw new ForbiddenException(
        "Reorder must include each release document exactly once",
      );
    await this.prisma.$transaction(async (tx) => {
      for (const [sortOrder, id] of documentIds.entries()) {
        await tx.releaseDocument.updateMany({
          where: { id, releaseId },
          data: { sortOrder },
        });
        await this.writeAudit(
          tx,
          actor,
          projectId,
          "release_content.document.reordered",
          "release_document",
          id,
          { sortOrder },
        );
      }
    });
    return this.listDocuments(actor, projectId, releaseId);
  }

  async listAttachments(
    actor: ReleaseContentActor,
    projectId: string,
    releaseId: string,
  ) {
    await this.requireRelease(actor, projectId, releaseId, false);
    const attachments = await this.prisma.releaseAttachment.findMany({
      where: { releaseId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        checksumSha256: true,
        scanStatus: true,
        publicAllowed: true,
        createdAt: true,
      },
    });
    return attachments.map((attachment: any) => ({
      ...attachment,
      sizeBytes: String(attachment.sizeBytes),
    }));
  }

  async uploadAttachment(
    actor: ReleaseContentActor,
    projectId: string,
    releaseId: string,
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    },
  ) {
    await this.requireRelease(actor, projectId, releaseId, true);
    if (
      !file?.buffer ||
      !file.size ||
      file.size !== file.buffer.byteLength ||
      file.size > MAX_ATTACHMENT_BYTES
    )
      throw new BadRequestException(
        "Attachment must be between 1 byte and 25 MiB",
      );
    const fileName =
      file.originalname
        .replace(/[\\/\0-\x1f\x7f]/g, "_")
        .trim()
        .slice(0, 255) || "attachment";
    validateReleaseText(fileName, "Attachment file name");
    const contentType = validateAttachmentType(
      fileName,
      file.mimetype,
      file.buffer,
    );
    const stored = await this.storage.put(file.buffer);
    try {
      const attachment = await this.prisma.$transaction(async (tx) => {
        const created = await tx.releaseAttachment.create({
          data: {
            releaseId,
            storageKey: stored.storageKey,
            fileName,
            contentType,
            sizeBytes: BigInt(file.size),
            checksumSha256: stored.checksumSha256,
            scanStatus: "PENDING",
            publicAllowed: false,
          },
          select: {
            id: true,
            fileName: true,
            contentType: true,
            sizeBytes: true,
            checksumSha256: true,
            scanStatus: true,
            publicAllowed: true,
            createdAt: true,
          },
        });
        await this.writeAudit(
          tx,
          actor,
          projectId,
          "release_content.attachment.uploaded",
          "release_attachment",
          created.id,
          {
            contentType: created.contentType,
            sizeBytes: String(created.sizeBytes),
          },
        );
        return created;
      });
      return {
        ...attachment,
        sizeBytes: String(attachment.sizeBytes),
        publicAllowed: false,
      };
    } catch (error) {
      await this.storage.delete(stored.storageKey);
      throw error;
    }
  }

  async scanAttachment(
    actor: ReleaseContentActor,
    projectId: string,
    attachmentId: string,
  ) {
    const attachment = await this.findAttachment(
      actor,
      projectId,
      attachmentId,
      true,
    );
    let scanStatus: "CLEAN" | "INFECTED" | "FAILED";
    try {
      const bytes = await this.readVerifiedAttachment(attachment);
      scanStatus = await this.scanner.scan(bytes);
    } catch (error) {
      const reason =
        error instanceof ForbiddenException
          ? "integrity_failure"
          : "scanner_unavailable";
      await this.prisma.$transaction(async (tx) => {
        await tx.releaseAttachment.update({
          where: { id: attachment.id },
          data: { scanStatus: "FAILED", publicAllowed: false },
        });
        await this.writeAudit(
          tx,
          actor,
          projectId,
          "release_content.attachment.scan_failed",
          "release_attachment",
          attachment.id,
          { reason },
        );
      });
      if (error instanceof ForbiddenException) throw error;
      throw new ServiceUnavailableException("Attachment scan unavailable");
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.releaseAttachment.update({
        where: { id: attachment.id },
        data: { scanStatus, publicAllowed: false },
        select: { id: true, scanStatus: true, publicAllowed: true },
      });
      await this.writeAudit(
        tx,
        actor,
        projectId,
        "release_content.attachment.scanned",
        "release_attachment",
        attachment.id,
        { scanStatus },
      );
      return { ...updated, publicAllowed: false };
    });
  }

  async setAttachmentPublic(
    actor: ReleaseContentActor,
    projectId: string,
    attachmentId: string,
    publicAllowed: boolean,
  ) {
    const attachment = await this.findAttachment(
      actor,
      projectId,
      attachmentId,
      true,
    );
    if (publicAllowed && attachment.scanStatus !== "CLEAN") {
      throw new ForbiddenException(
        "Only scan-clean attachments can be included in a public release",
      );
    }
    if (!actor.isSystemAdmin) {
      const membership = await this.prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: actor.id } },
        select: { role: true },
      });
      if (
        !membership ||
        (membership.role !== ProjectRole.ADMIN &&
          membership.role !== ProjectRole.RELEASE_MANAGER)
      ) {
        throw new ForbiddenException(
          "Only project administrators and release managers can set public attachment access",
        );
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.releaseAttachment.update({
        where: { id: attachment.id },
        data: { publicAllowed },
        select: {
          id: true,
          fileName: true,
          contentType: true,
          sizeBytes: true,
          checksumSha256: true,
          scanStatus: true,
          publicAllowed: true,
        },
      });
      await this.writeAudit(
        tx,
        actor,
        projectId,
        "release_content.attachment.public_access_updated",
        "release_attachment",
        attachment.id,
        { publicAllowed },
      );
      return { ...updated, sizeBytes: String(updated.sizeBytes) };
    });
  }

  async getPrivateAttachment(
    actor: ReleaseContentActor,
    projectId: string,
    attachmentId: string,
  ) {
    const attachment = await this.findAttachment(
      actor,
      projectId,
      attachmentId,
      false,
    );
    const bytes = await this.readVerifiedAttachment(attachment);
    await this.prisma.$transaction((tx) =>
      this.writeAudit(
        tx,
        actor,
        projectId,
        "release_content.attachment.downloaded",
        "release_attachment",
        attachment.id,
        { access: "private" },
      ),
    );
    return { metadata: this.attachmentMetadata(attachment), bytes };
  }

  async getPublicAttachment(_attachmentId: string): Promise<never> {
    throw new ForbiddenException(
      "Public attachment access requires immutable publication snapshot linkage",
    );
  }

  async listDeployments(
    actor: ReleaseContentActor,
    projectId: string,
    releaseId: string,
  ) {
    await this.requireRelease(actor, projectId, releaseId, false);
    return this.prisma.releaseDeployment.findMany({
      where: { releaseId, environment: { projectId } },
      include: { environment: true },
      orderBy: [{ deployedAt: "desc" }, { createdAt: "desc" }],
    });
  }

  async createDeployment(
    actor: ReleaseContentActor,
    projectId: string,
    releaseId: string,
    input: {
      environmentId: string;
      status: string;
      externalId?: string;
      deployedAt?: string;
      metadata?: unknown;
    },
  ) {
    await this.requireRelease(actor, projectId, releaseId, true);
    const environment = await this.prisma.projectEnvironment.findFirst({
      where: { id: input.environmentId, projectId, enabled: true },
      select: { id: true },
    });
    if (!environment)
      throw new NotFoundException("Enabled project environment not found");
    this.validateDeploymentInput(input);
    if (input.externalId)
      validateReleaseText(input.externalId, "Deployment external ID");
    const metadata = input.metadata ?? {};
    validateDeploymentMetadata(metadata);
    return this.prisma.$transaction(async (tx) => {
      const deployment = await tx.releaseDeployment.create({
        data: {
          releaseId,
          environmentId: environment.id,
          status: input.status.trim(),
          externalId: input.externalId?.trim() || null,
          deployedAt: input.deployedAt ? new Date(input.deployedAt) : null,
          metadata: metadata as any,
        },
        include: { environment: true },
      });
      await this.writeAudit(
        tx,
        actor,
        projectId,
        "release_content.deployment.created",
        "release_deployment",
        deployment.id,
        {
          environmentId: environment.id,
          fields: ["status", "externalId", "deployedAt", "metadata"],
        },
      );
      return deployment;
    });
  }

  async updateDeployment(
    actor: ReleaseContentActor,
    projectId: string,
    deploymentId: string,
    input: {
      status?: string;
      externalId?: string | null;
      deployedAt?: string | null;
      metadata?: unknown;
    },
  ) {
    const deployment = await this.prisma.releaseDeployment.findFirst({
      where: { id: deploymentId, release: { projectId } },
      include: { release: { select: { id: true, projectId: true } } },
    });
    if (!deployment) throw new NotFoundException("Deployment not found");
    await this.requireRelease(actor, projectId, deployment.releaseId, true);
    this.validateDeploymentInput(input);
    if (input.externalId)
      validateReleaseText(input.externalId, "Deployment external ID");
    if (input.metadata !== undefined)
      validateDeploymentMetadata(input.metadata);
    const data = {
      ...(input.status !== undefined ? { status: input.status.trim() } : {}),
      ...(input.externalId !== undefined
        ? { externalId: input.externalId?.trim() || null }
        : {}),
      ...(input.deployedAt !== undefined
        ? { deployedAt: input.deployedAt ? new Date(input.deployedAt) : null }
        : {}),
      ...(input.metadata !== undefined
        ? { metadata: input.metadata as any }
        : {}),
    };
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.releaseDeployment.update({
        where: { id: deployment.id },
        data,
        include: { environment: true },
      });
      await this.writeAudit(
        tx,
        actor,
        projectId,
        "release_content.deployment.updated",
        "release_deployment",
        deployment.id,
        { fields: Object.keys(data) },
      );
      return updated;
    });
  }

  private validateDeploymentInput(input: {
    status?: string;
    deployedAt?: string | null;
  }) {
    if (input.status !== undefined) {
      if (!input.status.trim() || input.status.trim().length > 40)
        throw new BadRequestException(
          "Deployment status must contain 1 to 40 characters",
        );
      validateReleaseText(input.status, "Deployment status");
    }
    if (input.deployedAt) {
      const date = new Date(input.deployedAt);
      if (Number.isNaN(date.getTime()))
        throw new BadRequestException("deployedAt must be a valid date");
    }
  }

  private attachmentMetadata(attachment: any) {
    return {
      id: attachment.id,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      sizeBytes: String(attachment.sizeBytes),
      checksumSha256: attachment.checksumSha256,
      scanStatus: attachment.scanStatus,
      publicAllowed: attachment.publicAllowed,
    };
  }

  private async readVerifiedAttachment(attachment: any) {
    const bytes = await this.storage.get(attachment.storageKey);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (checksum !== attachment.checksumSha256)
      throw new ForbiddenException(
        "Attachment failed its storage integrity check",
      );
    return bytes;
  }

  private async findDocument(
    actor: ReleaseContentActor,
    projectId: string,
    documentId: string,
    write: boolean,
  ) {
    const document = await this.prisma.releaseDocument.findFirst({
      where: { id: documentId, release: { projectId } },
      include: { release: { select: { id: true, projectId: true } } },
    });
    if (!document) throw new NotFoundException("Release document not found");
    await this.requireRelease(actor, projectId, document.releaseId, write);
    return document;
  }

  private async findAttachment(
    actor: ReleaseContentActor,
    projectId: string,
    attachmentId: string,
    write: boolean,
  ) {
    const attachment = await this.prisma.releaseAttachment.findFirst({
      where: { id: attachmentId, release: { projectId } },
      include: {
        release: { select: { id: true, projectId: true, status: true } },
      },
    });
    if (!attachment) throw new NotFoundException("Attachment not found");
    await this.requireRelease(actor, projectId, attachment.releaseId, write);
    return attachment;
  }

  private async requireRelease(
    actor: ReleaseContentActor,
    projectId: string,
    releaseId: string,
    write: boolean,
  ) {
    const release = await this.prisma.release.findFirst({
      where: { id: releaseId, projectId },
      select: { id: true },
    });
    if (!release) throw new NotFoundException("Release not found in project");
    if (actor.isSystemAdmin) return;
    const membership = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: actor.id } },
      select: { role: true },
    });
    if (!membership) throw new NotFoundException("Project not found");
    const allowed = write ? WRITE_ROLES : READ_ROLES;
    if (!allowed.includes(membership.role))
      throw new ForbiddenException(
        "Your project role does not allow this action",
      );
  }

  private writeAudit(
    tx: any,
    actor: ReleaseContentActor,
    projectId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ) {
    return tx.auditLog.create({
      data: {
        actorId: actor.id,
        projectId,
        action,
        entityType,
        entityId,
        metadata,
      },
    });
  }
}
