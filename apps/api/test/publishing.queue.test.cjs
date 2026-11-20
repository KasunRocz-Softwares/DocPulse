const assert = require("node:assert/strict");
const { test } = require("node:test");
const { UnprocessableEntityException } = require("@nestjs/common");
const { PublishingService } = require("../src/publishing/publishing.service");

test("review queue is scoped to approver projects and excludes the current author", async () => {
  let membershipQuery;
  let revisionQuery;
  const expected = [{ id: "revision-1", submittedById: "other-user" }];
  const service = new PublishingService({
    projectMember: {
      findMany: async (query) => {
        membershipQuery = query;
        return [{ projectId: "project-1" }];
      },
    },
    approvalRevision: {
      findMany: async (query) => {
        revisionQuery = query;
        return expected;
      },
    },
  });

  const result = await service.listReviewQueue({
    id: "reviewer-1",
    isSystemAdmin: false,
  });

  assert.equal(result, expected);
  assert.deepEqual(membershipQuery.where, {
    userId: "reviewer-1",
    role: { in: ["ADMIN", "RELEASE_MANAGER", "REVIEWER"] },
  });
  assert.equal(revisionQuery.where.status, "PENDING");
  assert.equal(revisionQuery.where.submittedById.not, "reviewer-1");
  assert.deepEqual(revisionQuery.where.release.projectId.in, ["project-1"]);
});

test("review queue for a non-member is empty without an unscoped revision query", async () => {
  let revisionQuery;
  const service = new PublishingService({
    projectMember: { findMany: async () => [] },
    approvalRevision: {
      findMany: async (query) => {
        revisionQuery = query;
        return [];
      },
    },
  });

  assert.deepEqual(
    await service.listReviewQueue({ id: "outsider", isSystemAdmin: false }),
    [],
  );
  assert.deepEqual(revisionQuery.where.release.projectId.in, []);
});

test("approval uses a pending-state compare-and-swap before recording the decision", async () => {
  let transitionQuery;
  let decisionCreated = false;
  const service = new PublishingService({
    approvalRevision: {
      findFirst: async () => ({
        id: "revision-1",
        releaseId: "release-1",
        status: "PENDING",
        submittedById: "author-1",
        decisions: [],
        release: { projectId: "project-1" },
      }),
    },
    projectMember: {
      findUnique: async () => ({ role: "REVIEWER" }),
    },
    $transaction: async (work) =>
      work({
        approvalRevision: {
          updateMany: async (query) => {
            transitionQuery = query;
            return { count: 1 };
          },
        },
        approvalDecision: {
          create: async ({ data }) => {
            decisionCreated = true;
            return data;
          },
        },
        auditLog: { create: async () => undefined },
      }),
  });

  await service.decide(
    { id: "reviewer-1", isSystemAdmin: false },
    "release-1",
    "revision-1",
    true,
    "Looks good",
  );

  assert.deepEqual(transitionQuery.where, {
    id: "revision-1",
    releaseId: "release-1",
    status: "PENDING",
  });
  assert.equal(decisionCreated, true);
});

test("a concurrent reviewer cannot record a second decision after the revision transition", async () => {
  let decisionCreated = false;
  const service = new PublishingService({
    approvalRevision: {
      findFirst: async () => ({
        id: "revision-1",
        releaseId: "release-1",
        status: "PENDING",
        submittedById: "author-1",
        decisions: [],
        release: { projectId: "project-1" },
      }),
    },
    projectMember: { findUnique: async () => ({ role: "REVIEWER" }) },
    $transaction: async (work) =>
      work({
        approvalRevision: { updateMany: async () => ({ count: 0 }) },
        approvalDecision: {
          create: async () => {
            decisionCreated = true;
          },
        },
        auditLog: { create: async () => undefined },
      }),
  });

  await assert.rejects(
    service.decide(
      { id: "reviewer-1", isSystemAdmin: false },
      "release-1",
      "revision-1",
      true,
    ),
    (error) => error instanceof UnprocessableEntityException,
  );
  assert.equal(decisionCreated, false);
});
