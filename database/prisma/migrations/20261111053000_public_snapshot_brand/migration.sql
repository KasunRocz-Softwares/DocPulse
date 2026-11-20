ALTER TABLE "PublicReleaseSnapshot"
    ADD COLUMN "primaryColor" VARCHAR(16) NOT NULL DEFAULT '#2457c5',
    ADD COLUMN "accentColor" VARCHAR(16),
    ADD COLUMN "logoUrl" TEXT,
    ADD COLUMN "defaultLocale" VARCHAR(16) NOT NULL DEFAULT 'en';

ALTER TABLE "PublicReleaseSnapshot"
    ADD CONSTRAINT "PublicReleaseSnapshot_primaryColor_format_check"
        CHECK ("primaryColor" ~ '^#[0-9A-Fa-f]{6}$'),
    ADD CONSTRAINT "PublicReleaseSnapshot_accentColor_format_check"
        CHECK ("accentColor" IS NULL OR "accentColor" ~ '^#[0-9A-Fa-f]{6}$'),
    ADD CONSTRAINT "PublicReleaseSnapshot_defaultLocale_nonempty_check"
        CHECK (length("defaultLocale") > 0);

