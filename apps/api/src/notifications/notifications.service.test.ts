import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { NotificationsService } from "./notifications.service";

test("subscription creation stores token hashes and queues a verification message", async () => {
  let created: any;
  let queued: any;
  let insertQuery = "";
  const service = new NotificationsService(
    {
      project: {
        findUnique: async () => ({
          id: "project-1",
          slug: "product",
          name: "Product",
        }),
      },
      $queryRawUnsafe: async (query: string, ...args: any[]) => {
        if (query.includes('INSERT INTO "Subscription"')) {
          insertQuery = query;
          created = {
            id: args[0],
            email: args[1],
            projectId: args[2],
            releaseId: args[3],
            locale: args[4],
            verificationTokenHash: args[5],
            unsubscribeTokenHash: args[6],
          };
          return [{ id: "sub-1", email: args[1] }];
        }
        return [{ id: "delivery-1" }];
      },
      notificationDelivery: {
        create: async ({ data }: any) => ({ id: "delivery-1", ...data }),
      },
      auditLog: { create: async () => undefined },
    } as any,
    undefined,
    {
      add: async (_name: string, data: any) => {
        queued = data;
      },
    } as any,
  );
  const result = await service.subscribe("product", {
    email: "reader@example.test",
    locale: "en",
  });
  assert.equal(result.subscriptionId, "sub-1");
  assert.equal(queued.kind, "VERIFICATION");
  const token = queued.message.text.match(/token=([a-f0-9]{64})/)?.[1];
  assert.equal(typeof token, "string");
  assert.equal(
    createHash("sha256").update(token!).digest("hex"),
    created.verificationTokenHash,
  );
  assert.equal(created.unsubscribeTokenHash.length, 64);
  assert.equal(created.email, "reader@example.test");
  assert.equal(created.releaseId, null);
  assert.match(
    insertQuery,
    /ON CONFLICT \("email", "projectId"\) WHERE "releaseId" IS NULL/,
  );
  assert.equal(JSON.stringify(created).includes(token!), false);
});

test("unsubscribe accepts only a matching active token and clears verification", async () => {
  let where: any;
  const service = new NotificationsService(
    {
      project: { findUnique: async () => ({ id: "project-1" }) },
      subscription: {
        findFirst: async () => ({
          id: "sub-1",
          projectId: "project-1",
          verifiedAt: new Date(),
          unsubscribeTokenHash: "hash",
        }),
        updateMany: async (args: any) => {
          where = args.where;
          return { count: 1 };
        },
      },
    } as any,
    { hashToken: () => "hash" },
  );
  assert.deepEqual(await service.unsubscribe("product", "safe-token"), {
    unsubscribed: true,
  });
  assert.deepEqual(where, { id: "sub-1", unsubscribedAt: null });
});

test("subscription administration is limited to members of the selected project", async () => {
  let membershipQuery: any;
  let subscriptionQuery: any;
  const expected = [{ id: "sub-1", email: "reader@example.test" }];
  const service = new NotificationsService({
    projectMember: {
      findUnique: async (args: any) => {
        membershipQuery = args.where;
        return { role: "ADMIN" };
      },
    },
    $queryRawUnsafe: async (query: string, ...args: any[]) => {
      subscriptionQuery = { query, args };
      return expected;
    },
  } as any);
  assert.equal(
    await service.listSubscriptions(
      { id: "admin-1", isSystemAdmin: false },
      "project-1",
    ),
    expected,
  );
  assert.deepEqual(membershipQuery, {
    projectId_userId: { projectId: "project-1", userId: "admin-1" },
  });
  assert.match(subscriptionQuery.query, /s\."projectId" = \$1::uuid/);
  assert.match(subscriptionQuery.query, /s\."releaseId" IS NULL/);
  assert.match(subscriptionQuery.query, /jsonb_build_object\('deliveries'/);
  assert.deepEqual(subscriptionQuery.args, ["project-1"]);
});

test("a published release queues only snapshot fields and stores a hash for its unsubscribe link", async () => {
  let deliveryData: any;
  let queued: any;
  const service = new NotificationsService(
    {
      publicReleaseSnapshot: {
        findUnique: async () => ({
          id: "snapshot-1",
          projectSlug: "product",
          projectName: "Product",
          version: "2.0.0",
          title: "Public release",
          summary: "Public summary",
          publishedAt: new Date(),
          changes: [
            {
              title: "Public feature",
              category: "FEATURE",
              description: "Public details",
              sortOrder: 0,
            },
          ],
        }),
      },
      $queryRawUnsafe: async (query: string) => {
        if (query.includes('JOIN "ReleasePublication"'))
          return [{ releaseId: "release-1" }];
        return [
          {
            id: "sub-1",
            email: "reader@example.test",
            locale: "en",
            preferences: { newReleases: true, securityOnly: false },
          },
        ];
      },
      notificationDelivery: {
        create: async ({ data }: any) => {
          deliveryData = data;
          return { id: "delivery-1" };
        },
      },
    } as any,
    undefined,
    {
      add: async (_name: string, data: any) => {
        queued = data;
      },
    } as any,
  );
  await service.queuePublication("project-1", "snapshot-1");
  const token = queued.message.text.match(/token=([a-f0-9]{64})/)?.[1];
  assert.equal(
    createHash("sha256").update(token!).digest("hex"),
    deliveryData.unsubscribeTokenHash,
  );
  assert.deepEqual(deliveryData.payload, { snapshotId: "snapshot-1" });
  assert.match(queued.message.html, /Public details/);
  assert.doesNotMatch(queued.message.html, /internal|private/i);
  assert.equal(
    queued.message.text.includes("/projects/product/releases/2.0.0"),
    true,
  );
});

test("a per-delivery unsubscribe token revokes only its project subscription", async () => {
  let updated: any;
  const service = new NotificationsService(
    {
      project: { findUnique: async () => ({ id: "project-1" }) },
      subscription: {
        findFirst: async () => null,
        updateMany: async (args: any) => {
          updated = args;
          return { count: 1 };
        },
      },
      notificationDelivery: {
        findFirst: async () => ({ subscriptionId: "sub-1" }),
      },
    } as any,
    { hashToken: () => "hashed-delivery-token" },
  );
  assert.deepEqual(await service.unsubscribe("product", "delivery-token"), {
    unsubscribed: true,
  });
  assert.deepEqual(updated.where, { id: "sub-1", unsubscribedAt: null });
});

test("release subscription creates a separately scoped verification record", async () => {
  let subscriptionSql = "";
  let subscriptionParams: unknown[] = [];
  let releaseLookup: unknown[] = [];
  let insertedSubscriptionId = "";
  const service = new NotificationsService(
    {
      project: {
        findUnique: async () => ({
          id: "project-1",
          slug: "product",
          name: "Product",
        }),
      },
      release: {
        findFirst: async (args: any) => {
          releaseLookup = [args.where.id, args.where.projectId];
          return { id: "release-1" };
        },
      },
      $queryRawUnsafe: async (query: string, ...params: unknown[]) => {
        if (query.includes('INSERT INTO "Subscription"')) {
          subscriptionSql = query;
          subscriptionParams = params;
          insertedSubscriptionId = String(params[0]);
          return [{ id: insertedSubscriptionId, email: "reader@example.test" }];
        }
        return [{ id: "delivery-1" }];
      },
      notificationDelivery: {
        create: async () => ({ id: "delivery-1" }),
      },
      auditLog: { create: async () => undefined },
    } as any,
    { hashToken: () => "hashed" },
    { add: async () => undefined },
  );

  const result = await service.subscribe("product", {
    email: " Reader@Example.Test ",
    releaseId: "release-1",
  });

  assert.equal(result.subscriptionId, insertedSubscriptionId);
  assert.deepEqual(releaseLookup, ["release-1", "project-1"]);
  assert.match(subscriptionSql, /"releaseId"/);
  assert.deepEqual(subscriptionParams.slice(0, 3), [
    insertedSubscriptionId,
    "reader@example.test",
    "project-1",
  ]);
  assert.equal(subscriptionParams[3], "release-1");
  assert.match(
    subscriptionSql,
    /ON CONFLICT \("email", "projectId", "releaseId"\) DO UPDATE/,
  );
});

test("release preferences are scoped to both the project and release", async () => {
  let updateSql = "";
  let params: unknown[] = [];
  const service = new NotificationsService({
    projectMember: {
      findUnique: async () => ({ role: "ADMIN" }),
    },
    release: { findFirst: async () => ({ id: "release-1" }) },
    $queryRawUnsafe: async (query: string, ...values: unknown[]) => {
      updateSql = query;
      params = values;
      const preferences = {
        securityOnly: true,
        ...JSON.parse(String(values[3])),
      };
      return [{ id: "sub-1", email: "reader@example.test", preferences }];
    },
  } as any);

  const updated = await service.updatePreferences(
    { id: "admin-1", isSystemAdmin: false },
    "project-1",
    "sub-1",
    { newReleases: false },
    "release-1",
  );

  assert.equal(updated.preferences.newReleases, false);
  assert.match(updateSql, /"releaseId" IS NOT DISTINCT FROM \$3/);
  assert.deepEqual(params, [
    "sub-1",
    "project-1",
    "release-1",
    JSON.stringify({ newReleases: false }),
  ]);
});
