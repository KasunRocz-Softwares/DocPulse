const assert = require("node:assert/strict");
const { test } = require("node:test");
const { PublishingService } = require("../src/publishing/publishing.service");

test("approval revision freezes the current project brand before publication", async () => {
  let revisionData;
  const brand = {
    primaryColor: "#123abc",
    accentColor: "#fedcba",
    logoUrl: "https://cdn.example.test/logo.svg",
    defaultLocale: "fr-CA",
  };
  const service = new PublishingService({
    release: {
      findUnique: async () => ({
        id: "release-1",
        projectId: "project-1",
        status: "REVIEW",
        version: "1.2.0",
        title: "Release",
        publicSummary: null,
        releaseDate: null,
        project: { branding: brand },
        changes: [
          {
            title: "Feature",
            category: "FEATURE",
            visibility: "PUBLIC_CANDIDATE",
            publicDescription: "A feature",
            sortOrder: 0,
          },
        ],
        attachments: [],
      }),
    },
    $transaction: async (work) =>
      work({
        approvalRevision: {
          findFirst: async () => null,
          create: async ({ data }) => {
            revisionData = data;
            return { id: "revision-1", ...data };
          },
        },
        auditLog: { create: async () => undefined },
      }),
  });

  await service.submit({ id: "author-1", isSystemAdmin: true }, "release-1");

  assert.deepEqual(revisionData.content.brand, brand);
});

test("publication copies the approval revision brand into its immutable public snapshot", async () => {
  let publicationData;
  const brand = {
    primaryColor: "#123abc",
    accentColor: "#fedcba",
    logoUrl: "https://cdn.example.test/logo.svg",
    defaultLocale: "fr-CA",
  };
  const service = new PublishingService({
    approvalRevision: {
      findFirst: async () => ({
        id: "revision-1",
        releaseId: "release-1",
        revision: 2,
        status: "APPROVED",
        contentHash: "hash",
        content: {
          version: "1.2.0",
          title: "Release",
          summary: null,
          changes: [],
          brand,
        },
        release: {
          projectId: "project-1",
          project: { slug: "example", name: "Example", branding: brand },
        },
        decisions: [{ id: "decision-1" }],
      }),
    },
    $transaction: async (work) =>
      work({
        releasePublication: {
          count: async () => 0,
          create: async ({ data }) => {
            publicationData = data;
            return { id: "publication-1", ...data };
          },
        },
        release: { update: async () => undefined },
        auditLog: { create: async () => undefined },
      }),
  });

  await service.publish(
    { id: "publisher-1", isSystemAdmin: true },
    "release-1",
    "revision-1",
  );

  assert.deepEqual(publicationData.snapshot.create, {
    projectSlug: "example",
    projectName: "Example",
    version: "1.2.0",
    title: "Release",
    summary: null,
    primaryColor: "#123abc",
    accentColor: "#fedcba",
    logoUrl: "https://cdn.example.test/logo.svg",
    locale: "fr-CA",
    defaultLocale: "fr-CA",
    contentHash: "hash",
    publishedAt: publicationData.snapshot.create.publishedAt,
    changes: { create: [] },
    attachments: { create: [] },
  });
});
