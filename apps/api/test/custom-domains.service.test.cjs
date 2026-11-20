const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { test } = require("node:test");
const { ConflictException } = require("@nestjs/common");
const {
  CustomDomainsService,
} = require("../src/projects/custom-domains.service");

const admin = { id: "admin-1", isSystemAdmin: false };
const hash = (value) => createHash("sha256").update(value).digest("hex");

test("domain verification request normalizes the host and stores only a hashed expiring TXT challenge", async () => {
  let stored;
  let audit;
  const service = new CustomDomainsService({
    projectMember: { findFirst: async () => ({ role: "ADMIN" }) },
    $transaction: async (work) =>
      work({
        projectBrand: {
          findUnique: async () => null,
          upsert: async ({ create, update }) => {
            stored = create ?? update;
            return { id: "brand-1", ...stored };
          },
        },
        auditLog: {
          create: async ({ data }) => {
            audit = data;
          },
        },
      }),
  });

  const result = await service.requestVerification(
    admin,
    "project-1",
    " HTTPS://Docs.Example.com/path ",
  );
  const verification = stored.settings.customDomainVerification;

  assert.equal(result.domain, "docs.example.com");
  assert.equal(result.txtRecord.name, "_rdps-verification.docs.example.com");
  const challenge = result.txtRecord.value.slice("rdps-verification=".length);
  assert.equal(result.txtRecord.value, `rdps-verification=${challenge}`);
  assert.equal(verification.tokenHash, hash(challenge));
  assert.equal(JSON.stringify(stored).includes(challenge), false);
  assert.equal(JSON.stringify(audit).includes(challenge), false);
  assert.equal(audit.metadata.domain, "docs.example.com");
  assert.equal(
    new Date(verification.expiresAt).getTime() - Date.now() >
      23 * 60 * 60 * 1000,
    true,
  );
});

test("verification succeeds only when the live DNS TXT value matches the active challenge", async () => {
  const challenge = "dns-proof-secret";
  const settings = {
    customDomainVerification: {
      tokenHash: hash(challenge),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  };
  let update;
  let audit;
  const prisma = {
    projectMember: { findFirst: async () => ({ role: "ADMIN" }) },
    projectBrand: {
      findUnique: async () => ({
        id: "brand-1",
        projectId: "project-1",
        customDomain: "docs.example.com",
        settings,
      }),
    },
    $transaction: async (work) =>
      work({
        projectBrand: {
          findUnique: async () => ({
            id: "brand-1",
            projectId: "project-1",
            customDomain: "docs.example.com",
            settings,
          }),
          update: async ({ data }) => {
            update = data;
            return { customDomain: "docs.example.com", ...data };
          },
        },
        auditLog: {
          create: async ({ data }) => {
            audit = data;
          },
        },
      }),
  };
  const service = new CustomDomainsService(prisma, async (name) => {
    assert.equal(name, "_rdps-verification.docs.example.com");
    return [["rdps-verification=", challenge]];
  });

  const result = await service.verify(admin, "project-1");

  assert.equal(result.verified, true);
  assert.equal(update.settings.customDomainVerifiedAt, result.verifiedAt);
  assert.equal(update.settings.customDomainVerification, undefined);
  assert.equal(audit.action, "project.custom_domain_verified");
});

test("expired or mismatched TXT challenges cannot mark a project domain verified", async () => {
  const expiredSettings = {
    customDomainVerification: {
      tokenHash: hash("expired"),
      expiresAt: new Date(Date.now() - 1).toISOString(),
    },
  };
  let transactionCalled = false;
  let dnsCalled = false;
  const service = new CustomDomainsService(
    {
      projectMember: { findFirst: async () => ({ role: "ADMIN" }) },
      projectBrand: {
        findUnique: async () => ({
          id: "brand-1",
          projectId: "project-1",
          customDomain: "docs.example.com",
          settings: expiredSettings,
        }),
      },
      $transaction: async () => {
        transactionCalled = true;
      },
    },
    async () => {
      dnsCalled = true;
      return [];
    },
  );

  await assert.rejects(service.verify(admin, "project-1"), ConflictException);
  assert.equal(dnsCalled, false);
  assert.equal(transactionCalled, false);
});

test("a wrong DNS TXT value cannot mark a domain verified", async () => {
  const settings = {
    customDomainVerification: {
      tokenHash: hash("expected"),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  };
  let transactionCalled = false;
  const service = new CustomDomainsService(
    {
      projectMember: { findFirst: async () => ({ role: "ADMIN" }) },
      projectBrand: {
        findUnique: async () => ({
          id: "brand-1",
          projectId: "project-1",
          customDomain: "docs.example.com",
          settings,
        }),
      },
      $transaction: async () => {
        transactionCalled = true;
      },
    },
    async () => [["rdps-verification=wrong-token"]],
  );

  await assert.rejects(service.verify(admin, "project-1"), ConflictException);
  assert.equal(transactionCalled, false);
});

test("rejects IP addresses, localhost, and malformed domains before writing state", async () => {
  let transactionCalled = false;
  const service = new CustomDomainsService({
    projectMember: { findFirst: async () => ({ role: "ADMIN" }) },
    $transaction: async () => {
      transactionCalled = true;
    },
  });

  for (const domain of [
    "localhost",
    "127.0.0.1",
    "bad..example.com",
    "https://user:pass@example.com",
  ]) {
    await assert.rejects(
      service.requestVerification(admin, "project-1", domain),
      ConflictException,
    );
  }
  assert.equal(transactionCalled, false);
});

test("custom domain administration is restricted to project administrators", async () => {
  let transactionCalled = false;
  const service = new CustomDomainsService({
    projectMember: { findFirst: async () => ({ role: "DEVELOPER" }) },
    $transaction: async () => {
      transactionCalled = true;
    },
  });

  await assert.rejects(
    service.requestVerification(
      { id: "dev-1", isSystemAdmin: false },
      "project-1",
      "docs.example.com",
    ),
    (error) => error.status === 403,
  );
  assert.equal(transactionCalled, false);
});
