-- CreateTable
CREATE TABLE "ProjectInvitation" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "role" "ProjectRole" NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "invitedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectInvitation_tokenHash_key" ON "ProjectInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "ProjectInvitation_projectId_email_acceptedAt_idx" ON "ProjectInvitation"("projectId", "email", "acceptedAt");

-- CreateIndex
CREATE INDEX "ProjectInvitation_expiresAt_idx" ON "ProjectInvitation"("expiresAt");

-- AddForeignKey
ALTER TABLE "ProjectInvitation" ADD CONSTRAINT "ProjectInvitation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInvitation" ADD CONSTRAINT "ProjectInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

