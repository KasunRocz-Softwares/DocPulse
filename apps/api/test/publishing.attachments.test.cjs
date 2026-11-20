const assert = require("node:assert/strict");
const { test } = require("node:test");
const { PublishingService } = require("../src/publishing/publishing.service");

const publicAttachment = {
  id: "attachment-public",
  storageKey: "releases/r1/public.pdf",
  fileName: "guide.pdf",
  contentType: "application/pdf",
  sizeBytes: 1024n,
  checksumSha256: "a".repeat(64),
  scanStatus: "CLEAN",
  publicAllowed: true,
};

test("approval revision freezes only public, clean attachment metadata", async () => {
  let revisionData;
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
        project: { branding: null },
        changes: [
          {
            title: "Feature",
            category: "FEATURE",
            visibility: "PUBLIC_CANDIDATE",
            publicDescription: "A feature",
            sortOrder: 0,
          },
        ],
        attachments: [
          publicAttachment,
          { ...publicAttachment, id: "private", publicAllowed: false },
          { ...publicAttachment, id: "pending", scanStatus: "PENDING" },
        ].filter(
          (attachment) =>
            attachment.publicAllowed && attachment.scanStatus === "CLEAN",
        ),
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

  assert.deepEqual(revisionData.content.attachments, [
    {
      sourceAttachmentId: publicAttachment.id,
      fileName: publicAttachment.fileName,
      contentType: publicAttachment.contentType,
      sizeBytes: "1024",
      checksumSha256: publicAttachment.checksumSha256,
    },
  ]);
});

test("publication freezes scanned attachment storage metadata into the public snapshot", async () => {
  let publicationData;
  let attachmentQuery;
  const frozen = {
    sourceAttachmentId: publicAttachment.id,
    fileName: publicAttachment.fileName,
    contentType: publicAttachment.contentType,
    sizeBytes: "1024",
    checksumSha256: publicAttachment.checksumSha256,
  };
  const service = new PublishingService({
    approvalRevision: {
      findFirst: async () => ({
        id: "revision-1",
        releaseId: "release-1",
        revision: 1,
        status: "APPROVED",
        contentHash: "hash",
        content: {
          version: "1.2.0",
          title: "Release",
          summary: null,
          changes: [],
          attachments: [frozen],
        },
        release: {
          projectId: "project-1",
          project: { slug: "example", name: "Example" },
        },
        decisions: [{ id: "decision-1" }],
      }),
    },
    $transaction: async (work) =>
      work({
        releaseAttachment: {
          findMany: async (query) => {
            attachmentQuery = query;
            return [publicAttachment];
          },
        },
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

  assert.deepEqual(attachmentQuery.where, {
    releaseId: "release-1",
    id: { in: [publicAttachment.id] },
    scanStatus: "CLEAN",
    publicAllowed: true,
  });
  assert.deepEqual(publicationData.snapshot.create.attachments.create, [
    {
      sourceAttachmentId: publicAttachment.id,
      storageKey: publicAttachment.storageKey,
      fileName: publicAttachment.fileName,
      contentType: publicAttachment.contentType,
      sizeBytes: 1024n,
      checksumSha256: publicAttachment.checksumSha256,
    },
  ]);
});
