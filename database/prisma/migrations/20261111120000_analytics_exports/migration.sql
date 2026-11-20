CREATE TYPE "AnalyticsEventKind" AS ENUM ('PROJECT_VIEW', 'RELEASE_VIEW');
CREATE TYPE "AnalyticsExportKind" AS ENUM ('ANALYTICS_CSV', 'RELEASE_PDF');
CREATE TYPE "AnalyticsExportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "AnalyticsEvent" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "snapshotId" UUID,
  "kind" "AnalyticsEventKind" NOT NULL,
  "occurredOn" DATE NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnalyticsExportJob" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "requestedById" UUID NOT NULL,
  "kind" "AnalyticsExportKind" NOT NULL,
  "status" "AnalyticsExportStatus" NOT NULL DEFAULT 'PENDING',
  "filename" VARCHAR(255) NOT NULL,
  "contentType" VARCHAR(120),
  "artifact" BYTEA,
  "requestData" JSONB NOT NULL DEFAULT '{}',
  "errorCode" VARCHAR(80),
  "completedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "AnalyticsExportJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AnalyticsEvent_projectId_occurredOn_kind_idx" ON "AnalyticsEvent"("projectId", "occurredOn", "kind");
CREATE INDEX "AnalyticsEvent_snapshotId_kind_idx" ON "AnalyticsEvent"("snapshotId", "kind");
CREATE INDEX "AnalyticsExportJob_projectId_createdAt_idx" ON "AnalyticsExportJob"("projectId", "createdAt" DESC);
CREATE INDEX "AnalyticsExportJob_status_createdAt_idx" ON "AnalyticsExportJob"("status", "createdAt");

ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "PublicReleaseSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AnalyticsExportJob" ADD CONSTRAINT "AnalyticsExportJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalyticsExportJob" ADD CONSTRAINT "AnalyticsExportJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
