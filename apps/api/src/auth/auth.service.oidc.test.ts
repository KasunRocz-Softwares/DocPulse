import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, test } from "node:test";
import { UserStatus } from "../generated/prisma/enums";
import { AuthService } from "./auth.service";

const previousAutoProvision = process.env.OIDC_AUTO_PROVISION;
after(() => {
  if (previousAutoProvision === undefined)
    delete process.env.OIDC_AUTO_PROVISION;
  else process.env.OIDC_AUTO_PROVISION = previousAutoProvision;
});

const externalIdentity = {
  issuer: "https://identity.example.test/",
  subject: "subject-456",
  email: "person@example.test",
  displayName: "Example User",
};

function fixture(
  options: {
    linkedUser?: Record<string, unknown> | null;
    matchingEmail?: boolean | null;
  } = {},
) {
  const calls: Array<{ model: string; args: unknown }> = [];
  let createdUser: Record<string, unknown> | null = null;
  const tx = {
    user: {
      async create(args: { data: Record<string, unknown> }) {
        calls.push({ model: "user.create", args });
        createdUser = {
          id: "new-user-id",
          email: args.data.email,
          displayName: args.data.displayName,
          status: UserStatus.ACTIVE,
          isSystemAdmin: false,
        };
        return createdUser;
      },
    },
    identity: {
      async create(args: unknown) {
        calls.push({ model: "identity.create", args });
      },
    },
    auditLog: {
      async create(args: unknown) {
        calls.push({ model: "auditLog.create", args });
      },
    },
    userSession: {
      async create(args: unknown) {
        calls.push({ model: "userSession.create", args });
        return { id: "session-id" };
      },
    },
  };
  const prisma = {
    identity: {
      async findUnique(args: unknown) {
        calls.push({ model: "identity.findUnique", args });
        return options.linkedUser ? { user: options.linkedUser } : null;
      },
    },
    user: {
      async findUnique(args: unknown) {
        calls.push({ model: "user.findUnique", args });
        return options.matchingEmail ? { id: "email-match" } : null;
      },
    },
    async $transaction<T>(work: (client: typeof tx) => Promise<T>) {
      return work(tx);
    },
  };
  const jwt = { sign: () => "access-token" };
  const service = new AuthService(prisma as never, jwt as never);
  return { service, calls, getCreatedUser: () => createdUser };
}

test("matches external identities only by exact issuer and subject", async () => {
  process.env.OIDC_AUTO_PROVISION = "false";
  const user = {
    id: "user-id",
    email: externalIdentity.email,
    displayName: "Local Name",
    status: UserStatus.ACTIVE,
    isSystemAdmin: false,
  };
  const f = fixture({ linkedUser: user });
  const result = await f.service.loginWithOidc(externalIdentity);
  const lookup = f.calls.find((call) => call.model === "identity.findUnique")!
    .args as {
    where: {
      provider_providerSubject: { provider: string; providerSubject: string };
    };
  };
  assert.deepEqual(lookup.where.provider_providerSubject, {
    provider: "oidc",
    providerSubject: createHash("sha256")
      .update(externalIdentity.issuer)
      .update("\0")
      .update(externalIdentity.subject)
      .digest("hex"),
  });
  assert.equal(result.user.id, "user-id");
  assert.equal(
    f.calls.filter((call) => call.model === "userSession.create").length,
    1,
  );
});

test("refuses matching email without linking the external identity", async () => {
  process.env.OIDC_AUTO_PROVISION = "true";
  const f = fixture({ matchingEmail: true });
  await assert.rejects(f.service.loginWithOidc(externalIdentity), /not linked/);
  assert.equal(
    f.calls.some((call) => call.model === "identity.create"),
    false,
  );
});

test("does not provision an unknown OIDC account by default", async () => {
  delete process.env.OIDC_AUTO_PROVISION;
  const f = fixture();
  await assert.rejects(
    f.service.loginWithOidc(externalIdentity),
    /provisioning is disabled/,
  );
  assert.equal(
    f.calls.some((call) => call.model === "user.create"),
    false,
  );
});

test("provisions an active account and issuer-subject identity only when enabled", async () => {
  process.env.OIDC_AUTO_PROVISION = "true";
  const f = fixture();
  const result = await f.service.loginWithOidc(externalIdentity, {
    ipAddress: "127.0.0.1",
  });
  assert.equal(result.user.id, "new-user-id");
  const identityCreate = f.calls.find(
    (call) => call.model === "identity.create",
  )!.args as {
    data: { provider: string; providerSubject: string; userId: string };
  };
  assert.deepEqual(identityCreate.data, {
    provider: "oidc",
    providerSubject: createHash("sha256")
      .update(externalIdentity.issuer)
      .update("\0")
      .update(externalIdentity.subject)
      .digest("hex"),
    userId: "new-user-id",
  });
  assert.equal(
    f.calls.some((call) => call.model === "userSession.create"),
    true,
  );
});

test("rejects an inactive account even when its OIDC identity is linked", async () => {
  process.env.OIDC_AUTO_PROVISION = "true";
  const f = fixture({
    linkedUser: {
      id: "inactive-user",
      email: externalIdentity.email,
      displayName: "Inactive",
      status: UserStatus.SUSPENDED,
      isSystemAdmin: false,
    },
  });
  await assert.rejects(f.service.loginWithOidc(externalIdentity), /inactive/);
  assert.equal(
    f.calls.some((call) => call.model === "userSession.create"),
    false,
  );
});

function linkFixture(
  options: {
    email?: string;
    status?: UserStatus;
    existingUserId?: string;
  } = {},
) {
  const calls: Array<{ model: string; args?: unknown }> = [];
  const tx = {
    user: {
      async findUnique() {
        return {
          id: "rdps-user-id",
          email: options.email ?? externalIdentity.email,
          status: options.status ?? UserStatus.ACTIVE,
        };
      },
    },
    identity: {
      async findUnique(args: unknown) {
        calls.push({ model: "identity.findUnique", args });
        return options.existingUserId
          ? { userId: options.existingUserId }
          : null;
      },
      async create(args: unknown) {
        calls.push({ model: "identity.create", args });
        return { id: "identity-id" };
      },
    },
    auditLog: {
      async create(args: unknown) {
        calls.push({ model: "auditLog.create", args });
      },
    },
  };
  const prisma = {
    async $transaction<T>(work: (client: typeof tx) => Promise<T>) {
      return work(tx);
    },
  };
  return {
    service: new AuthService(prisma as never, { sign: () => "token" } as never),
    calls,
  };
}

test("links an identity only after authenticated, verified-email confirmation", async () => {
  const f = linkFixture();
  assert.deepEqual(
    await f.service.linkOidcIdentity(externalIdentity, "rdps-user-id"),
    { linked: true, alreadyLinked: false },
  );
  assert.equal(
    f.calls.some((call) => call.model === "identity.create"),
    true,
  );
  assert.equal(
    f.calls.some((call) => call.model === "auditLog.create"),
    true,
  );
});

test("rejects linking when the verified provider email differs from the RDPS account", async () => {
  const f = linkFixture({ email: "different@example.test" });
  await assert.rejects(
    f.service.linkOidcIdentity(externalIdentity, "rdps-user-id"),
    /must match/,
  );
  assert.equal(
    f.calls.some((call) => call.model === "identity.create"),
    false,
  );
});

test("rejects linking an organization identity already attached to another user", async () => {
  const f = linkFixture({ existingUserId: "another-user-id" });
  await assert.rejects(
    f.service.linkOidcIdentity(externalIdentity, "rdps-user-id"),
    /already linked/,
  );
  assert.equal(
    f.calls.some((call) => call.model === "identity.create"),
    false,
  );
});

test("rejects linking to a suspended RDPS account", async () => {
  const f = linkFixture({ status: UserStatus.SUSPENDED });
  await assert.rejects(
    f.service.linkOidcIdentity(externalIdentity, "rdps-user-id"),
    /inactive/,
  );
  assert.equal(
    f.calls.some((call) => call.model === "identity.create"),
    false,
  );
});
