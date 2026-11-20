-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('ADMIN', 'RELEASE_MANAGER', 'DEVELOPER', 'REVIEWER', 'CLIENT');

-- CreateEnum
CREATE TYPE "ReleaseType" AS ENUM ('MAJOR', 'MINOR', 'PATCH', 'HOTFIX');

-- CreateEnum
CREATE TYPE "ReleaseChannel" AS ENUM ('ALPHA', 'BETA', 'RC', 'STABLE');

-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED', 'REJECTED', 'UNPUBLISHED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ChangeCategory" AS ENUM ('FEATURE', 'IMPROVEMENT', 'FIX', 'BREAKING_CHANGE', 'SECURITY', 'PERFORMANCE', 'DEPRECATION', 'OTHER');

-- CreateEnum
CREATE TYPE "ChangeVisibility" AS ENUM ('INTERNAL_ONLY', 'PUBLIC_CANDIDATE');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "EnvironmentName" AS ENUM ('DEVELOPMENT', 'QA', 'STAGING', 'BETA', 'ENTERPRISE', 'CANARY', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "displayName" VARCHAR(160) NOT NULL,
    "passwordHash" VARCHAR(255),
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "isSystemAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Identity" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" VARCHAR(80) NOT NULL,
    "providerSubject" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "description" TEXT,
    "logoUrl" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "ProjectRole" NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectRepository" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL DEFAULT 'github',
    "owner" VARCHAR(120) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "externalId" VARCHAR(160),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectRepository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectEnvironment" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" "EnvironmentName" NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProjectEnvironment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectBrand" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "primaryColor" VARCHAR(16) NOT NULL DEFAULT '#2457C5',
    "accentColor" VARCHAR(16),
    "logoUrl" TEXT,
    "customDomain" VARCHAR(255),
    "defaultLocale" VARCHAR(16) NOT NULL DEFAULT 'en',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ProjectBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Release" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "version" VARCHAR(64) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "type" "ReleaseType" NOT NULL,
    "channel" "ReleaseChannel" NOT NULL DEFAULT 'STABLE',
    "status" "ReleaseStatus" NOT NULL DEFAULT 'DRAFT',
    "releaseDate" TIMESTAMPTZ(6),
    "internalSummary" TEXT,
    "publicSummary" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseChange" (
    "id" UUID NOT NULL,
    "releaseId" UUID NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "category" "ChangeCategory" NOT NULL,
    "internalDescription" TEXT NOT NULL,
    "publicDescription" TEXT,
    "visibility" "ChangeVisibility" NOT NULL DEFAULT 'INTERNAL_ONLY',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "authorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ReleaseChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseDocument" (
    "id" UUID NOT NULL,
    "releaseId" UUID NOT NULL,
    "section" VARCHAR(120) NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "content" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ReleaseDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseAttachment" (
    "id" UUID NOT NULL,
    "releaseId" UUID NOT NULL,
    "storageKey" VARCHAR(512) NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "contentType" VARCHAR(160) NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "checksumSha256" VARCHAR(64) NOT NULL,
    "scanStatus" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "publicAllowed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRevision" (
    "id" UUID NOT NULL,
    "releaseId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "contentHash" VARCHAR(64) NOT NULL,
    "content" JSONB NOT NULL,
    "submittedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalDecision" (
    "id" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "status" "ApprovalStatus" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleasePublication" (
    "id" UUID NOT NULL,
    "releaseId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "publishedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(6),

    CONSTRAINT "ReleasePublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicReleaseSnapshot" (
    "id" UUID NOT NULL,
    "publicationId" UUID NOT NULL,
    "projectSlug" VARCHAR(80) NOT NULL,
    "projectName" VARCHAR(160) NOT NULL,
    "version" VARCHAR(64) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "summary" TEXT,
    "locale" VARCHAR(16) NOT NULL DEFAULT 'en',
    "contentHash" VARCHAR(64) NOT NULL,
    "publishedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicReleaseSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicSnapshotChange" (
    "id" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "sourceChangeId" UUID,
    "title" VARCHAR(240) NOT NULL,
    "category" "ChangeCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PublicSnapshotChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseDeployment" (
    "id" UUID NOT NULL,
    "releaseId" UUID NOT NULL,
    "environmentId" UUID NOT NULL,
    "externalId" VARCHAR(255),
    "status" VARCHAR(40) NOT NULL,
    "deployedAt" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseDeployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitReference" (
    "id" UUID NOT NULL,
    "releaseId" UUID NOT NULL,
    "changeId" UUID,
    "repository" VARCHAR(280) NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "externalId" VARCHAR(160) NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "title" VARCHAR(500),

    CONSTRAINT "GitReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "deliveryId" VARCHAR(255) NOT NULL,
    "eventType" VARCHAR(120) NOT NULL,
    "payloadHash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(6),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "projectId" UUID NOT NULL,
    "locale" VARCHAR(16) NOT NULL DEFAULT 'en',
    "verifiedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "projectId" UUID,
    "action" VARCHAR(120) NOT NULL,
    "entityType" VARCHAR(80) NOT NULL,
    "entityId" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "requestId" VARCHAR(120),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "Identity_userId_idx" ON "Identity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Identity_provider_providerSubject_key" ON "Identity"("provider", "providerSubject");

-- CreateIndex
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");

-- CreateIndex
CREATE INDEX "Project_status_name_idx" ON "Project"("status", "name");

-- CreateIndex
CREATE INDEX "ProjectMember_userId_role_idx" ON "ProjectMember"("userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");

-- CreateIndex
CREATE INDEX "ProjectRepository_provider_externalId_idx" ON "ProjectRepository"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectRepository_projectId_provider_owner_name_key" ON "ProjectRepository"("projectId", "provider", "owner", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectEnvironment_projectId_name_key" ON "ProjectEnvironment"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectBrand_projectId_key" ON "ProjectBrand"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectBrand_customDomain_key" ON "ProjectBrand"("customDomain");

-- CreateIndex
CREATE INDEX "Release_projectId_status_releaseDate_idx" ON "Release"("projectId", "status", "releaseDate" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Release_projectId_version_channel_key" ON "Release"("projectId", "version", "channel");

-- CreateIndex
CREATE INDEX "ReleaseChange_releaseId_sortOrder_idx" ON "ReleaseChange"("releaseId", "sortOrder");

-- CreateIndex
CREATE INDEX "ReleaseChange_releaseId_category_visibility_idx" ON "ReleaseChange"("releaseId", "category", "visibility");

-- CreateIndex
CREATE INDEX "ReleaseDocument_releaseId_sortOrder_idx" ON "ReleaseDocument"("releaseId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseAttachment_storageKey_key" ON "ReleaseAttachment"("storageKey");

-- CreateIndex
CREATE INDEX "ReleaseAttachment_releaseId_scanStatus_idx" ON "ReleaseAttachment"("releaseId", "scanStatus");

-- CreateIndex
CREATE INDEX "ApprovalRevision_releaseId_status_idx" ON "ApprovalRevision"("releaseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRevision_releaseId_revision_key" ON "ApprovalRevision"("releaseId", "revision");

-- CreateIndex
CREATE INDEX "ApprovalDecision_revisionId_status_idx" ON "ApprovalDecision"("revisionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReleasePublication_revisionId_key" ON "ReleasePublication"("revisionId");

-- CreateIndex
CREATE INDEX "ReleasePublication_releaseId_revokedAt_publishedAt_idx" ON "ReleasePublication"("releaseId", "revokedAt", "publishedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ReleasePublication_releaseId_sequence_key" ON "ReleasePublication"("releaseId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "PublicReleaseSnapshot_publicationId_key" ON "PublicReleaseSnapshot"("publicationId");

-- CreateIndex
CREATE INDEX "PublicReleaseSnapshot_projectSlug_version_idx" ON "PublicReleaseSnapshot"("projectSlug", "version");

-- CreateIndex
CREATE INDEX "PublicReleaseSnapshot_projectSlug_publishedAt_idx" ON "PublicReleaseSnapshot"("projectSlug", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "PublicSnapshotChange_snapshotId_sortOrder_idx" ON "PublicSnapshotChange"("snapshotId", "sortOrder");

-- CreateIndex
CREATE INDEX "ReleaseDeployment_releaseId_deployedAt_idx" ON "ReleaseDeployment"("releaseId", "deployedAt" DESC);

-- CreateIndex
CREATE INDEX "ReleaseDeployment_environmentId_status_idx" ON "ReleaseDeployment"("environmentId", "status");

-- CreateIndex
CREATE INDEX "GitReference_releaseId_idx" ON "GitReference"("releaseId");

-- CreateIndex
CREATE UNIQUE INDEX "GitReference_repository_kind_externalId_releaseId_key" ON "GitReference"("repository", "kind", "externalId", "releaseId");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_receivedAt_idx" ON "WebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_deliveryId_key" ON "WebhookEvent"("provider", "deliveryId");

-- CreateIndex
CREATE INDEX "Subscription_projectId_verifiedAt_idx" ON "Subscription"("projectId", "verifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_email_projectId_key" ON "Subscription"("email", "projectId");

-- CreateIndex
CREATE INDEX "AuditLog_projectId_createdAt_idx" ON "AuditLog"("projectId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "Identity" ADD CONSTRAINT "Identity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRepository" ADD CONSTRAINT "ProjectRepository_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEnvironment" ADD CONSTRAINT "ProjectEnvironment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBrand" ADD CONSTRAINT "ProjectBrand_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseChange" ADD CONSTRAINT "ReleaseChange_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseChange" ADD CONSTRAINT "ReleaseChange_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseDocument" ADD CONSTRAINT "ReleaseDocument_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseAttachment" ADD CONSTRAINT "ReleaseAttachment_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRevision" ADD CONSTRAINT "ApprovalRevision_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ApprovalRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleasePublication" ADD CONSTRAINT "ReleasePublication_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleasePublication" ADD CONSTRAINT "ReleasePublication_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ApprovalRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicReleaseSnapshot" ADD CONSTRAINT "PublicReleaseSnapshot_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "ReleasePublication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicSnapshotChange" ADD CONSTRAINT "PublicSnapshotChange_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "PublicReleaseSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicSnapshotChange" ADD CONSTRAINT "PublicSnapshotChange_sourceChangeId_fkey" FOREIGN KEY ("sourceChangeId") REFERENCES "ReleaseChange"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseDeployment" ADD CONSTRAINT "ReleaseDeployment_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseDeployment" ADD CONSTRAINT "ReleaseDeployment_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "ProjectEnvironment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitReference" ADD CONSTRAINT "GitReference_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitReference" ADD CONSTRAINT "GitReference_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "ReleaseChange"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
