CREATE TYPE "GitHubAppConnectionStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REMOVED');

ALTER TABLE "ProjectRepository"
  ADD COLUMN "githubInstallationId" VARCHAR(40);

CREATE TABLE "GitHubAppProjectConnection" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "installationId" VARCHAR(40) NOT NULL,
  "accountLogin" VARCHAR(120) NOT NULL,
  "accountType" VARCHAR(40) NOT NULL,
  "status" "GitHubAppConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
  "disconnectedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "GitHubAppProjectConnection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GitHubAppProjectConnection_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "GitHubAppProjectConnection_projectId_installationId_key"
  ON "GitHubAppProjectConnection"("projectId", "installationId");
CREATE INDEX "GitHubAppProjectConnection_installationId_status_idx"
  ON "GitHubAppProjectConnection"("installationId", "status");
CREATE INDEX "GitHubAppProjectConnection_projectId_status_idx"
  ON "GitHubAppProjectConnection"("projectId", "status");

CREATE TABLE "GitHubAppInstallState" (
  "stateHash" CHAR(64) NOT NULL,
  "projectId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "consumedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GitHubAppInstallState_pkey" PRIMARY KEY ("stateHash"),
  CONSTRAINT "GitHubAppInstallState_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GitHubAppInstallState_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "GitHubAppInstallState_expiresAt_idx" ON "GitHubAppInstallState"("expiresAt");

CREATE TABLE "GitHubAppWebhookDelivery" (
  "deliveryId" VARCHAR(255) NOT NULL,
  "payloadHash" CHAR(64) NOT NULL,
  "eventType" VARCHAR(120) NOT NULL,
  "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GitHubAppWebhookDelivery_pkey" PRIMARY KEY ("deliveryId")
);
CREATE INDEX "GitHubAppWebhookDelivery_receivedAt_idx"
  ON "GitHubAppWebhookDelivery"("receivedAt");
