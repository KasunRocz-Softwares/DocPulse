const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { test } = require("node:test");
const { ConflictException, NotFoundException } = require("@nestjs/common");
const { ProjectsService } = require("../src/projects/projects.service");

test("project administrators can list members scoped to their project", async () => {
  const memberRows = [
    { projectId: "project-a", userId: "admin-1", role: "ADMIN" },
    { projectId: "project-a", userId: "dev-1", role: "DEVELOPER" },
  ];
  let memberQuery;
  const prisma = {
    projectMember: {
      findFirst: async ({ where }) =>
        where.projectId === "project-a" && where.userId === "admin-1"
          ? { role: "ADMIN" }
          : null,
      findMany: async (query) => {
        memberQuery = query;
        return memberRows;
      },
    },
  };

  const result = await new ProjectsService(prisma).listMembers(
    { id: "admin-1", isSystemAdmin: false },
    "project-a",
  );

  assert.deepEqual(result, memberRows);
  assert.deepEqual(memberQuery.where, { projectId: "project-a" });
  assert.deepEqual(memberQuery.orderBy, [
    { role: "asc" },
    { createdAt: "asc" },
  ]);
});

test("users without project admin capability cannot list project members", async () => {
  let queriedMemberRows = false;
  const prisma = {
    projectMember: {
      findFirst: async () => null,
      findMany: async () => {
        queriedMemberRows = true;
        return [];
      },
    },
  };

  await assert.rejects(
    new ProjectsService(prisma).listMembers(
      { id: "outsider", isSystemAdmin: false },
      "project-secret",
    ),
    (error) => error instanceof NotFoundException,
  );
  assert.equal(queriedMemberRows, false);
});

test("removing the final project administrator is rejected", async () => {
  let deleted = false;
  const prisma = {
    projectMember: {
      findFirst: async () => ({ role: "ADMIN" }),
    },
    $transaction: async (work) =>
      work({
        projectMember: {
          findFirst: async () => ({
            id: "membership-1",
            role: "ADMIN",
            userId: "admin-1",
          }),
          count: async () => 1,
          delete: async () => {
            deleted = true;
          },
        },
        auditLog: { create: async () => undefined },
      }),
  };

  await assert.rejects(
    new ProjectsService(prisma).removeMember(
      { id: "admin-1", isSystemAdmin: false },
      "project-a",
      "membership-1",
    ),
    (error) => error instanceof ConflictException,
  );
  assert.equal(deleted, false);
});

test("removing an invited member revokes outstanding invitation tokens transactionally", async () => {
  let invitationRevocation;
  let removed = false;
  const prisma = {
    projectMember: { findFirst: async () => ({ role: "ADMIN" }) },
    $transaction: async (work) =>
      work({
        projectMember: {
          findFirst: async () => ({
            id: "member-pending",
            role: "DEVELOPER",
            userId: "user-invited",
            user: { email: "pending@example.test" },
          }),
          count: async () => 1,
          delete: async () => {
            removed = true;
          },
        },
        projectInvitation: {
          updateMany: async (query) => {
            invitationRevocation = query;
            return { count: 1 };
          },
        },
        auditLog: { create: async () => undefined },
      }),
  };

  const result = await new ProjectsService(prisma).removeMember(
    { id: "admin-1", isSystemAdmin: false },
    "project-a",
    "member-pending",
  );

  assert.deepEqual(result, { removed: true });
  assert.equal(removed, true);
  assert.deepEqual(invitationRevocation.where, {
    projectId: "project-a",
    email: "pending@example.test",
    acceptedAt: null,
    revokedAt: null,
  });
  assert.equal(invitationRevocation.data.revokedAt instanceof Date, true);
});

test("adding a member normalizes email and records the assigned role", async () => {
  let userUpsert;
  let membershipUpsert;
  let audit;
  let invitationCreate;
  const prisma = {
    projectMember: {
      findFirst: async () => ({ role: "ADMIN" }),
    },
    $transaction: async (work) =>
      work({
        user: {
          upsert: async (query) => {
            userUpsert = query;
            return {
              id: "user-2",
              email: query.where.email,
              displayName: "dev",
              status: "INVITED",
            };
          },
        },
        projectMember: {
          upsert: async (query) => {
            membershipUpsert = query;
            return { id: "member-2", ...query.create };
          },
        },
        projectInvitation: {
          updateMany: async () => ({ count: 0 }),
          create: async ({ data }) => {
            invitationCreate = data;
            return data;
          },
        },
        auditLog: {
          create: async ({ data }) => {
            audit = data;
          },
        },
      }),
  };

  const result = await new ProjectsService(prisma).addMember(
    { id: "admin-1", isSystemAdmin: false },
    "project-a",
    { email: "  Dev@Example.com ", role: "DEVELOPER" },
  );

  assert.equal(userUpsert.where.email, "dev@example.com");
  assert.equal(userUpsert.create.displayName, "dev");
  assert.equal(membershipUpsert.create.role, "DEVELOPER");
  assert.equal(audit.action, "project.member_upserted");
  assert.equal(result.membership.id, "member-2");
  assert.equal(typeof result.invitationToken, "string");
  assert.equal(
    invitationCreate.tokenHash,
    createHash("sha256").update(result.invitationToken).digest("hex"),
  );
  assert.equal(invitationCreate.email, "dev@example.com");
  assert.equal(invitationCreate.invitedById, "admin-1");
  assert.equal(
    invitationCreate.expiresAt.getTime() - Date.now() > 6 * 24 * 60 * 60 * 1000,
    true,
  );
  assert.equal(JSON.stringify(audit).includes(result.invitationToken), false);
});

test("branding updates are admin scoped, normalized, and audited", async () => {
  let upsert;
  let audit;
  const service = new ProjectsService({
    projectMember: { findFirst: async () => ({ role: "ADMIN" }) },
    $transaction: async (work) =>
      work({
        projectBrand: {
          upsert: async (query) => {
            upsert = query;
            return { projectId: "project-a", ...query.create };
          },
        },
        auditLog: {
          create: async ({ data }) => {
            audit = data;
          },
        },
      }),
  });

  const brand = await service.updateBrand(
    { id: "admin-1", isSystemAdmin: false },
    "project-a",
    {
      primaryColor: "#ABCDEF",
      accentColor: "#123456",
      defaultLocale: "en-GB",
      logoUrl: "https://cdn.example.test/logo.svg",
    },
  );

  assert.equal(upsert.where.projectId, "project-a");
  assert.deepEqual(upsert.create, {
    projectId: "project-a",
    primaryColor: "#abcdef",
    accentColor: "#123456",
    defaultLocale: "en-GB",
    logoUrl: "https://cdn.example.test/logo.svg",
  });
  assert.equal(brand.primaryColor, "#abcdef");
  assert.equal(audit.action, "project.brand_updated");
  assert.deepEqual(audit.metadata.fields.sort(), [
    "accentColor",
    "defaultLocale",
    "logoUrl",
    "primaryColor",
  ]);
});

test("non-admins cannot update project branding", async () => {
  let transactionCalled = false;
  const service = new ProjectsService({
    projectMember: { findFirst: async () => ({ role: "DEVELOPER" }) },
    $transaction: async () => {
      transactionCalled = true;
    },
  });

  await assert.rejects(
    service.updateBrand({ id: "dev-1", isSystemAdmin: false }, "project-a", {
      primaryColor: "#abcdef",
    }),
    (error) => error.status === 403,
  );
  assert.equal(transactionCalled, false);
});
