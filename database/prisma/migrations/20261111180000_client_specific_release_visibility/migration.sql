CREATE TYPE "ReleaseAudienceMode" AS ENUM ('PUBLIC', 'CLIENTS');

CREATE TABLE "ClientAudience" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "slug" VARCHAR(80) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "ClientAudience_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReleaseClientAudience" (
  "releaseId" UUID NOT NULL,
  "audienceId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReleaseClientAudience_pkey" PRIMARY KEY ("releaseId", "audienceId")
);

CREATE TABLE "PublicSnapshotClientAudience" (
  "snapshotId" UUID NOT NULL,
  "audienceId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicSnapshotClientAudience_pkey" PRIMARY KEY ("snapshotId", "audienceId")
);

ALTER TABLE "ProjectMember" ADD COLUMN "clientAudienceId" UUID;
ALTER TABLE "Release" ADD COLUMN "audienceMode" "ReleaseAudienceMode" NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE "PublicReleaseSnapshot" ADD COLUMN "audienceMode" "ReleaseAudienceMode" NOT NULL DEFAULT 'PUBLIC';

CREATE UNIQUE INDEX "ClientAudience_projectId_slug_key" ON "ClientAudience"("projectId", "slug");
CREATE INDEX "ClientAudience_projectId_name_idx" ON "ClientAudience"("projectId", "name");
CREATE INDEX "ReleaseClientAudience_audienceId_releaseId_idx" ON "ReleaseClientAudience"("audienceId", "releaseId");
CREATE INDEX "PublicSnapshotClientAudience_audienceId_snapshotId_idx" ON "PublicSnapshotClientAudience"("audienceId", "snapshotId");

ALTER TABLE "ClientAudience" ADD CONSTRAINT "ClientAudience_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_clientAudienceId_fkey"
  FOREIGN KEY ("clientAudienceId") REFERENCES "ClientAudience"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReleaseClientAudience" ADD CONSTRAINT "ReleaseClientAudience_releaseId_fkey"
  FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReleaseClientAudience" ADD CONSTRAINT "ReleaseClientAudience_audienceId_fkey"
  FOREIGN KEY ("audienceId") REFERENCES "ClientAudience"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PublicSnapshotClientAudience" ADD CONSTRAINT "PublicSnapshotClientAudience_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "PublicReleaseSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PublicSnapshotClientAudience" ADD CONSTRAINT "PublicSnapshotClientAudience_audienceId_fkey"
  FOREIGN KEY ("audienceId") REFERENCES "ClientAudience"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
