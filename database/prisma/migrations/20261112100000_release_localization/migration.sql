CREATE TABLE "ReleaseTranslation" (
    "id" UUID NOT NULL,
    "releaseId" UUID NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "summary" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "ReleaseTranslation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReleaseTranslation_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ReleaseChangeTranslation" (
    "id" UUID NOT NULL,
    "translationId" UUID NOT NULL,
    "changeId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "ReleaseChangeTranslation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReleaseChangeTranslation_translationId_fkey" FOREIGN KEY ("translationId") REFERENCES "ReleaseTranslation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReleaseChangeTranslation_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "ReleaseChange"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "PublicSnapshotLocale" (
    "id" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "summary" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublicSnapshotLocale_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PublicSnapshotLocale_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "PublicReleaseSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "PublicSnapshotChangeLocale" (
    "id" UUID NOT NULL,
    "localeId" UUID NOT NULL,
    "snapshotChangeId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublicSnapshotChangeLocale_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PublicSnapshotChangeLocale_localeId_fkey" FOREIGN KEY ("localeId") REFERENCES "PublicSnapshotLocale"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PublicSnapshotChangeLocale_snapshotChangeId_fkey" FOREIGN KEY ("snapshotChangeId") REFERENCES "PublicSnapshotChange"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ReleaseTranslation_releaseId_locale_key" ON "ReleaseTranslation"("releaseId", "locale");
CREATE INDEX "ReleaseTranslation_releaseId_locale_idx" ON "ReleaseTranslation"("releaseId", "locale");
CREATE UNIQUE INDEX "ReleaseChangeTranslation_translationId_changeId_key" ON "ReleaseChangeTranslation"("translationId", "changeId");
CREATE INDEX "ReleaseChangeTranslation_changeId_idx" ON "ReleaseChangeTranslation"("changeId");
CREATE UNIQUE INDEX "PublicSnapshotLocale_snapshotId_locale_key" ON "PublicSnapshotLocale"("snapshotId", "locale");
CREATE INDEX "PublicSnapshotLocale_locale_snapshotId_idx" ON "PublicSnapshotLocale"("locale", "snapshotId");
CREATE UNIQUE INDEX "PublicSnapshotChangeLocale_localeId_snapshotChangeId_key" ON "PublicSnapshotChangeLocale"("localeId", "snapshotChangeId");
CREATE INDEX "PublicSnapshotChangeLocale_localeId_idx" ON "PublicSnapshotChangeLocale"("localeId");

CREATE TRIGGER "PublicSnapshotLocale_immutable"
    BEFORE UPDATE OR DELETE ON "PublicSnapshotLocale"
    FOR EACH ROW EXECUTE FUNCTION "reject_public_snapshot_mutation"();

CREATE TRIGGER "PublicSnapshotChangeLocale_immutable"
    BEFORE UPDATE OR DELETE ON "PublicSnapshotChangeLocale"
    FOR EACH ROW EXECUTE FUNCTION "reject_public_snapshot_mutation"();
