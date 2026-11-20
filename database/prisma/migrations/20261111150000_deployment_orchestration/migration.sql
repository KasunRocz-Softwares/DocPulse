ALTER TABLE "ProjectEnvironment"
  ADD COLUMN "deploymentTriggerEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "deploymentRequiresApprovedRelease" BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE "DeploymentTriggerRequest" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "releaseId" UUID NOT NULL,
  "environmentId" UUID NOT NULL,
  "requestedById" UUID NOT NULL,
  "idempotencyKey" VARCHAR(120) NOT NULL,
  "requestHash" CHAR(64) NOT NULL,
  "reason" VARCHAR(500),
  "status" VARCHAR(24) NOT NULL DEFAULT 'REQUESTED',
  "resultCode" VARCHAR(80),
  "resultSummary" VARCHAR(500),
  "requestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMPTZ(6),
  "completedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "DeploymentTriggerRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeploymentTriggerRequest_status_check"
    CHECK ("status" IN ('REQUESTED', 'ACCEPTED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  CONSTRAINT "DeploymentTriggerRequest_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DeploymentTriggerRequest_releaseId_fkey"
    FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DeploymentTriggerRequest_environmentId_fkey"
    FOREIGN KEY ("environmentId") REFERENCES "ProjectEnvironment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DeploymentTriggerRequest_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DeploymentTriggerRequest_projectId_idempotencyKey_key"
  ON "DeploymentTriggerRequest"("projectId", "idempotencyKey");
CREATE INDEX "DeploymentTriggerRequest_projectId_createdAt_idx"
  ON "DeploymentTriggerRequest"("projectId", "createdAt" DESC);
CREATE INDEX "DeploymentTriggerRequest_environmentId_status_createdAt_idx"
  ON "DeploymentTriggerRequest"("environmentId", "status", "createdAt");
CREATE INDEX "DeploymentTriggerRequest_releaseId_createdAt_idx"
  ON "DeploymentTriggerRequest"("releaseId", "createdAt" DESC);
