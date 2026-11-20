-- Persist unmatched source references for project review and enforce webhook/deployment idempotency.
CREATE TABLE "IntegrationSuggestion" (
    "id" UUID NOT NULL,
    "projectId" UUID,
    "webhookEventId" UUID NOT NULL,
    "repository" VARCHAR(280) NOT NULL,
    "referenceKind" VARCHAR(24) NOT NULL,
    "externalId" VARCHAR(160) NOT NULL,
    "revision" VARCHAR(160),
    "action" VARCHAR(80) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMPTZ(6),
    CONSTRAINT "IntegrationSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationSuggestion_webhookEventId_key" ON "IntegrationSuggestion"("webhookEventId");
CREATE INDEX "IntegrationSuggestion_projectId_status_createdAt_idx" ON "IntegrationSuggestion"("projectId", "status", "createdAt" DESC);
CREATE INDEX "IntegrationSuggestion_status_createdAt_idx" ON "IntegrationSuggestion"("status", "createdAt" DESC);
CREATE UNIQUE INDEX "ReleaseDeployment_externalId_key" ON "ReleaseDeployment"("externalId");
CREATE UNIQUE INDEX "WebhookEvent_provider_payloadHash_key" ON "WebhookEvent"("provider", "payloadHash");

ALTER TABLE "IntegrationSuggestion" ADD CONSTRAINT "IntegrationSuggestion_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IntegrationSuggestion" ADD CONSTRAINT "IntegrationSuggestion_webhookEventId_fkey"
    FOREIGN KEY ("webhookEventId") REFERENCES "WebhookEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
