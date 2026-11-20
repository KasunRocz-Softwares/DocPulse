import { createHash } from "node:crypto";
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { AttachmentStorage } from "../release-content/release-content.adapters";
import { ATTACHMENT_STORAGE } from "../release-content/release-content.service";

@Injectable()
export class PublicAttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
  ) {}

  async download(projectSlug: string, version: string, attachmentId: string) {
    const attachment = await this.prisma.publicSnapshotAttachment.findFirst({
      where: {
        id: attachmentId,
        snapshot: {
          projectSlug,
          version,
          audienceMode: "PUBLIC",
          publication: { revokedAt: null },
        },
      },
      select: {
        storageKey: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        checksumSha256: true,
      },
    });
    if (!attachment)
      throw new NotFoundException("Published attachment not found");

    const bytes = await this.storage.get(attachment.storageKey);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (
      BigInt(bytes.length) !== attachment.sizeBytes ||
      checksum !== attachment.checksumSha256
    ) {
      throw new ForbiddenException(
        "Attachment failed its published integrity check",
      );
    }
    return {
      bytes,
      metadata: {
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes.toString(),
      },
    };
  }
}
