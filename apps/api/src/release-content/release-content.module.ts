import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import {
  createAttachmentScanner,
  LocalAttachmentStorage,
} from "./release-content.adapters";
import { ReleaseContentController } from "./release-content.controller";
import {
  ATTACHMENT_SCANNER,
  ATTACHMENT_STORAGE,
  ReleaseContentService,
} from "./release-content.service";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ReleaseContentController],
  providers: [
    ReleaseContentService,
    LocalAttachmentStorage,
    { provide: ATTACHMENT_STORAGE, useExisting: LocalAttachmentStorage },
    {
      provide: ATTACHMENT_SCANNER,
      useFactory: () => createAttachmentScanner(),
    },
  ],
  exports: [
    ReleaseContentService,
    LocalAttachmentStorage,
    ATTACHMENT_STORAGE,
    ATTACHMENT_SCANNER,
  ],
})
export class ReleaseContentModule {}
