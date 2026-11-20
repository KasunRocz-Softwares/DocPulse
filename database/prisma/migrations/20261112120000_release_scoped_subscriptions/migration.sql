ALTER TABLE "Subscription"
  ADD COLUMN "releaseId" UUID;

DROP INDEX IF EXISTS "Subscription_email_projectId_key";

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_releaseId_fkey"
  FOREIGN KEY ("releaseId") REFERENCES "Release"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Subscription_email_projectId_releaseId_key"
  ON "Subscription"("email", "projectId", "releaseId");

CREATE UNIQUE INDEX "Subscription_project_level_email_key"
  ON "Subscription"("email", "projectId")
  WHERE "releaseId" IS NULL;

CREATE INDEX "Subscription_releaseId_verifiedAt_unsubscribedAt_idx"
  ON "Subscription"("releaseId", "verifiedAt", "unsubscribedAt");
