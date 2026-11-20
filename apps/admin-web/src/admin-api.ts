type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};
type Requester = {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  download?(path: string): Promise<{ blob: Blob; filename: string | null }>;
};

export type ProjectRole =
  "ADMIN" | "RELEASE_MANAGER" | "DEVELOPER" | "REVIEWER" | "CLIENT";
export type MemberInput = {
  email: string;
  displayName?: string;
  role: ProjectRole;
};
export type RepositoryInput = {
  provider?: string;
  owner: string;
  name: string;
  externalId?: string;
};
export type ChangeOrderInput = {
  id: string;
  sortOrder: number;
  category?: string;
  visibility?: string;
};
export type BrandInput = {
  primaryColor: string;
  accentColor: string | null;
  logoUrl: string | null;
  defaultLocale: string;
};

const segment = (value: string) => encodeURIComponent(value);

export function createAdminApi(client: Requester) {
  return {
    updateProject<T>(projectId: string, body: unknown) {
      return client.request<T>(`/internal/projects/${segment(projectId)}`, {
        method: "PATCH",
        body,
      });
    },
    listMembers<T>(projectId: string) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/members`,
      );
    },
    addMember<T>(projectId: string, body: MemberInput) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/members`,
        {
          method: "POST",
          body,
        },
      );
    },
    updateMemberRole<T>(
      projectId: string,
      membershipId: string,
      role: ProjectRole,
    ) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/members/${segment(membershipId)}`,
        { method: "PATCH", body: { role } },
      );
    },
    assignClientAudience<T>(
      projectId: string,
      membershipId: string,
      clientAudienceId: string | null,
    ) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/members/${segment(membershipId)}/client-audience`,
        { method: "PATCH", body: { clientAudienceId } },
      );
    },
    listClientAudiences<T>(projectId: string) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/client-audiences`,
      );
    },
    createClientAudience<T>(
      projectId: string,
      body: { name: string; slug: string },
    ) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/client-audiences`,
        { method: "POST", body },
      );
    },
    removeMember<T>(projectId: string, membershipId: string) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/members/${segment(membershipId)}`,
        { method: "DELETE" },
      );
    },
    listRepositories<T>(projectId: string) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/repositories`,
      );
    },
    addRepository<T>(projectId: string, body: RepositoryInput) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/repositories`,
        {
          method: "POST",
          body,
        },
      );
    },
    removeRepository<T>(projectId: string, repositoryId: string) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/repositories/${segment(repositoryId)}`,
        { method: "DELETE" },
      );
    },
    listEnvironments<T>(projectId: string) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/environments`,
      );
    },
    updateEnvironment<T>(
      projectId: string,
      environmentId: string,
      body: unknown,
    ) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/environments/${segment(environmentId)}`,
        { method: "PATCH", body },
      );
    },
    getDeploymentPolicy<T>(projectId: string, environmentId: string) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/environments/${segment(environmentId)}/deployment-policy`,
      );
    },
    setDeploymentPolicy<T>(
      projectId: string,
      environmentId: string,
      body: { enabled: boolean; requireApprovedRelease: boolean },
    ) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/environments/${segment(environmentId)}/deployment-policy`,
        { method: "PATCH", body },
      );
    },
    listDeploymentTriggerRequests<T>(projectId: string, releaseId: string) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/releases/${segment(releaseId)}/deployment-trigger-requests`,
      );
    },
    createDeploymentTriggerRequest<T>(
      projectId: string,
      releaseId: string,
      body: { environmentId: string; reason?: string },
      idempotencyKey: string,
    ) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/releases/${segment(releaseId)}/deployment-trigger-requests`,
        {
          method: "POST",
          body,
          headers: { "Idempotency-Key": idempotencyKey },
        },
      );
    },
    updateDeploymentTriggerStatus<T>(
      projectId: string,
      requestId: string,
      body: {
        status: string;
        resultCode?: string;
        resultSummary?: string;
      },
    ) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/deployment-trigger-requests/${segment(requestId)}/status`,
        { method: "PATCH", body },
      );
    },
    listAudit<T>(projectId: string, page = 1, pageSize = 50) {
      const query = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/audit?${query}`,
      );
    },
    downloadProjectAudit(projectId: string) {
      if (!client.download)
        throw new Error("This API client does not support file downloads.");
      return client.download(
        `/internal/projects/${segment(projectId)}/audit/export.csv`,
      );
    },
    getBrand<T>(projectId: string) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/brand`,
      );
    },
    updateBrand<T>(projectId: string, body: BrandInput) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/brand`,
        {
          method: "PATCH",
          body,
        },
      );
    },
    listSubscriptions<T>(projectId: string) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/subscriptions`,
      );
    },
    listReleaseSubscriptions<T>(projectId: string, releaseId: string) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/subscriptions/releases/${segment(releaseId)}`,
      );
    },
    getAnalytics<T>(projectId: string, days = 30) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/analytics?days=${days}`,
      );
    },
    suggestAiSummary<T>(releaseId: string) {
      return client.request<T>(
        `/internal/releases/${segment(releaseId)}/ai-summary-suggestions`,
        { method: "POST" },
      );
    },
    listProjectReleases<T>(projectId: string) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/releases`,
      );
    },
    listIntegrationSuggestions<T>(projectId: string, limit = 100) {
      const query = new URLSearchParams({ limit: String(limit) });
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/integration-suggestions?${query}`,
      );
    },
    acceptIntegrationSuggestion<T>(
      projectId: string,
      suggestionId: string,
      releaseId: string,
    ) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/integration-suggestions/${segment(suggestionId)}/accept`,
        { method: "PATCH", body: { releaseId } },
      );
    },
    dismissIntegrationSuggestion<T>(projectId: string, suggestionId: string) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/integration-suggestions/${segment(suggestionId)}/dismiss`,
        { method: "PATCH" },
      );
    },
    listAnalyticsExports<T>(projectId: string) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/analytics/exports`,
      );
    },
    createAnalyticsExport<T>(
      projectId: string,
      body: {
        kind: "ANALYTICS_CSV" | "RELEASE_PDF";
        days?: number;
        releaseId?: string;
      },
    ) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/analytics/exports`,
        { method: "POST", body },
      );
    },
    downloadAnalyticsExport(projectId: string, exportId: string) {
      if (!client.download)
        throw new Error("This API client does not support file downloads.");
      return client.download(
        `/internal/projects/${segment(projectId)}/analytics/exports/${segment(exportId)}/download`,
      );
    },
    updateSubscriptionPreferences<T>(
      projectId: string,
      subscriptionId: string,
      preferences: { newReleases?: boolean; securityOnly?: boolean },
    ) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/subscriptions/${segment(subscriptionId)}/preferences`,
        { method: "PATCH", body: preferences },
      );
    },
    updateReleaseSubscriptionPreferences<T>(
      projectId: string,
      releaseId: string,
      subscriptionId: string,
      preferences: { newReleases?: boolean; securityOnly?: boolean },
    ) {
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/subscriptions/releases/${segment(releaseId)}/${segment(subscriptionId)}/preferences`,
        { method: "PATCH", body: preferences },
      );
    },
    updateRelease<T>(releaseId: string, body: unknown) {
      return client.request<T>(`/internal/releases/${segment(releaseId)}`, {
        method: "PATCH",
        body,
      });
    },
    getReleaseAudience<T>(releaseId: string) {
      return client.request<T>(
        `/internal/releases/${segment(releaseId)}/audience`,
      );
    },
    setReleaseAudience<T>(
      releaseId: string,
      body: { mode: "PUBLIC" | "CLIENTS"; audienceIds: string[] },
    ) {
      return client.request<T>(
        `/internal/releases/${segment(releaseId)}/audience`,
        { method: "PATCH", body },
      );
    },
    archiveRelease<T>(releaseId: string) {
      return client.request<T>(
        `/internal/releases/${segment(releaseId)}/archive`,
        {
          method: "PATCH",
        },
      );
    },
    compareReleases<T>(projectId: string, fromId: string, toId: string) {
      const query = new URLSearchParams({ from: fromId, to: toId });
      return client.request<T>(
        `/internal/projects/${segment(projectId)}/releases/compare?${query}`,
      );
    },
    downloadReleaseComparison(
      projectId: string,
      fromId: string,
      toId: string,
      format: "csv" | "json",
    ) {
      if (!client.download)
        throw new Error("This API client does not support file downloads.");
      const query = new URLSearchParams({ from: fromId, to: toId, format });
      return client.download(
        `/internal/projects/${segment(projectId)}/releases/compare/export?${query}`,
      );
    },
    updateChangeOrder<T>(releaseId: string, changes: ChangeOrderInput[]) {
      return client.request<T>(
        `/internal/releases/${segment(releaseId)}/changes/bulk`,
        { method: "PATCH", body: { changes } },
      );
    },
    listApprovalRevisions<T = unknown[]>() {
      return client.request<T>("/internal/approval-revisions");
    },
    approveRevision<T>(
      releaseId: string,
      revisionId: string,
      body: { comment?: string },
    ) {
      return client.request<T>(
        `/internal/releases/${segment(releaseId)}/approval-revisions/${segment(revisionId)}/approve`,
        { method: "PATCH", body },
      );
    },
    rejectRevision<T>(
      releaseId: string,
      revisionId: string,
      body: { comment?: string },
    ) {
      return client.request<T>(
        `/internal/releases/${segment(releaseId)}/approval-revisions/${segment(revisionId)}/reject`,
        { method: "PATCH", body },
      );
    },
    publishRevision<T>(releaseId: string, revisionId: string) {
      return client.request<T>(
        `/internal/releases/${segment(releaseId)}/approval-revisions/${segment(revisionId)}/publish`,
        { method: "POST" },
      );
    },
    search<T>(query: string, page = 1, pageSize = 20) {
      const params = new URLSearchParams({
        q: query,
        page: String(page),
        pageSize: String(pageSize),
      });
      return client.request<T>(`/internal/search?${params}`);
    },
    listDocuments<T>(projectId: string, releaseId: string) {
      return client.request<T>(
        `${releaseContentPath(projectId, releaseId)}/documents`,
      );
    },
    createDocument<T>(projectId: string, releaseId: string, body: unknown) {
      return client.request<T>(
        `${releaseContentPath(projectId, releaseId)}/documents`,
        { method: "POST", body },
      );
    },
    updateDocument<T>(
      projectId: string,
      releaseId: string,
      documentId: string,
      body: unknown,
    ) {
      return client.request<T>(
        `${releaseContentPath(projectId, releaseId)}/documents/${segment(documentId)}`,
        { method: "PATCH", body },
      );
    },
    deleteDocument<T>(
      projectId: string,
      releaseId: string,
      documentId: string,
    ) {
      return client.request<T>(
        `${releaseContentPath(projectId, releaseId)}/documents/${segment(documentId)}`,
        { method: "DELETE" },
      );
    },
    reorderDocuments<T>(
      projectId: string,
      releaseId: string,
      documentIds: string[],
    ) {
      return client.request<T>(
        `${releaseContentPath(projectId, releaseId)}/documents/reorder`,
        { method: "PATCH", body: { documentIds } },
      );
    },
    listAttachments<T>(projectId: string, releaseId: string) {
      return client.request<T>(
        `${releaseContentPath(projectId, releaseId)}/attachments`,
      );
    },
    uploadAttachment<T>(projectId: string, releaseId: string, form: FormData) {
      return client.request<T>(
        `${releaseContentPath(projectId, releaseId)}/attachments`,
        { method: "POST", body: form },
      );
    },
    scanAttachment<T>(
      projectId: string,
      releaseId: string,
      attachmentId: string,
    ) {
      return client.request<T>(
        `${releaseContentPath(projectId, releaseId)}/attachments/${segment(attachmentId)}/scan`,
        { method: "POST" },
      );
    },
    setAttachmentPublic<T>(
      projectId: string,
      releaseId: string,
      attachmentId: string,
      publicAllowed: boolean,
    ) {
      return client.request<T>(
        `${releaseContentPath(projectId, releaseId)}/attachments/${segment(attachmentId)}/public`,
        { method: "PATCH", body: { publicAllowed } },
      );
    },
    downloadPrivateAttachment(
      projectId: string,
      releaseId: string,
      attachmentId: string,
    ) {
      if (!client.download)
        throw new Error("This API client does not support file downloads.");
      return client.download(
        `${releaseContentPath(projectId, releaseId)}/attachments/${segment(attachmentId)}/download`,
      );
    },
    listDeployments<T>(projectId: string, releaseId: string) {
      return client.request<T>(
        `${releaseContentPath(projectId, releaseId)}/deployments`,
      );
    },
    createDeployment<T>(projectId: string, releaseId: string, body: unknown) {
      return client.request<T>(
        `${releaseContentPath(projectId, releaseId)}/deployments`,
        { method: "POST", body },
      );
    },
    updateDeployment<T>(
      projectId: string,
      releaseId: string,
      deploymentId: string,
      body: unknown,
    ) {
      return client.request<T>(
        `${releaseContentPath(projectId, releaseId)}/deployments/${segment(deploymentId)}`,
        { method: "PATCH", body },
      );
    },
    listSessions<T>() {
      return client.request<T>("/internal/auth/sessions");
    },
    revokeSession<T>(sessionId: string) {
      return client.request<T>(
        `/internal/auth/sessions/${segment(sessionId)}`,
        { method: "DELETE" },
      );
    },
    changePassword<T>(body: { currentPassword: string; newPassword: string }) {
      return client.request<T>("/internal/auth/password", {
        method: "PATCH",
        body,
      });
    },
  };
}

function releaseContentPath(projectId: string, releaseId: string) {
  return `/internal/projects/${segment(projectId)}/releases/${segment(releaseId)}`;
}
