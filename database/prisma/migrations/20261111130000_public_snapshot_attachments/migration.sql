CREATE TABLE "PublicSnapshotAttachment" (
  "id" UUID NOT NULL,
  "snapshotId" UUID NOT NULL,
  "sourceAttachmentId" UUID NOT NULL,
  "storageKey" VARCHAR(512) NOT NULL,
  "fileName" VARCHAR(255) NOT NULL,
  "contentType" VARCHAR(160) NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "checksumSha256" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicSnapshotAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PublicSnapshotAttachment_snapshotId_sourceAttachmentId_key"
  ON "PublicSnapshotAttachment"("snapshotId", "sourceAttachmentId");
CREATE INDEX "PublicSnapshotAttachment_snapshotId_fileName_idx"
  ON "PublicSnapshotAttachment"("snapshotId", "fileName");

ALTER TABLE "PublicSnapshotAttachment"
  ADD CONSTRAINT "PublicSnapshotAttachment_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "PublicReleaseSnapshot"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "PublicSnapshotAttachment_immutable"
  BEFORE UPDATE OR DELETE ON "PublicSnapshotAttachment"
  FOR EACH ROW EXECUTE FUNCTION "reject_public_snapshot_mutation"();
