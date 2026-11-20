CREATE INDEX "PublicReleaseSnapshot_projectSlug_audienceMode_version_publishedAt_idx"
ON "PublicReleaseSnapshot"("projectSlug", "audienceMode", "version", "publishedAt" DESC);

CREATE INDEX "PublicReleaseSnapshot_projectSlug_audienceMode_publishedAt_idx"
ON "PublicReleaseSnapshot"("projectSlug", "audienceMode", "publishedAt" DESC);
