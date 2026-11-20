const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { test } = require("node:test");
const { HttpException, UnauthorizedException } = require("@nestjs/common");
const { hash } = require("bcryptjs");
const { AuthService } = require("../src/auth/auth.service");
const { JwtAuthGuard } = require("../src/auth/jwt-auth.guard");

const activeUser = {
  id: "user-1",
  email: "admin@example.com",
  displayName: "Admin",
  status: "ACTIVE",
  isSystemAdmin: true,
};

test("login persists only a hashed refresh secret and binds the access token to the session", async () => {
  const passwordHash = await hash("correct horse battery staple", 4);
  let persistedSession;
  let signedClaims;
  const prisma = {
    user: { findUnique: async () => ({ ...activeUser, passwordHash }) },
    loginAttempt: {
      findUnique: async () => null,
      deleteMany: async () => ({ count: 0 }),
    },
    $transaction: async (work) =>
      work({
        userSession: {
          create: async ({ data }) => {
            persistedSession = data;
            return { id: "session-1", ...data };
          },
        },
        loginAttempt: {},
        auditLog: { create: async () => undefined },
      }),
  };
  const jwt = { sign: (claims) => ((signedClaims = claims), "access-token") };

  const result = await new AuthService(prisma, jwt).login({
    email: activeUser.email,
    password: "correct horse battery staple",
  });

  assert.equal(result.accessToken, "access-token");
  assert.equal(typeof result.refreshToken, "string");
  assert.notEqual(result.refreshToken, persistedSession.refreshTokenHash);
  assert.equal(
    persistedSession.refreshTokenHash,
    createHash("sha256").update(result.refreshToken).digest("hex"),
  );
  assert.deepEqual(signedClaims, { sub: activeUser.id, sid: "session-1" });
});

test("refresh rotates the opaque token with a compare-and-swap and returns a new access token", async () => {
  const previousRefreshToken = "previous-refresh-secret";
  const previousHash = createHash("sha256")
    .update(previousRefreshToken)
    .digest("hex");
  let updateQuery;
  let signedClaims;
  const prisma = {
    userSession: {
      findUnique: async () => ({
        id: "session-1",
        userId: activeUser.id,
        refreshTokenHash: previousHash,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: activeUser,
      }),
    },
    $transaction: async (work) =>
      work({
        userSession: {
          updateMany: async (query) => {
            updateQuery = query;
            return { count: 1 };
          },
        },
        auditLog: { create: async () => undefined },
      }),
  };
  const jwt = {
    sign: (claims) => ((signedClaims = claims), "new-access-token"),
  };

  const result = await new AuthService(prisma, jwt).refresh(
    previousRefreshToken,
  );

  assert.equal(result.accessToken, "new-access-token");
  assert.notEqual(result.refreshToken, previousRefreshToken);
  assert.equal(updateQuery.where.refreshTokenHash, previousHash);
  assert.deepEqual(signedClaims, { sub: activeUser.id, sid: "session-1" });
});

test("logout revokes only the matching active session", async () => {
  const refreshToken = "logout-refresh-secret";
  const refreshTokenHash = createHash("sha256")
    .update(refreshToken)
    .digest("hex");
  let revocationQuery;
  const prisma = {
    userSession: {
      findUnique: async () => ({
        id: "session-1",
        userId: activeUser.id,
        refreshTokenHash,
      }),
    },
    $transaction: async (work) =>
      work({
        userSession: {
          updateMany: async (query) => {
            revocationQuery = query;
            return { count: 1 };
          },
        },
        auditLog: { create: async () => undefined },
      }),
  };

  const result = await new AuthService(prisma, { sign: () => "unused" }).logout(
    refreshToken,
  );

  assert.deepEqual(result, { revoked: true });
  assert.equal(revocationQuery.where.id, "session-1");
  assert.equal(revocationQuery.where.refreshTokenHash, refreshTokenHash);
  assert.equal(revocationQuery.where.revokedAt, null);
});

test("login throttles repeated invalid credentials using a hashed identifier", async () => {
  const attempts = new Map();
  let accountQueries = 0;
  const prisma = {
    loginAttempt: {
      findUnique: async ({ where }) =>
        attempts.get(where.identifierHash) ?? null,
      deleteMany: async () => ({ count: 0 }),
    },
    user: {
      findUnique: async () => {
        accountQueries += 1;
        return null;
      },
    },
    $transaction: async (work) =>
      work({
        loginAttempt: {
          findUnique: async ({ where }) =>
            attempts.get(where.identifierHash) ?? null,
          upsert: async ({ where, create, update }) => {
            const attempt = attempts.has(where.identifierHash)
              ? { ...attempts.get(where.identifierHash), ...update }
              : create;
            attempts.set(where.identifierHash, attempt);
            return attempt;
          },
        },
      }),
  };
  const service = new AuthService(prisma, { sign: () => "unused" });

  for (let failure = 0; failure < 10; failure += 1) {
    await assert.rejects(
      service.login(
        { email: "unknown@example.com", password: "wrong password" },
        { ipAddress: "192.0.2.8" },
      ),
      (error) => error instanceof UnauthorizedException,
    );
  }
  await assert.rejects(
    service.login(
      { email: "unknown@example.com", password: "wrong password" },
      { ipAddress: "192.0.2.8" },
    ),
    (error) => error instanceof HttpException && error.getStatus() === 429,
  );

  assert.equal(accountQueries, 10);
  assert.equal(attempts.size, 2);
  assert.deepEqual(
    [...attempts.values()].map((attempt) => attempt.failureCount),
    [10, 10],
  );
  for (const identifierHash of attempts.keys()) {
    assert.match(identifierHash, /^[a-f0-9]{64}$/);
    assert.equal(identifierHash.includes("unknown@example.com"), false);
  }
});

test("login throttles IP address sprays across distinct email addresses", async () => {
  const attempts = new Map();
  let accountQueries = 0;
  const prisma = {
    loginAttempt: {
      findUnique: async ({ where }) =>
        attempts.get(where.identifierHash) ?? null,
      deleteMany: async ({ where }) => {
        for (const identifierHash of where.identifierHash.in)
          attempts.delete(identifierHash);
        return { count: where.identifierHash.in.length };
      },
    },
    user: {
      findUnique: async () => {
        accountQueries += 1;
        return null;
      },
    },
    $transaction: async (work) =>
      work({
        loginAttempt: {
          findUnique: async ({ where }) =>
            attempts.get(where.identifierHash) ?? null,
          upsert: async ({ where, create, update }) => {
            const attempt = attempts.has(where.identifierHash)
              ? { ...attempts.get(where.identifierHash), ...update }
              : create;
            attempts.set(where.identifierHash, attempt);
            return attempt;
          },
        },
      }),
  };
  const service = new AuthService(prisma, { sign: () => "unused" });

  for (let failure = 0; failure < 60; failure += 1) {
    await assert.rejects(
      service.login(
        { email: `spray-${failure}@example.com`, password: "wrong password" },
        { ipAddress: "192.0.2.44" },
      ),
      (error) => error instanceof UnauthorizedException,
    );
  }
  await assert.rejects(
    service.login(
      { email: "sixty-first@example.com", password: "wrong password" },
      { ipAddress: "192.0.2.44" },
    ),
    (error) => error instanceof HttpException && error.getStatus() === 429,
  );

  assert.equal(accountQueries, 60);
  assert.equal(attempts.size, 61);
  for (const identifierHash of attempts.keys())
    assert.match(identifierHash, /^[a-f0-9]{64}$/);
});

test("revoked sessions cannot continue using an otherwise valid access token", async () => {
  const request = { headers: { authorization: "Bearer signed-token" } };
  let userLookupCalled = false;
  const guard = new JwtAuthGuard(
    { verifyAsync: async () => ({ sub: activeUser.id, sid: "session-1" }) },
    {
      userSession: { findFirst: async () => null },
      user: {
        findUnique: async () => {
          userLookupCalled = true;
          return activeUser;
        },
      },
    },
  );
  const context = { switchToHttp: () => ({ getRequest: () => request }) };

  await assert.rejects(
    guard.canActivate(context),
    (error) => error instanceof UnauthorizedException,
  );
  assert.equal(userLookupCalled, false);
  assert.equal(request.user, undefined);
});

test("password change verifies the current password, updates the hash, and revokes other sessions", async () => {
  const oldHash = await hash("old secure password", 4);
  let updatedHash;
  let revokeQuery;
  const prisma = {
    user: {
      findUnique: async () => ({
        id: activeUser.id,
        passwordHash: oldHash,
        status: "ACTIVE",
      }),
    },
    $transaction: async (work) =>
      work({
        user: {
          update: async ({ data }) => {
            updatedHash = data.passwordHash;
          },
        },
        userSession: {
          updateMany: async (query) => {
            revokeQuery = query;
            return { count: 2 };
          },
        },
        auditLog: { create: async () => undefined },
      }),
  };
  const service = new AuthService(prisma, { sign: () => "unused" });

  await service.changePassword(
    activeUser.id,
    "session-current",
    "old secure password",
    "new secure password",
  );

  assert.equal(
    await require("bcryptjs").compare("new secure password", updatedHash),
    true,
  );
  assert.deepEqual(revokeQuery.where, {
    userId: activeUser.id,
    id: { not: "session-current" },
    revokedAt: null,
  });
});

test("password change rejects an incorrect current password without mutation", async () => {
  const oldHash = await hash("old secure password", 4);
  let transactionCalled = false;
  const service = new AuthService(
    {
      user: {
        findUnique: async () => ({
          id: activeUser.id,
          passwordHash: oldHash,
          status: "ACTIVE",
        }),
      },
      $transaction: async () => {
        transactionCalled = true;
      },
    },
    { sign: () => "unused" },
  );

  await assert.rejects(
    service.changePassword(
      activeUser.id,
      "session-current",
      "wrong password",
      "new secure password",
    ),
    (error) => error instanceof UnauthorizedException,
  );
  assert.equal(transactionCalled, false);
});

test("session listing is restricted to the user and marks the active session", async () => {
  let query;
  const service = new AuthService(
    {
      userSession: {
        findMany: async (value) => {
          query = value;
          return [
            { id: "session-current", createdAt: new Date(), revokedAt: null },
            { id: "session-other", createdAt: new Date(), revokedAt: null },
          ];
        },
      },
    },
    { sign: () => "unused" },
  );

  const result = await service.listSessions(activeUser.id, "session-current");

  assert.deepEqual(query.where, { userId: activeUser.id });
  assert.equal(result[0].current, true);
  assert.equal(result[1].current, false);
});

test("session revocation can target only a session owned by the current user and audits it", async () => {
  let lookup;
  let update;
  let audit;
  const service = new AuthService(
    {
      $transaction: async (work) =>
        work({
          userSession: {
            findFirst: async (query) => {
              lookup = query;
              return { id: "session-2" };
            },
            updateMany: async (query) => {
              update = query;
              return { count: 1 };
            },
          },
          auditLog: {
            create: async ({ data }) => {
              audit = data;
            },
          },
        }),
    },
    { sign: () => "unused" },
  );

  assert.deepEqual(await service.revokeSession(activeUser.id, "session-2"), {
    revoked: true,
  });
  assert.deepEqual(lookup.where, {
    id: "session-2",
    userId: activeUser.id,
    revokedAt: null,
  });
  assert.equal(update.where.userId, activeUser.id);
  assert.equal(audit.action, "identity.session.revoked");
});

test("invitation acceptance verifies the one-time token, activates the invited user and creates a session", async () => {
  const rawToken = "one-time-invitation-secret";
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  let invitationLookup;
  let invitationClaim;
  let userActivation;
  let sessionCreate;
  const audit = [];
  const prisma = {
    projectInvitation: {
      findUnique: async (query) => {
        invitationLookup = query;
        return {
          id: "invitation-1",
          tokenHash,
          email: "new-user@example.test",
          expiresAt: new Date(Date.now() + 60_000),
          acceptedAt: null,
          revokedAt: null,
          projectId: "project-1",
          role: "DEVELOPER",
          invitedById: "admin-1",
        };
      },
    },
    user: {
      findUnique: async () => ({
        id: "invited-user",
        email: "new-user@example.test",
        displayName: "New User",
        status: "INVITED",
        passwordHash: null,
        isSystemAdmin: false,
      }),
    },
    $transaction: async (work) =>
      work({
        projectInvitation: {
          updateMany: async (query) => {
            invitationClaim = query;
            return { count: 1 };
          },
        },
        user: {
          updateMany: async (query) => {
            userActivation = query;
            return { count: 1 };
          },
        },
        userSession: {
          create: async ({ data }) => {
            sessionCreate = data;
            return { id: "session-invite" };
          },
        },
        auditLog: {
          create: async ({ data }) => {
            audit.push(data);
          },
        },
      }),
  };
  let claims;
  const service = new AuthService(prisma, {
    sign: (value) => ((claims = value), "access-token"),
  });

  const result = await service.acceptInvitation(
    rawToken,
    "new secure password",
  );

  assert.deepEqual(invitationLookup.where, { tokenHash });
  assert.equal(result.refreshToken.length > 20, true);
  assert.equal(sessionCreate.userId, "invited-user");
  assert.notEqual(sessionCreate.refreshTokenHash, result.refreshToken);
  assert.equal(invitationClaim.where.acceptedAt, null);
  assert.equal(userActivation.where.status, "INVITED");
  assert.deepEqual(claims, { sub: "invited-user", sid: "session-invite" });
  assert.ok(
    audit.some((entry) => entry.action === "identity.invitation.accepted"),
  );
});

test("expired invitations are rejected without activating the account", async () => {
  let transactionCalled = false;
  const service = new AuthService(
    {
      projectInvitation: {
        findUnique: async () => ({
          id: "expired",
          email: "new-user@example.test",
          expiresAt: new Date(Date.now() - 1),
          acceptedAt: null,
          revokedAt: null,
        }),
      },
      $transaction: async () => {
        transactionCalled = true;
      },
    },
    { sign: () => "unused" },
  );

  await assert.rejects(
    service.acceptInvitation("expired-invitation-token", "new secure password"),
    UnauthorizedException,
  );
  assert.equal(transactionCalled, false);
});

test("a concurrently accepted invitation cannot create a second account session", async () => {
  const rawToken = "one-time-invitation-secret";
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  let sessionCreated = false;
  const prisma = {
    projectInvitation: {
      findUnique: async () => ({
        id: "invitation-1",
        tokenHash,
        email: "new-user@example.test",
        projectId: "project-1",
        expiresAt: new Date(Date.now() + 60_000),
        acceptedAt: null,
        revokedAt: null,
      }),
    },
    user: {
      findUnique: async () => ({
        ...activeUser,
        id: "invited-user",
        status: "INVITED",
        passwordHash: null,
      }),
    },
    $transaction: async (work) =>
      work({
        projectInvitation: { updateMany: async () => ({ count: 0 }) },
        user: { updateMany: async () => ({ count: 0 }) },
        userSession: {
          create: async () => {
            sessionCreated = true;
          },
        },
        auditLog: { create: async () => undefined },
      }),
  };
  const service = new AuthService(prisma, { sign: () => "unused" });

  await assert.rejects(
    service.acceptInvitation(rawToken, "new secure password"),
    UnauthorizedException,
  );
  assert.equal(sessionCreated, false);
});
