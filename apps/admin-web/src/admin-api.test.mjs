import assert from "node:assert/strict";
import test from "node:test";
import { createAdminApi } from "./admin-api.ts";

function recorder(result = {}) {
  const calls = [];
  return {
    calls,
    api: createAdminApi({
      request: async (path, options = {}) => {
        calls.push({ path, ...options });
        return result;
      },
      download: async (path) => {
        calls.push({ path, download: true });
        return { blob: new Blob(), filename: "private.txt" };
      },
    }),
  };
}

test("project admin methods use the internal project API contract", async () => {
  const { api, calls } = recorder([]);
  await api.updateProject("project/1", { name: "Updated", description: null });
  await api.listMembers("project/1");
  await api.addMember("project/1", {
    email: "dev@example.test",
    displayName: "Dev",
    role: "DEVELOPER",
  });
  await api.updateMemberRole("project/1", "member/1", "CLIENT");
  await api.removeMember("project/1", "member/1");
  await api.listRepositories("project/1");
  await api.addRepository("project/1", {
    owner: "acme",
    name: "docs",
    provider: "GITHUB",
  });
  await api.removeRepository("project/1", "repo/1");
  await api.listEnvironments("project/1");
  await api.updateEnvironment("project/1", "env/1", {
    label: "Production",
    enabled: false,
  });
  await api.listAudit("project/1", 2, 25);
  await api.getBrand("project/1");
  await api.updateBrand("project/1", {
    primaryColor: "#134e4a",
    accentColor: null,
    logoUrl: "https://cdn.example.test/logo.svg",
    defaultLocale: "en-US",
  });

  assert.deepEqual(calls, [
    {
      path: "/internal/projects/project%2F1",
      method: "PATCH",
      body: { name: "Updated", description: null },
    },
    { path: "/internal/projects/project%2F1/members" },
    {
      path: "/internal/projects/project%2F1/members",
      method: "POST",
      body: {
        email: "dev@example.test",
        displayName: "Dev",
        role: "DEVELOPER",
      },
    },
    {
      path: "/internal/projects/project%2F1/members/member%2F1",
      method: "PATCH",
      body: { role: "CLIENT" },
    },
    {
      path: "/internal/projects/project%2F1/members/member%2F1",
      method: "DELETE",
    },
    { path: "/internal/projects/project%2F1/repositories" },
    {
      path: "/internal/projects/project%2F1/repositories",
      method: "POST",
      body: { owner: "acme", name: "docs", provider: "GITHUB" },
    },
    {
      path: "/internal/projects/project%2F1/repositories/repo%2F1",
      method: "DELETE",
    },
    { path: "/internal/projects/project%2F1/environments" },
    {
      path: "/internal/projects/project%2F1/environments/env%2F1",
      method: "PATCH",
      body: { label: "Production", enabled: false },
    },
    { path: "/internal/projects/project%2F1/audit?page=2&pageSize=25" },
    { path: "/internal/projects/project%2F1/brand" },
    {
      path: "/internal/projects/project%2F1/brand",
      method: "PATCH",
      body: {
        primaryColor: "#134e4a",
        accentColor: null,
        logoUrl: "https://cdn.example.test/logo.svg",
        defaultLocale: "en-US",
      },
    },
  ]);
});

test("integration suggestion methods follow the project scoped review contract", async () => {
  const { api, calls } = recorder([]);
  await api.listIntegrationSuggestions("project/1", 120);
  await api.acceptIntegrationSuggestion(
    "project/1",
    "suggestion/2",
    "release/3",
  );
  await api.dismissIntegrationSuggestion("project/1", "suggestion/4");

  assert.deepEqual(calls, [
    {
      path: "/internal/projects/project%2F1/integration-suggestions?limit=120",
    },
    {
      path: "/internal/projects/project%2F1/integration-suggestions/suggestion%2F2/accept",
      method: "PATCH",
      body: { releaseId: "release/3" },
    },
    {
      path: "/internal/projects/project%2F1/integration-suggestions/suggestion%2F4/dismiss",
      method: "PATCH",
    },
  ]);
});

test("client audience methods use project-scoped administration and release routes", async () => {
  const { api, calls } = recorder([]);
  await api.listClientAudiences("project/1");
  await api.createClientAudience("project/1", {
    name: "Northwind",
    slug: "northwind",
  });
  await api.assignClientAudience("project/1", "member/1", "audience/1");
  await api.assignClientAudience("project/1", "member/2", null);
  await api.getReleaseAudience("release/1");
  await api.setReleaseAudience("release/1", {
    mode: "CLIENTS",
    audienceIds: ["audience/1"],
  });

  assert.deepEqual(calls, [
    { path: "/internal/projects/project%2F1/client-audiences" },
    {
      path: "/internal/projects/project%2F1/client-audiences",
      method: "POST",
      body: { name: "Northwind", slug: "northwind" },
    },
    {
      path: "/internal/projects/project%2F1/members/member%2F1/client-audience",
      method: "PATCH",
      body: { clientAudienceId: "audience/1" },
    },
    {
      path: "/internal/projects/project%2F1/members/member%2F2/client-audience",
      method: "PATCH",
      body: { clientAudienceId: null },
    },
    { path: "/internal/releases/release%2F1/audience" },
    {
      path: "/internal/releases/release%2F1/audience",
      method: "PATCH",
      body: { mode: "CLIENTS", audienceIds: ["audience/1"] },
    },
  ]);
});

test("release admin methods match update, archive, comparison, and bulk ordering routes", async () => {
  const { api, calls } = recorder([]);
  await api.updateRelease("release/1", { title: "Release" });
  await api.archiveRelease("release/1");
  await api.compareReleases("project/1", "release/1", "release/2");
  await api.updateChangeOrder("release/1", [
    { id: "change/1", sortOrder: 0 },
    { id: "change/2", sortOrder: 1, visibility: "PUBLIC" },
  ]);

  assert.deepEqual(calls, [
    {
      path: "/internal/releases/release%2F1",
      method: "PATCH",
      body: { title: "Release" },
    },
    { path: "/internal/releases/release%2F1/archive", method: "PATCH" },
    {
      path: "/internal/projects/project%2F1/releases/compare?from=release%2F1&to=release%2F2",
    },
    {
      path: "/internal/releases/release%2F1/changes/bulk",
      method: "PATCH",
      body: {
        changes: [
          { id: "change/1", sortOrder: 0 },
          { id: "change/2", sortOrder: 1, visibility: "PUBLIC" },
        ],
      },
    },
  ]);
});

test("release comparison export downloads the selected project-scoped format", async () => {
  const { api, calls } = recorder([]);
  await api.downloadReleaseComparison(
    "project/1",
    "release/1",
    "release/2",
    "csv",
  );

  assert.deepEqual(calls, [
    {
      path: "/internal/projects/project%2F1/releases/compare/export?from=release%2F1&to=release%2F2&format=csv",
      download: true,
    },
  ]);
});

test("project audit export downloads the project-scoped CSV", async () => {
  const { api, calls } = recorder([]);
  await api.downloadProjectAudit("project/1");

  assert.deepEqual(calls, [
    {
      path: "/internal/projects/project%2F1/audit/export.csv",
      download: true,
    },
  ]);
});

test("deployment orchestration methods preserve project scope and idempotency", async () => {
  const { api, calls } = recorder({ id: "trigger-1", status: "REQUESTED" });
  await api.getDeploymentPolicy("project/1", "environment/1");
  await api.setDeploymentPolicy("project/1", "environment/1", {
    enabled: true,
    requireApprovedRelease: true,
  });
  await api.listDeploymentTriggerRequests("project/1", "release/1");
  await api.createDeploymentTriggerRequest(
    "project/1",
    "release/1",
    { environmentId: "environment/1", reason: "Release window" },
    "request-key-123",
  );
  await api.updateDeploymentTriggerStatus("project/1", "trigger/1", {
    status: "ACCEPTED",
  });

  assert.deepEqual(calls, [
    {
      path: "/internal/projects/project%2F1/environments/environment%2F1/deployment-policy",
    },
    {
      path: "/internal/projects/project%2F1/environments/environment%2F1/deployment-policy",
      method: "PATCH",
      body: { enabled: true, requireApprovedRelease: true },
    },
    {
      path: "/internal/projects/project%2F1/releases/release%2F1/deployment-trigger-requests",
    },
    {
      path: "/internal/projects/project%2F1/releases/release%2F1/deployment-trigger-requests",
      method: "POST",
      body: { environmentId: "environment/1", reason: "Release window" },
      headers: { "Idempotency-Key": "request-key-123" },
    },
    {
      path: "/internal/projects/project%2F1/deployment-trigger-requests/trigger%2F1/status",
      method: "PATCH",
      body: { status: "ACCEPTED" },
    },
  ]);
});

test("approval queue reads pending exact revisions and decides against their release IDs", async () => {
  const { api, calls } = recorder([]);
  await api.listApprovalRevisions();
  await api.approveRevision("release/1", "revision/7", { comment: "Checked" });
  await api.rejectRevision("release/2", "revision/8", {
    comment: "Needs edits",
  });
  await api.publishRevision("release/1", "revision/7");

  assert.deepEqual(calls, [
    { path: "/internal/approval-revisions" },
    {
      path: "/internal/releases/release%2F1/approval-revisions/revision%2F7/approve",
      method: "PATCH",
      body: { comment: "Checked" },
    },
    {
      path: "/internal/releases/release%2F2/approval-revisions/revision%2F8/reject",
      method: "PATCH",
      body: { comment: "Needs edits" },
    },
    {
      path: "/internal/releases/release%2F1/approval-revisions/revision%2F7/publish",
      method: "POST",
    },
  ]);
});

test("search sends the query and pagination to the authorization-scoped endpoint", async () => {
  const { api, calls } = recorder({
    items: [],
    page: 3,
    pageSize: 25,
    total: 50,
  });
  await api.search("bug fix & patch", 3, 25);
  assert.deepEqual(calls, [
    { path: "/internal/search?q=bug+fix+%26+patch&page=3&pageSize=25" },
  ]);
});

test("release content methods use scoped document, attachment, and deployment endpoints", async () => {
  const { api, calls } = recorder([]);
  const form = new FormData();
  form.set("file", new Blob(["doc"]), "doc.txt");
  await api.listDocuments("project/1", "release/1");
  await api.createDocument("project/1", "release/1", {
    section: "Guide",
    title: "Install",
    content: { type: "doc", content: [] },
  });
  await api.updateDocument("project/1", "release/1", "document/1", {
    title: "Setup",
  });
  await api.deleteDocument("project/1", "release/1", "document/1");
  await api.reorderDocuments("project/1", "release/1", ["document/1"]);
  await api.listAttachments("project/1", "release/1");
  await api.uploadAttachment("project/1", "release/1", form);
  await api.scanAttachment("project/1", "release/1", "attachment/1");
  await api.setAttachmentPublic("project/1", "release/1", "attachment/1", true);
  await api.downloadPrivateAttachment("project/1", "release/1", "attachment/1");
  await api.listDeployments("project/1", "release/1");
  await api.createDeployment("project/1", "release/1", {
    environmentId: "environment/1",
    status: "SUCCEEDED",
  });
  await api.updateDeployment("project/1", "release/1", "deployment/1", {
    status: "FAILED",
  });

  assert.deepEqual(calls, [
    { path: "/internal/projects/project%2F1/releases/release%2F1/documents" },
    {
      path: "/internal/projects/project%2F1/releases/release%2F1/documents",
      method: "POST",
      body: {
        section: "Guide",
        title: "Install",
        content: { type: "doc", content: [] },
      },
    },
    {
      path: "/internal/projects/project%2F1/releases/release%2F1/documents/document%2F1",
      method: "PATCH",
      body: { title: "Setup" },
    },
    {
      path: "/internal/projects/project%2F1/releases/release%2F1/documents/document%2F1",
      method: "DELETE",
    },
    {
      path: "/internal/projects/project%2F1/releases/release%2F1/documents/reorder",
      method: "PATCH",
      body: { documentIds: ["document/1"] },
    },
    { path: "/internal/projects/project%2F1/releases/release%2F1/attachments" },
    {
      path: "/internal/projects/project%2F1/releases/release%2F1/attachments",
      method: "POST",
      body: form,
    },
    {
      path: "/internal/projects/project%2F1/releases/release%2F1/attachments/attachment%2F1/scan",
      method: "POST",
    },
    {
      path: "/internal/projects/project%2F1/releases/release%2F1/attachments/attachment%2F1/public",
      method: "PATCH",
      body: { publicAllowed: true },
    },
    {
      path: "/internal/projects/project%2F1/releases/release%2F1/attachments/attachment%2F1/download",
      download: true,
    },
    { path: "/internal/projects/project%2F1/releases/release%2F1/deployments" },
    {
      path: "/internal/projects/project%2F1/releases/release%2F1/deployments",
      method: "POST",
      body: { environmentId: "environment/1", status: "SUCCEEDED" },
    },
    {
      path: "/internal/projects/project%2F1/releases/release%2F1/deployments/deployment%2F1",
      method: "PATCH",
      body: { status: "FAILED" },
    },
  ]);
});

test("account security methods use current-user session and password routes", async () => {
  const { api, calls } = recorder([]);
  await api.listSessions();
  await api.revokeSession("session/1");
  await api.changePassword({
    currentPassword: "current-password",
    newPassword: "new-password-123",
  });
  assert.deepEqual(calls, [
    { path: "/internal/auth/sessions" },
    { path: "/internal/auth/sessions/session%2F1", method: "DELETE" },
    {
      path: "/internal/auth/password",
      method: "PATCH",
      body: {
        currentPassword: "current-password",
        newPassword: "new-password-123",
      },
    },
  ]);
});

test("subscription management uses project-scoped list and preference routes", async () => {
  const { api, calls } = recorder([]);
  await api.listSubscriptions("project/1");
  await api.updateSubscriptionPreferences("project/1", "subscription/2", {
    securityOnly: true,
  });
  assert.deepEqual(calls, [
    { path: "/internal/projects/project%2F1/subscriptions" },
    {
      path: "/internal/projects/project%2F1/subscriptions/subscription%2F2/preferences",
      method: "PATCH",
      body: { securityOnly: true },
    },
  ]);
});

test("release subscription management uses release-scoped list and preference routes", async () => {
  const { api, calls } = recorder([]);
  await api.listReleaseSubscriptions("project/1", "release/2");
  await api.updateReleaseSubscriptionPreferences(
    "project/1",
    "release/2",
    "subscription/3",
    { newReleases: false },
  );

  assert.deepEqual(calls, [
    {
      path: "/internal/projects/project%2F1/subscriptions/releases/release%2F2",
    },
    {
      path: "/internal/projects/project%2F1/subscriptions/releases/release%2F2/subscription%2F3/preferences",
      method: "PATCH",
      body: { newReleases: false },
    },
  ]);
});
