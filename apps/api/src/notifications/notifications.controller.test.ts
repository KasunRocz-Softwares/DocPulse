import assert from "node:assert/strict";
import test from "node:test";
import {
  ProjectNotificationsController,
  PublicNotificationsController,
} from "./notifications.controller";

test("public subscription routes preserve project scope and allow a release scope", async () => {
  const calls: unknown[][] = [];
  const notifications = {
    subscribe: async (...args: unknown[]) => {
      calls.push(args);
      return { accepted: true };
    },
  } as any;
  const controller = new PublicNotificationsController(notifications);

  await controller.subscribe("product", { email: "reader@example.test" });
  await controller.subscribeRelease("product", "release-1", {
    email: "reader@example.test",
  });

  assert.deepEqual(calls, [
    ["product", { email: "reader@example.test" }],
    ["product", { email: "reader@example.test", releaseId: "release-1" }],
  ]);
});

test("release subscription administration forwards release scope for list and preferences", async () => {
  const calls: unknown[][] = [];
  const notifications = {
    listSubscriptions: async (...args: unknown[]) => {
      calls.push(["list", ...args]);
      return [];
    },
    updatePreferences: async (...args: unknown[]) => {
      calls.push(["update", ...args]);
      return { id: "sub-1" };
    },
  } as any;
  const controller = new ProjectNotificationsController(notifications);
  const request = { user: { id: "admin-1", isSystemAdmin: false } } as any;

  await controller.listRelease(request, "project-1", "release-1");
  await controller.updateRelease(request, "project-1", "release-1", "sub-1", {
    securityOnly: true,
  });

  assert.deepEqual(calls, [
    ["list", request.user, "project-1", "release-1"],
    [
      "update",
      request.user,
      "project-1",
      "sub-1",
      { securityOnly: true },
      "release-1",
    ],
  ]);
});
