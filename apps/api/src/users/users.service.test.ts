import * as assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { AuthService } from "../auth/auth.service";
import { UsersService } from "./users.service";

const admin = { id: "admin-1", isSystemAdmin: true };

type FakeUser = {
  id: string;
  email: string;
  displayName: string;
  status: "ACTIVE" | "INVITED" | "SUSPENDED";
  isSystemAdmin: boolean;
  passwordHash: string | null;
  identities: Array<{ id: string }>;
};

function fakePrisma(users: FakeUser[], otherActiveAdmins = 1) {
  const calls = {
    userUpdates: [] as unknown[],
    sessionRevocations: 0,
    resetRevocations: 0,
    resetsCreated: [] as Array<{ tokenHash: string; expiresAt: Date }>,
    audits: [] as string[],
  };
  const tx = {
    user: {
      count: async () => otherActiveAdmins,
      update: async ({ data }: { data: unknown }) => {
        calls.userUpdates.push(data);
        return {};
      },
    },
    userSession: {
      updateMany: async () => {
        calls.sessionRevocations += 1;
        return { count: 2 };
      },
    },
    passwordResetToken: {
      updateMany: async () => {
        calls.resetRevocations += 1;
        return { count: 1 };
      },
      create: async ({
        data,
      }: {
        data: { tokenHash: string; expiresAt: Date };
      }) => {
        calls.resetsCreated.push(data);
        return { id: "reset-1" };
      },
    },
    auditLog: {
      create: async ({ data }: { data: { action: string } }) => {
        calls.audits.push(data.action);
        return {};
      },
    },
  };
  const prisma = {
    ...tx,
    user: {
      ...tx.user,
      findUnique: async ({ where }: { where: { id: string } }) =>
        users.find((user) => user.id === where.id) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) =>
        users.find((user) => user.id === where.id),
    },
    $transaction: async (work: (client: typeof tx) => Promise<unknown>) =>
      work(tx),
  };
  return { prisma, calls };
}

const user = (overrides: Partial<FakeUser> = {}): FakeUser => ({
  id: "user-2",
  email: "dev@example.test",
  displayName: "Dev",
  status: "ACTIVE",
  isSystemAdmin: false,
  passwordHash: "hash",
  identities: [],
  ...overrides,
});

test("only system administrators can manage users", async () => {
  const service = new UsersService(fakePrisma([user()]).prisma as never);
  const member = { id: "user-9", isSystemAdmin: false };
  await assert.rejects(service.list(member), /System administrator/);
  await assert.rejects(
    service.update(member, "user-2", { status: "SUSPENDED" }),
    /System administrator/,
  );
  await assert.rejects(
    service.issuePasswordLink(member, "user-2"),
    /System administrator/,
  );
});

test("admins cannot suspend or demote themselves", async () => {
  const self = user({ id: admin.id, isSystemAdmin: true });
  const service = new UsersService(fakePrisma([self]).prisma as never);
  await assert.rejects(
    service.update(admin, admin.id, { status: "SUSPENDED" }),
    /your own status/,
  );
  await assert.rejects(
    service.update(admin, admin.id, { isSystemAdmin: false }),
    /your own system administrator/,
  );
});

test("the last active system administrator cannot be removed", async () => {
  const otherAdmin = user({ isSystemAdmin: true });
  const { prisma, calls } = fakePrisma([otherAdmin], 0);
  const service = new UsersService(prisma as never);
  await assert.rejects(
    service.update(admin, "user-2", { isSystemAdmin: false }),
    /At least one active system administrator/,
  );
  await assert.rejects(
    service.update(admin, "user-2", { status: "SUSPENDED" }),
    /At least one active system administrator/,
  );
  assert.equal(calls.userUpdates.length, 0);
});

test("suspending a user signs them out and cancels password links", async () => {
  const { prisma, calls } = fakePrisma([user()]);
  await new UsersService(prisma as never).update(admin, "user-2", {
    status: "SUSPENDED",
  });
  assert.deepEqual(calls.userUpdates, [{ status: "SUSPENDED" }]);
  assert.equal(calls.sessionRevocations, 1);
  assert.equal(calls.resetRevocations, 1);
  assert.deepEqual(calls.audits, ["user.updated"]);
});

test("an invited user without a password cannot be activated directly", async () => {
  const invited = user({ status: "INVITED", passwordHash: null });
  const service = new UsersService(fakePrisma([invited]).prisma as never);
  await assert.rejects(
    service.update(admin, "user-2", { status: "ACTIVE" }),
    /password link/,
  );
});

test("password links store only a hash, expire in 24h, and replace older links", async () => {
  const { prisma, calls } = fakePrisma([user({ status: "INVITED" })]);
  const before = Date.now();
  const { token, expiresAt } = await new UsersService(
    prisma as never,
  ).issuePasswordLink(admin, "user-2");
  assert.ok(token.length >= 40);
  assert.equal(calls.resetRevocations, 1);
  assert.equal(
    calls.resetsCreated[0]?.tokenHash,
    createHash("sha256").update(token).digest("hex"),
  );
  assert.notEqual(calls.resetsCreated[0]?.tokenHash, token);
  const ttl = expiresAt.getTime() - before;
  assert.ok(ttl > 23.9 * 3600_000 && ttl <= 24 * 3600_000 + 1000);
  assert.deepEqual(calls.audits, ["user.password_link_issued"]);
});

test("suspended users cannot receive a password link", async () => {
  const service = new UsersService(
    fakePrisma([user({ status: "SUSPENDED" })]).prisma as never,
  );
  await assert.rejects(
    service.issuePasswordLink(admin, "user-2"),
    /Reactivate this user/,
  );
});

function resetPrisma(reset: {
  usedAt?: Date | null;
  revokedAt?: Date | null;
  expiresAt?: Date;
  status?: string;
}) {
  const state = {
    claimed: 0,
    userData: null as unknown,
    revokedSessions: 0,
    invitationsCompleted: 0,
    audits: [] as string[],
  };
  const tx = {
    passwordResetToken: {
      updateMany: async () => {
        state.claimed += 1;
        return { count: state.claimed === 1 ? 1 : 0 };
      },
    },
    user: {
      updateMany: async ({ data }: { data: unknown }) => {
        state.userData = data;
        return { count: 1 };
      },
    },
    userSession: {
      updateMany: async () => {
        state.revokedSessions += 1;
        return { count: 1 };
      },
      create: async () => ({ id: "session-new" }),
    },
    projectInvitation: {
      updateMany: async () => {
        state.invitationsCompleted += 1;
        return { count: 1 };
      },
    },
    auditLog: {
      create: async ({ data }: { data: { action: string } }) => {
        state.audits.push(data.action);
        return {};
      },
    },
  };
  const prisma = {
    passwordResetToken: {
      findUnique: async () => ({
        id: "reset-1",
        usedAt: reset.usedAt ?? null,
        revokedAt: reset.revokedAt ?? null,
        expiresAt: reset.expiresAt ?? new Date(Date.now() + 60_000),
        user: {
          id: "user-2",
          email: "dev@example.test",
          displayName: "Dev",
          status: reset.status ?? "INVITED",
          isSystemAdmin: false,
        },
      }),
    },
    $transaction: async (work: (client: typeof tx) => Promise<unknown>) =>
      work(tx),
  };
  const passwords = {
    hashPassword: async (value: string) => `hashed:${value}`,
    verifyPassword: async () => true,
  };
  const jwt = { sign: () => "access-token" };
  return {
    service: new AuthService(prisma as never, jwt as never, passwords),
    state,
  };
}

test("a password link sets the password, activates, and signs in once", async () => {
  const { service, state } = resetPrisma({});
  const result = await service.completePasswordReset(
    "t".repeat(43),
    "a-new-long-password",
  );
  assert.equal(result.accessToken, "access-token");
  assert.equal(result.user.status, "ACTIVE");
  assert.deepEqual(state.userData, {
    passwordHash: "hashed:a-new-long-password",
    status: "ACTIVE",
  });
  assert.equal(state.revokedSessions, 1);
  assert.equal(state.invitationsCompleted, 1);
  assert.deepEqual(state.audits, [
    "identity.password.reset",
    "identity.session.created",
  ]);
  await assert.rejects(
    service.completePasswordReset("t".repeat(43), "another-long-password"),
    /invalid or expired/,
  );
});

test("used, revoked, expired, or suspended password links are rejected", async () => {
  for (const reset of [
    { usedAt: new Date() },
    { revokedAt: new Date() },
    { expiresAt: new Date(Date.now() - 1000) },
    { status: "SUSPENDED" },
  ]) {
    const { service } = resetPrisma(reset);
    await assert.rejects(
      service.completePasswordReset("t".repeat(43), "a-new-long-password"),
      /invalid or expired/,
    );
  }
});
