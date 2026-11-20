import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  ApprovalStatus,
  ReleaseAudienceMode,
  ReleaseStatus,
} from "../generated/prisma/enums";
import { approvalContentHash, PublishingService } from "./publishing.service";

const candidateRelease = {
  id: "release-1",
  projectId: "project-1",
  status: ReleaseStatus.REVIEW,
  version: "v2.0.0",
  title: "Northwind update",
  publicSummary: "Customer release",
  releaseDate: null,
  changes: [
    {
      id: "change-1",
      visibility: "PUBLIC_CANDIDATE",
      publicDescription: "New workflow",
      title: "Workflow",
      category: "FEATURE",
      sortOrder: 0,
    },
  ],
  attachments: [],
  translations: [
    {
      locale: "si-LK",
      title: "නව නිකුතුව",
      summary: "නව විශේෂාංග",
      changes: [{ changeId: "change-1", description: "නව වැඩපිළිවෙළ" }],
    },
  ],
  project: { branding: null },
  audienceMode: ReleaseAudienceMode.CLIENTS,
  clientAudiences: [{ audienceId: "audience-1" }],
};

test("approval revision content freezes selected client audience identifiers", async () => {
  let revisionContent: Record<string, unknown> | undefined;
  let revisionHash = "";
  const prisma = {
    release: { findUnique: async () => candidateRelease },
    projectMember: { findUnique: async () => ({ role: "ADMIN" }) },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) =>
      work({
        approvalRevision: {
          findFirst: async () => null,
          create: async ({
            data,
          }: {
            data: { content: Record<string, unknown>; contentHash: string };
          }) => {
            revisionContent = data.content;
            revisionHash = data.contentHash;
            return data;
          },
        },
        auditLog: { create: async () => ({}) },
      }),
  };

  await new PublishingService(prisma as never).submit(
    { id: "author-1", isSystemAdmin: false },
    "release-1",
  );

  assert.deepEqual(revisionContent?.audience, {
    mode: "CLIENTS",
    audienceIds: ["audience-1"],
  });
  assert.deepEqual(revisionContent?.locales, [
    {
      locale: "si-LK",
      title: "නව නිකුතුව",
      summary: "නව විශේෂාංග",
      changes: [{ sourceChangeId: "change-1", description: "නව වැඩපිළිවෙළ" }],
    },
  ]);
  assert.equal(revisionHash, approvalContentHash(revisionContent));
});

test("publication snapshot freezes the approved client audiences", async () => {
  let snapshotInput: Record<string, any> | undefined;
  const revision = {
    id: "revision-1",
    releaseId: "release-1",
    status: ApprovalStatus.APPROVED,
    contentHash: "f".repeat(64),
    content: {
      version: "v2.0.0",
      title: "Northwind update",
      summary: "Customer release",
      brand: {},
      changes: [],
      audience: { mode: "CLIENTS", audienceIds: ["audience-1", "audience-2"] },
    },
    release: {
      projectId: "project-1",
      project: { slug: "northwind-app", name: "Northwind" },
    },
    decisions: [{ status: ApprovalStatus.APPROVED }],
  };
  const prisma = {
    approvalRevision: { findFirst: async () => revision },
    projectMember: { findUnique: async () => ({ role: "ADMIN" }) },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) =>
      work({
        releaseAttachment: { findMany: async () => [] },
        releasePublication: {
          count: async () => 0,
          create: async ({ data }: { data: Record<string, any> }) => {
            snapshotInput = data.snapshot.create;
            return { id: "publication-1", snapshot: { id: "snapshot-1" } };
          },
        },
        release: { update: async () => ({}) },
        auditLog: { create: async () => ({}) },
      }),
  };

  await new PublishingService(prisma as never).publish(
    { id: "publisher-1", isSystemAdmin: false },
    "release-1",
    "revision-1",
  );

  assert.equal(snapshotInput?.audienceMode, "CLIENTS");
  assert.deepEqual(snapshotInput?.clientAudiences.createMany.data, [
    { audienceId: "audience-1" },
    { audienceId: "audience-2" },
  ]);
});

test("publishing rejects a localized approval payload whose revision hash changed", async () => {
  const revision = {
    id: "revision-1",
    releaseId: "release-1",
    status: ApprovalStatus.APPROVED,
    contentHash: "f".repeat(64),
    content: {
      version: "v2.0.0",
      title: "Release",
      summary: null,
      changes: [],
      locales: [
        { locale: "si-LK", title: "පරිවර්තනය", summary: null, changes: [] },
      ],
    },
    release: {
      projectId: "project-1",
      project: { slug: "rdps", name: "RDPS" },
    },
    decisions: [{ status: ApprovalStatus.APPROVED }],
  };
  const prisma = {
    approvalRevision: { findFirst: async () => revision },
    projectMember: { findUnique: async () => ({ role: "ADMIN" }) },
    $transaction: async () => {
      throw new Error("A changed approval hash must stop before publication");
    },
  };

  await assert.rejects(
    new PublishingService(prisma as never).publish(
      { id: "publisher-1", isSystemAdmin: false },
      "release-1",
      "revision-1",
    ),
    { message: /hash does not match/ },
  );
});

test("publishing copies the approved locale and change text into immutable snapshot locale rows in the transaction", async () => {
  const content = {
    version: "v2.0.0",
    title: "Release",
    summary: "Default summary",
    brand: { defaultLocale: "en" },
    changes: [
      {
        sourceChangeId: "change-1",
        title: "New workflow",
        category: "FEATURE",
        description: "Default description",
        sortOrder: 0,
      },
    ],
    locales: [
      {
        locale: "si-LK",
        title: "නිකුතුව",
        summary: "සාරාංශය",
        changes: [{ sourceChangeId: "change-1", description: "විස්තරය" }],
      },
    ],
  };
  const revision = {
    id: "revision-1",
    releaseId: "release-1",
    status: ApprovalStatus.APPROVED,
    contentHash: approvalContentHash(content),
    content,
    release: {
      projectId: "project-1",
      project: { slug: "rdps", name: "RDPS" },
    },
    decisions: [{ status: ApprovalStatus.APPROVED }],
  };
  const localeWrites: unknown[] = [];
  let publicationSnapshot: Record<string, any> | undefined;
  const prisma = {
    approvalRevision: { findFirst: async () => revision },
    projectMember: { findUnique: async () => ({ role: "ADMIN" }) },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) =>
      work({
        releaseAttachment: { findMany: async () => [] },
        releasePublication: {
          count: async () => 0,
          create: async ({ data }: { data: Record<string, any> }) => {
            publicationSnapshot = data.snapshot.create;
            return {
              id: "publication-1",
              snapshot: {
                id: "snapshot-1",
                changes: [
                  { id: "snapshot-change-1", sourceChangeId: "change-1" },
                ],
              },
            };
          },
        },
        publicSnapshotLocale: {
          create: async ({ data }: { data: unknown }) => {
            localeWrites.push(data);
            return data;
          },
        },
        release: { update: async () => ({}) },
        auditLog: { create: async () => ({}) },
      }),
  };

  await new PublishingService(prisma as never).publish(
    { id: "publisher-1", isSystemAdmin: false },
    "release-1",
    "revision-1",
  );

  assert.equal(publicationSnapshot?.contentHash, revision.contentHash);
  assert.deepEqual(localeWrites, [
    {
      snapshotId: "snapshot-1",
      locale: "si-LK",
      title: "නිකුතුව",
      summary: "සාරාංශය",
      changes: {
        create: [
          { snapshotChangeId: "snapshot-change-1", description: "විස්තරය" },
        ],
      },
    },
  ]);
});

test("public publication invalidates project and directory response caches after commit", async () => {
  const invalidations: string[] = [];
  const revision = {
    id: "revision-public",
    releaseId: "release-public",
    status: ApprovalStatus.APPROVED,
    contentHash: "a".repeat(64),
    content: {
      version: "1.0.0",
      title: "First release",
      summary: null,
      brand: {},
      changes: [],
      audience: { mode: ReleaseAudienceMode.PUBLIC, audienceIds: [] },
    },
    release: {
      projectId: "project-public",
      project: { slug: "public-project", name: "Public project" },
    },
    decisions: [{ status: ApprovalStatus.APPROVED }],
  };
  const prisma = {
    approvalRevision: { findFirst: async () => revision },
    projectMember: { findUnique: async () => ({ role: "ADMIN" }) },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) =>
      work({
        releaseAttachment: { findMany: async () => [] },
        releasePublication: {
          count: async () => 0,
          create: async () => ({
            id: "publication-public",
            snapshot: { id: "snapshot-public" },
          }),
        },
        release: { update: async () => ({}) },
        auditLog: { create: async () => ({}) },
      }),
  };
  const cache = {
    invalidateProject: async (slug: string) => {
      invalidations.push(slug);
    },
  };

  await new PublishingService(
    prisma as never,
    undefined,
    cache as never,
  ).publish(
    { id: "publisher-public", isSystemAdmin: false },
    "release-public",
    "revision-public",
  );

  assert.deepEqual(invalidations, ["public-project"]);
});

test("unpublishing invalidates the project cache after revocation commits", async () => {
  const invalidations: string[] = [];
  const prisma = {
    releasePublication: {
      findFirst: async () => ({
        id: "publication-1",
        revokedAt: null,
        release: {
          projectId: "project-1",
          project: { slug: "northwind-app" },
        },
      }),
    },
    projectMember: { findUnique: async () => ({ role: "ADMIN" }) },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) =>
      work({
        releasePublication: {
          update: async () => ({ id: "publication-1", revokedAt: new Date() }),
        },
        release: { update: async () => ({}) },
        auditLog: { create: async () => ({}) },
      }),
  };
  const cache = {
    invalidateProject: async (slug: string) => {
      invalidations.push(slug);
    },
  };

  await new PublishingService(
    prisma as never,
    undefined,
    cache as never,
  ).unpublish(
    { id: "publisher-1", isSystemAdmin: false },
    "release-1",
    "publication-1",
  );

  assert.deepEqual(invalidations, ["northwind-app"]);
});

test("ready-to-publish lists the newest approved, unpublished revision per release for publishers", async () => {
  let where: Record<string, unknown> | undefined;
  let memberQuery: Record<string, unknown> | undefined;
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 18, 9, minute));
  const prisma = {
    projectMember: {
      findMany: async (query: { where: Record<string, unknown> }) => {
        memberQuery = query.where;
        return [{ projectId: "project-1" }];
      },
    },
    approvalRevision: {
      findMany: async (query: { where: Record<string, unknown> }) => {
        where = query.where;
        // Ordered by release, newest revision first (as the query asks).
        return [
          {
            id: "r1-v2",
            releaseId: "release-1",
            revision: 2,
            createdAt: at(5),
          },
          {
            id: "r1-v1",
            releaseId: "release-1",
            revision: 1,
            createdAt: at(1),
          },
          {
            id: "r2-v1",
            releaseId: "release-2",
            revision: 1,
            createdAt: at(3),
          },
        ];
      },
    },
  };
  const ready = await new PublishingService(prisma as never).listReadyToPublish(
    { id: "manager-1", isSystemAdmin: false },
  );

  assert.deepEqual(
    ready.map((revision) => revision.id),
    ["r2-v1", "r1-v2"],
  );
  assert.deepEqual(memberQuery, {
    userId: "manager-1",
    role: { in: ["ADMIN", "RELEASE_MANAGER"] },
  });
  assert.equal(where?.status, ApprovalStatus.APPROVED);
  assert.deepEqual(where?.publication, { is: null });
  assert.deepEqual(where?.release, {
    status: { not: ReleaseStatus.ARCHIVED },
    projectId: { in: ["project-1"] },
  });
});
