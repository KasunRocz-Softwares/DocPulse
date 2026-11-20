CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'DEAD');
CREATE TYPE "NotificationDeliveryKind" AS ENUM ('VERIFICATION', 'PUBLICATION');

ALTER TABLE "Subscription"
  ADD COLUMN "preferences" JSONB NOT NULL DEFAULT '{"newReleases":true,"securityOnly":false}',
  ADD COLUMN "verificationTokenHash" CHAR(64),
  ADD COLUMN "unsubscribeTokenHash" CHAR(64),
  ADD COLUMN "unsubscribedAt" TIMESTAMPTZ(6),
  ADD COLUMN "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Subscription"
SET "unsubscribeTokenHash" = encode(sha256(convert_to("id"::text || ':' || random()::text, 'UTF8')), 'hex'),
    "verifiedAt" = COALESCE("verifiedAt", CURRENT_TIMESTAMP);

ALTER TABLE "Subscription" ALTER COLUMN "unsubscribeTokenHash" SET NOT NULL;
CREATE UNIQUE INDEX "Subscription_verificationTokenHash_key" ON "Subscription"("verificationTokenHash");
CREATE UNIQUE INDEX "Subscription_unsubscribeTokenHash_key" ON "Subscription"("unsubscribeTokenHash");
CREATE INDEX "Subscription_projectId_verifiedAt_unsubscribedAt_idx" ON "Subscription"("projectId", "verifiedAt", "unsubscribedAt");
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "NotificationDelivery" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "subscriptionId" UUID NOT NULL,
  "publicationId" UUID,
  "kind" "NotificationDeliveryKind" NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMPTZ(6),
  "lastErrorCode" VARCHAR(80),
  "payload" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NotificationDelivery_subscriptionId_publicationId_kind_key"
  ON "NotificationDelivery"("subscriptionId", "publicationId", "kind");
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx"
  ON "NotificationDelivery"("status", "nextAttemptAt");
CREATE INDEX "NotificationDelivery_projectId_createdAt_idx"
  ON "NotificationDelivery"("projectId", "createdAt" DESC);
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_publicationId_fkey"
  FOREIGN KEY ("publicationId") REFERENCES "PublicReleaseSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
