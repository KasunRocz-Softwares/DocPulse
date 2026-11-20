ALTER TABLE "ProjectBrand"
    ALTER COLUMN "defaultLocale" TYPE VARCHAR(255);

ALTER TABLE "PublicReleaseSnapshot"
    ALTER COLUMN "locale" TYPE VARCHAR(255),
    ALTER COLUMN "defaultLocale" TYPE VARCHAR(255);

ALTER TABLE "PublicSnapshotLocale"
    ALTER COLUMN "locale" TYPE VARCHAR(255);

ALTER TABLE "ReleaseTranslation"
    ALTER COLUMN "locale" TYPE VARCHAR(255);

ALTER TABLE "Subscription"
    ALTER COLUMN "locale" TYPE VARCHAR(255);
