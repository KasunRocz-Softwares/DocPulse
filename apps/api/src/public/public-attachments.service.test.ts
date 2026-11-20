import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { PublicAttachmentsService } from "./public-attachments.service";

const bytes = Buffer.from("public release attachment");
const checksumSha256 = createHash("sha256").update(bytes).digest("hex");

test("downloads only attachment metadata frozen in an active public snapshot", async () => {
  let query: unknown;
  const service = new PublicAttachmentsService(
    {
      publicSnapshotAttachment: {
        findFirst: async (value: unknown) => {
          query = value;
          return {
            storageKey: "safe-storage-key",
            fileName: "guide.pdf",
            contentType: "application/pdf",
            sizeBytes: 25n,
            checksumSha256,
          };
        },
      },
    } as never,
    { get: async () => bytes } as never,
  );

  const result = await service.download("rdps", "1.2.0", "attachment-1");

  assert.deepEqual(result.bytes, bytes);
  assert.deepEqual(result.metadata, {
    fileName: "guide.pdf",
    contentType: "application/pdf",
    sizeBytes: "25",
  });
  assert.deepEqual(query, {
    where: {
      id: "attachment-1",
      snapshot: {
        projectSlug: "rdps",
        version: "1.2.0",
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
});

test("does not serve attachments from revoked or unrelated snapshots", async () => {
  const service = new PublicAttachmentsService(
    { publicSnapshotAttachment: { findFirst: async () => null } } as never,
    {
      get: async () => {
        throw new Error("Private storage must not be read");
      },
    } as never,
  );

  await assert.rejects(
    service.download("other-project", "1.2.0", "attachment-1"),
    (error: unknown) => error instanceof NotFoundException,
  );
});

test("rejects public attachment bytes that no longer match the frozen checksum", async () => {
  const service = new PublicAttachmentsService(
    {
      publicSnapshotAttachment: {
        findFirst: async () => ({
          storageKey: "safe-storage-key",
          fileName: "guide.pdf",
          contentType: "application/pdf",
          sizeBytes: BigInt(bytes.length),
          checksumSha256: "0".repeat(64),
        }),
      },
    } as never,
    { get: async () => bytes } as never,
  );

  await assert.rejects(
    service.download("rdps", "1.2.0", "attachment-1"),
    (error: unknown) => error instanceof ForbiddenException,
  );
});
