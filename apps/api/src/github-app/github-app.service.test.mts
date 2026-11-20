import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { GitHubAppService } from "./github-app.service.js";

test("installation state is hashed, project-admin scoped, and single-use", async () => {
  const stateRows = new Map<string, any>();
  const audit: unknown[] = [];
  const prisma: any = {
    user: {
      findUnique: async () => ({ status: "ACTIVE", isSystemAdmin: false }),
    },
    projectMember: {
      findUnique: async () => ({ role: "ADMIN" }),
    },
    gitHubAppInstallState: {
      deleteMany: async () => ({}),
      create: async ({ data }: any) => {
        stateRows.set(data.stateHash, data);
        return data;
      },
      findUnique: async ({ where }: any) =>
        stateRows.get(where.stateHash) ?? null,
      updateMany: async ({ where, data }: any) => {
        const row = stateRows.get(where.stateHash);
        if (!row || row.consumedAt || row.expiresAt <= new Date())
          return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    gitHubAppProjectConnection: {
      upsert: async ({ create }: any) => ({ id: "connection-1", ...create }),
    },
    auditLog: { create: async ({ data }: any) => audit.push(data) },
  };
  prisma.$transaction = async (fn: (tx: any) => unknown) => fn(prisma);
  const provider = {
    isConfigured: () => true,
    getInstallUrl: (state: string) =>
      `https://github.com/apps/test/install?state=${state}`,
    getInstallation: async (id: string) => ({
      id,
      accountLogin: "acme",
      accountType: "Organization",
    }),
    listRepositories: async () => [],
  };
  const service = new GitHubAppService(prisma, provider);
  const actor = { id: "user-1", isSystemAdmin: false };
  const started = await service.beginInstallation(actor, "project-1");
  const state = new URL(started.installUrl).searchParams.get("state")!;
  assert.equal(stateRows.has(state), false, "only the hash is persisted");
  assert.equal(stateRows.size, 1);

  const completed = await service.completeInstallation({
    state,
    installationId: "12345",
    setupAction: "install",
  });
  assert.deepEqual(completed, {
    connected: true,
    projectId: "project-1",
    installationId: "12345",
  });
  await assert.rejects(
    () => service.completeInstallation({ state, installationId: "12345" }),
    UnauthorizedException,
  );
  assert.equal(audit.length, 2);
});

test("a project non-admin cannot start an installation", async () => {
  const prisma: any = {
    projectMember: { findUnique: async () => ({ role: "DEVELOPER" }) },
  };
  const service = new GitHubAppService(prisma, {
    isConfigured: () => true,
  } as never);
  await assert.rejects(
    () =>
      service.beginInstallation({ id: "user-2", isSystemAdmin: false }, "p1"),
    ForbiddenException,
  );
});

test("linking only accepts a repository returned by the selected installation", async () => {
  let created: unknown;
  const prisma: any = {
    projectMember: { findUnique: async () => ({ role: "ADMIN" }) },
    gitHubAppProjectConnection: {
      findUnique: async () => ({
        id: "c1",
        installationId: "91",
        status: "ACTIVE",
      }),
    },
    projectRepository: {
      findFirst: async () => null,
      create: async ({ data }: any) => {
        created = data;
        return data;
      },
    },
    auditLog: { create: async () => undefined },
  };
  prisma.$transaction = async (fn: (tx: any) => unknown) => fn(prisma);
  const provider = {
    listRepositories: async () => [
      {
        id: "22",
        owner: "acme",
        name: "rdps",
        fullName: "acme/rdps",
        defaultBranch: "main",
        private: true,
        htmlUrl: "https://github.com/acme/rdps",
      },
    ],
  };
  const service = new GitHubAppService(prisma, provider as never);
  await assert.rejects(() =>
    service.linkRepository(
      { id: "admin", isSystemAdmin: false },
      "p1",
      "91",
      "23",
    ),
  );
  await service.linkRepository(
    { id: "admin", isSystemAdmin: false },
    "p1",
    "91",
    "22",
  );
  assert.equal((created as any).githubInstallationId, "91");
  assert.equal((created as any).externalId, "22");
});

test("signed lifecycle webhook deliveries are idempotent and uninstall only removes linked repositories", async () => {
  let deliveryExists = false;
  const deletedFilters: unknown[] = [];
  const audit: unknown[] = [];
  const connection = {
    id: "connection-1",
    projectId: "project-1",
    installationId: "19",
  };
  const prisma: any = {
    gitHubAppWebhookDelivery: {
      create: async () => {
        if (deliveryExists) {
          const error: any = new Error("duplicate");
          error.code = "P2002";
          throw error;
        }
        deliveryExists = true;
      },
    },
    gitHubAppProjectConnection: {
      findMany: async () => [connection],
      update: async () => undefined,
    },
    projectRepository: {
      deleteMany: async ({ where }: any) => deletedFilters.push(where),
    },
    auditLog: { create: async ({ data }: any) => audit.push(data) },
  };
  prisma.$transaction = async (fn: (tx: any) => unknown) => fn(prisma);
  const service = new GitHubAppService(prisma, {} as never);
  const event = {
    deliveryId: "delivery-1",
    payloadHash: "a".repeat(64),
    event: "installation",
    action: "deleted",
    installationId: "19",
  };
  assert.deepEqual(await service.handleWebhook(event), {
    accepted: true,
    affectedProjects: 1,
  });
  assert.deepEqual(await service.handleWebhook(event), {
    accepted: true,
    duplicate: true,
  });
  assert.equal(deletedFilters.length, 1);
  assert.equal((deletedFilters[0] as any).githubInstallationId, "19");
  assert.equal(audit.length, 1);
});
