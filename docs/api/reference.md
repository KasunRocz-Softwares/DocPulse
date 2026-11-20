# RDPS API reference

**OpenAPI version:** 3.0.0  
**API version:** 1.0  
**Generated from:** `http://localhost:13001/api/docs-json`  
**Generation:** `node scripts/docs/generate-api-reference.mjs` (requires the API to be running)

Internal and public release documentation APIs

> This file is generated. Update API source decorators and DTOs, then regenerate; do not hand-edit endpoint details here.
> Swagger metadata may be less detailed than runtime validation. The API rejects non-whitelisted request fields and transforms declared DTOs.

## Authentication

Protected operations use the bearer authentication scheme declared in the OpenAPI document. Public delivery and webhook operations may be anonymous or use provider-specific signature verification; consult each operation's security metadata and the integration runbooks.

**Operations:** 142  
**Paths:** 121  
**Tags:** 28

## analytics worker callbacks

### `POST /api/v1/internal/analytics/worker/exports/{exportId}/complete`

AnalyticsWorkerController_complete

**Operation ID:** `AnalyticsWorkerController_complete`  
**Security:** none declared

| Parameter  | In   | Required | Type   | Description |
| ---------- | ---- | -------- | ------ | ----------- |
| `exportId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

### `POST /api/v1/internal/analytics/worker/exports/{exportId}/failed`

AnalyticsWorkerController_failed

**Operation ID:** `AnalyticsWorkerController_failed`  
**Security:** none declared

| Parameter  | In   | Required | Type   | Description |
| ---------- | ---- | -------- | ------ | ----------- |
| `exportId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

### `POST /api/v1/internal/analytics/worker/exports/{exportId}/processing`

AnalyticsWorkerController_processing

**Operation ID:** `AnalyticsWorkerController_processing`  
**Security:** none declared

| Parameter              | In     | Required | Type   | Description |
| ---------------------- | ------ | -------- | ------ | ----------- |
| `exportId`             | path   | yes      | string | —           |
| `x-rdps-worker-secret` | header | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

## auth

### `POST /api/v1/internal/auth/bootstrap`

AuthController_bootstrap

**Operation ID:** `AuthController_bootstrap`  
**Security:** none declared

**Request body (required):** `application/json`: `BootstrapInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/auth/invitations/accept`

AuthController_acceptInvitation

**Operation ID:** `AuthController_acceptInvitation`  
**Security:** none declared

**Request body (required):** `application/json`: `AcceptInvitationInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/auth/login`

AuthController_login

**Operation ID:** `AuthController_login`  
**Security:** none declared

**Request body (required):** `application/json`: `LoginInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/auth/logout`

AuthController_logout

**Operation ID:** `AuthController_logout`  
**Security:** none declared

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/internal/auth/me`

AuthController_me

**Operation ID:** `AuthController_me`  
**Security:** `bearer`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/internal/auth/oidc/callback`

AuthController_completeOidc

**Operation ID:** `AuthController_completeOidc`  
**Security:** none declared

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/internal/auth/oidc/config`

AuthController_oidcConfig

**Operation ID:** `AuthController_oidcConfig`  
**Security:** none declared

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/auth/oidc/link/start`

AuthController_startOidcLink

**Operation ID:** `AuthController_startOidcLink`  
**Security:** `bearer`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

### `GET /api/v1/internal/auth/oidc/start`

AuthController_startOidc

**Operation ID:** `AuthController_startOidc`  
**Security:** none declared

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `PATCH /api/v1/internal/auth/password`

AuthController_changePassword

**Operation ID:** `AuthController_changePassword`  
**Security:** `bearer`

**Request body (required):** `application/json`: `ChangePasswordInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/auth/password-reset/complete`

AuthController_completePasswordReset

**Operation ID:** `AuthController_completePasswordReset`  
**Security:** none declared

**Request body (required):** `application/json`: `CompletePasswordResetInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/auth/refresh`

AuthController_refresh

**Operation ID:** `AuthController_refresh`  
**Security:** none declared

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/internal/auth/sessions`

AuthController_sessions

**Operation ID:** `AuthController_sessions`  
**Security:** `bearer`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `DELETE /api/v1/internal/auth/sessions/{sessionId}`

AuthController_revokeSession

**Operation ID:** `AuthController_revokeSession`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `sessionId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

## authenticated client releases

### `GET /api/v1/client/projects/{projectSlug}/releases`

ClientReleaseController_list

**Operation ID:** `ClientReleaseController_list`  
**Security:** `bearer`

| Parameter     | In    | Required | Type   | Description                                   |
| ------------- | ----- | -------- | ------ | --------------------------------------------- |
| `projectSlug` | path  | yes      | string | —                                             |
| `pageSize`    | query | no       | number | Results per page, from 1 to 100 (default 20). |
| `page`        | query | no       | number | 1-based page number (default 1).              |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/client/projects/{projectSlug}/releases/{version}/attachments/{attachmentId}/download`

ClientReleaseController_downloadAttachment

**Operation ID:** `ClientReleaseController_downloadAttachment`  
**Security:** `bearer`

| Parameter      | In   | Required | Type   | Description |
| -------------- | ---- | -------- | ------ | ----------- |
| `projectSlug`  | path | yes      | string | —           |
| `version`      | path | yes      | string | —           |
| `attachmentId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

## client visibility administration

### `GET /api/v1/internal/projects/{projectId}/client-audiences`

ClientAudienceAdminController_list

**Operation ID:** `ClientAudienceAdminController_list`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/projects/{projectId}/client-audiences`

ClientAudienceAdminController_create

**Operation ID:** `ClientAudienceAdminController_create`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `CreateClientAudienceInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

### `PATCH /api/v1/internal/projects/{projectId}/members/{membershipId}/client-audience`

ClientAudienceAdminController_assign

**Operation ID:** `ClientAudienceAdminController_assign`  
**Security:** `bearer`

| Parameter      | In   | Required | Type   | Description |
| -------------- | ---- | -------- | ------ | ----------- |
| `projectId`    | path | yes      | string | —           |
| `membershipId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `AssignClientAudienceInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

## deployment orchestration

### `GET /api/v1/internal/projects/{projectId}/deployment-trigger-requests/{requestId}`

DeploymentOrchestrationController_getRequest

**Operation ID:** `DeploymentOrchestrationController_getRequest`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |
| `requestId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `PATCH /api/v1/internal/projects/{projectId}/deployment-trigger-requests/{requestId}/status`

DeploymentOrchestrationController_updateStatus

**Operation ID:** `DeploymentOrchestrationController_updateStatus`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |
| `requestId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `DeploymentStatusInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/internal/projects/{projectId}/environments/{environmentId}/deployment-policy`

DeploymentOrchestrationController_getPolicy

**Operation ID:** `DeploymentOrchestrationController_getPolicy`  
**Security:** `bearer`

| Parameter       | In   | Required | Type   | Description |
| --------------- | ---- | -------- | ------ | ----------- |
| `projectId`     | path | yes      | string | —           |
| `environmentId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `PATCH /api/v1/internal/projects/{projectId}/environments/{environmentId}/deployment-policy`

DeploymentOrchestrationController_setPolicy

**Operation ID:** `DeploymentOrchestrationController_setPolicy`  
**Security:** `bearer`

| Parameter       | In   | Required | Type   | Description |
| --------------- | ---- | -------- | ------ | ----------- |
| `projectId`     | path | yes      | string | —           |
| `environmentId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `DeploymentPolicyInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/projects/{projectId}/releases/{releaseId}/deployment-trigger-requests`

DeploymentOrchestrationController_requestTrigger

**Operation ID:** `DeploymentOrchestrationController_requestTrigger`  
**Security:** `bearer`

| Parameter         | In     | Required | Type   | Description |
| ----------------- | ------ | -------- | ------ | ----------- |
| `projectId`       | path   | yes      | string | —           |
| `releaseId`       | path   | yes      | string | —           |
| `idempotency-key` | header | yes      | string | —           |

**Request body (required):** `application/json`: `DeploymentTriggerInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

### `GET /api/v1/internal/projects/{projectId}/releases/{releaseId}/deployment-trigger-requests`

DeploymentOrchestrationController_listRequests

**Operation ID:** `DeploymentOrchestrationController_listRequests`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |
| `releaseId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

## deployment runner callbacks

### `POST /api/v1/internal/deployment-orchestration/runner/requests/{requestId}/status`

DeploymentRunnerController_report

**Operation ID:** `DeploymentRunnerController_report`  
**Security:** none declared

| Parameter          | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `requestId`        | path   | yes      | string | —           |
| `x-rdps-timestamp` | header | yes      | string | —           |
| `x-rdps-signature` | header | yes      | string | —           |

**Request body (required):** `application/json`: `DeploymentRunnerStatusInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

## deployment worker callbacks

### `POST /api/v1/internal/deployment-orchestration/worker/requests/{requestId}/status`

DeploymentWorkerController_report

**Operation ID:** `DeploymentWorkerController_report`  
**Security:** none declared

| Parameter              | In     | Required | Type   | Description |
| ---------------------- | ------ | -------- | ------ | ----------- |
| `requestId`            | path   | yes      | string | —           |
| `x-rdps-worker-secret` | header | yes      | string | —           |

**Request body (required):** `application/json`: `DeploymentWorkerStatusInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

## GitHub App

### `GET /api/v1/internal/projects/{projectId}/github-app`

GitHubAppController_status

**Operation ID:** `GitHubAppController_status`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/projects/{projectId}/github-app/installations`

GitHubAppController_install

**Operation ID:** `GitHubAppController_install`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

### `DELETE /api/v1/internal/projects/{projectId}/github-app/installations/{installationId}`

GitHubAppController_disconnectInstallation

**Operation ID:** `GitHubAppController_disconnectInstallation`  
**Security:** `bearer`

| Parameter        | In   | Required | Type   | Description |
| ---------------- | ---- | -------- | ------ | ----------- |
| `projectId`      | path | yes      | string | —           |
| `installationId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/internal/projects/{projectId}/github-app/installations/{installationId}/repositories`

GitHubAppController_discover

**Operation ID:** `GitHubAppController_discover`  
**Security:** `bearer`

| Parameter        | In   | Required | Type   | Description |
| ---------------- | ---- | -------- | ------ | ----------- |
| `projectId`      | path | yes      | string | —           |
| `installationId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/projects/{projectId}/github-app/installations/{installationId}/repositories`

GitHubAppController_link

**Operation ID:** `GitHubAppController_link`  
**Security:** `bearer`

| Parameter        | In   | Required | Type   | Description |
| ---------------- | ---- | -------- | ------ | ----------- |
| `projectId`      | path | yes      | string | —           |
| `installationId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `LinkRepositoryInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

### `DELETE /api/v1/internal/projects/{projectId}/github-app/repositories/{repositoryId}`

GitHubAppController_disconnectRepository

**Operation ID:** `GitHubAppController_disconnectRepository`  
**Security:** `bearer`

| Parameter      | In   | Required | Type   | Description |
| -------------- | ---- | -------- | ------ | ----------- |
| `projectId`    | path | yes      | string | —           |
| `repositoryId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

## GitHub App webhooks

### `GET /api/v1/integrations/github-app/callback`

GitHubAppWebhookController_callback

**Operation ID:** `GitHubAppWebhookController_callback`  
**Security:** none declared

| Parameter         | In    | Required | Type   | Description |
| ----------------- | ----- | -------- | ------ | ----------- |
| `state`           | query | yes      | string | —           |
| `installation_id` | query | yes      | string | —           |
| `setup_action`    | query | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/integrations/github-app/webhook`

GitHubAppWebhookController_webhook

**Operation ID:** `GitHubAppWebhookController_webhook`  
**Security:** none declared

| Parameter             | In     | Required | Type   | Description |
| --------------------- | ------ | -------- | ------ | ----------- |
| `x-hub-signature-256` | header | yes      | string | —           |
| `x-github-delivery`   | header | yes      | string | —           |
| `x-github-event`      | header | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 202    | —           | —        |

## health

### `GET /api/v1/health`

Check API process health

**Operation ID:** `HealthController_getHealth`  
**Security:** none declared

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/health/ready`

Check API database and Redis readiness

**Operation ID:** `HealthController_getReadiness`  
**Security:** none declared

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

## internal AI summaries

### `POST /api/v1/internal/releases/{releaseId}/ai-summary-suggestions`

AiSummariesController_suggest

**Operation ID:** `AiSummariesController_suggest`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `releaseId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

## internal analytics

### `GET /api/v1/internal/projects/{projectId}/analytics`

ProjectAnalyticsController_dashboard

**Operation ID:** `ProjectAnalyticsController_dashboard`  
**Security:** `bearer`

| Parameter   | In    | Required | Type   | Description |
| ----------- | ----- | -------- | ------ | ----------- |
| `projectId` | path  | yes      | string | —           |
| `days`      | query | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/projects/{projectId}/analytics/exports`

ProjectAnalyticsController_createExport

**Operation ID:** `ProjectAnalyticsController_createExport`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `ExportInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

### `GET /api/v1/internal/projects/{projectId}/analytics/exports`

ProjectAnalyticsController_listExports

**Operation ID:** `ProjectAnalyticsController_listExports`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/internal/projects/{projectId}/analytics/exports/{exportId}/download`

ProjectAnalyticsController_download

**Operation ID:** `ProjectAnalyticsController_download`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |
| `exportId`  | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

## internal integration operations

### `GET /api/v1/internal/projects/{projectId}/integration-operations`

IntegrationOperationsController_list

**Operation ID:** `IntegrationOperationsController_list`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/projects/{projectId}/integration-operations/events/{eventId}/retry`

IntegrationOperationsController_retry

**Operation ID:** `IntegrationOperationsController_retry`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |
| `eventId`   | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

## internal integrations

### `GET /api/v1/internal/projects/{projectId}/integration-suggestions`

IntegrationSuggestionsController_list

**Operation ID:** `IntegrationSuggestionsController_list`  
**Security:** `bearer`

| Parameter   | In    | Required | Type   | Description |
| ----------- | ----- | -------- | ------ | ----------- |
| `projectId` | path  | yes      | string | —           |
| `limit`     | query | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `PATCH /api/v1/internal/projects/{projectId}/integration-suggestions/{suggestionId}/accept`

IntegrationSuggestionsController_accept

**Operation ID:** `IntegrationSuggestionsController_accept`  
**Security:** `bearer`

| Parameter      | In   | Required | Type   | Description |
| -------------- | ---- | -------- | ------ | ----------- |
| `projectId`    | path | yes      | string | —           |
| `suggestionId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `AcceptSuggestionInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `PATCH /api/v1/internal/projects/{projectId}/integration-suggestions/{suggestionId}/dismiss`

IntegrationSuggestionsController_dismiss

**Operation ID:** `IntegrationSuggestionsController_dismiss`  
**Security:** `bearer`

| Parameter      | In   | Required | Type   | Description |
| -------------- | ---- | -------- | ------ | ----------- |
| `projectId`    | path | yes      | string | —           |
| `suggestionId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

## internal notifications

### `GET /api/v1/internal/projects/{projectId}/subscriptions`

ProjectNotificationsController_list

**Operation ID:** `ProjectNotificationsController_list`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `PATCH /api/v1/internal/projects/{projectId}/subscriptions/{subscriptionId}/preferences`

ProjectNotificationsController_update

**Operation ID:** `ProjectNotificationsController_update`  
**Security:** `bearer`

| Parameter        | In   | Required | Type   | Description |
| ---------------- | ---- | -------- | ------ | ----------- |
| `projectId`      | path | yes      | string | —           |
| `subscriptionId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `PreferencesInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/internal/projects/{projectId}/subscriptions/releases/{releaseId}`

ProjectNotificationsController_listRelease

**Operation ID:** `ProjectNotificationsController_listRelease`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |
| `releaseId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `PATCH /api/v1/internal/projects/{projectId}/subscriptions/releases/{releaseId}/{subscriptionId}/preferences`

ProjectNotificationsController_updateRelease

**Operation ID:** `ProjectNotificationsController_updateRelease`  
**Security:** `bearer`

| Parameter        | In   | Required | Type   | Description |
| ---------------- | ---- | -------- | ------ | ----------- |
| `projectId`      | path | yes      | string | —           |
| `releaseId`      | path | yes      | string | —           |
| `subscriptionId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `PreferencesInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

## internal project domains

### `GET /api/v1/internal/projects/{projectId}/brand/custom-domain`

CustomDomainsController_status

**Operation ID:** `CustomDomainsController_status`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/projects/{projectId}/brand/custom-domain`

CustomDomainsController_requestVerification

**Operation ID:** `CustomDomainsController_requestVerification`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `RequestCustomDomainInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

### `DELETE /api/v1/internal/projects/{projectId}/brand/custom-domain`

CustomDomainsController_remove

**Operation ID:** `CustomDomainsController_remove`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/projects/{projectId}/brand/custom-domain/verify`

CustomDomainsController_verify

**Operation ID:** `CustomDomainsController_verify`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

## internal project public page

### `GET /api/v1/internal/projects/{projectId}/public-page`

PublicPageController_get

**Operation ID:** `PublicPageController_get`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `PUT /api/v1/internal/projects/{projectId}/public-page/draft`

PublicPageController_saveDraft

**Operation ID:** `PublicPageController_saveDraft`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `SavePublicPageDraftInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/projects/{projectId}/public-page/publish`

PublicPageController_publish

**Operation ID:** `PublicPageController_publish`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

## internal projects

### `GET /api/v1/internal/projects`

ProjectsController_list

**Operation ID:** `ProjectsController_list`  
**Security:** `bearer`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/projects`

ProjectsController_create

**Operation ID:** `ProjectsController_create`  
**Security:** `bearer`

**Request body (required):** `application/json`: `CreateProjectInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

### `GET /api/v1/internal/projects/{projectId}`

ProjectsController_get

**Operation ID:** `ProjectsController_get`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `PATCH /api/v1/internal/projects/{projectId}`

ProjectsController_update

**Operation ID:** `ProjectsController_update`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `UpdateProjectInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/internal/projects/{projectId}/audit`

ProjectsController_listAuditEvents

**Operation ID:** `ProjectsController_listAuditEvents`  
**Security:** `bearer`

| Parameter   | In    | Required | Type   | Description |
| ----------- | ----- | -------- | ------ | ----------- |
| `projectId` | path  | yes      | string | —           |
| `page`      | query | yes      | string | —           |
| `pageSize`  | query | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/internal/projects/{projectId}/audit/export.csv`

ProjectsController_exportAuditEvents

**Operation ID:** `ProjectsController_exportAuditEvents`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/internal/projects/{projectId}/brand`

ProjectsController_getBrand

**Operation ID:** `ProjectsController_getBrand`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `PATCH /api/v1/internal/projects/{projectId}/brand`

ProjectsController_updateBrand

**Operation ID:** `ProjectsController_updateBrand`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `UpdateProjectBrandInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/internal/projects/{projectId}/environments`

ProjectsController_listEnvironments

**Operation ID:** `ProjectsController_listEnvironments`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `PATCH /api/v1/internal/projects/{projectId}/environments/{environmentId}`

ProjectsController_updateEnvironment

**Operation ID:** `ProjectsController_updateEnvironment`  
**Security:** `bearer`

| Parameter       | In   | Required | Type   | Description |
| --------------- | ---- | -------- | ------ | ----------- |
| `projectId`     | path | yes      | string | —           |
| `environmentId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `UpdateEnvironmentInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/internal/projects/{projectId}/members`

ProjectsController_listMembers

**Operation ID:** `ProjectsController_listMembers`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/projects/{projectId}/members`

ProjectsController_addMember

**Operation ID:** `ProjectsController_addMember`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `AddProjectMemberInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

### `PATCH /api/v1/internal/projects/{projectId}/members/{membershipId}`

ProjectsController_updateMemberRole

**Operation ID:** `ProjectsController_updateMemberRole`  
**Security:** `bearer`

| Parameter      | In   | Required | Type   | Description |
| -------------- | ---- | -------- | ------ | ----------- |
| `projectId`    | path | yes      | string | —           |
| `membershipId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `UpdateProjectMemberInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `DELETE /api/v1/internal/projects/{projectId}/members/{membershipId}`

ProjectsController_removeMember

**Operation ID:** `ProjectsController_removeMember`  
**Security:** `bearer`

| Parameter      | In   | Required | Type   | Description |
| -------------- | ---- | -------- | ------ | ----------- |
| `projectId`    | path | yes      | string | —           |
| `membershipId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/internal/projects/{projectId}/repositories`

ProjectsController_listRepositories

**Operation ID:** `ProjectsController_listRepositories`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/projects/{projectId}/repositories`

ProjectsController_addRepository

**Operation ID:** `ProjectsController_addRepository`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `CreateRepositoryInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

### `DELETE /api/v1/internal/projects/{projectId}/repositories/{repositoryId}`

ProjectsController_removeRepository

**Operation ID:** `ProjectsController_removeRepository`  
**Security:** `bearer`

| Parameter      | In   | Required | Type   | Description |
| -------------- | ---- | -------- | ------ | ----------- |
| `projectId`    | path | yes      | string | —           |
| `repositoryId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

## internal publishing

### `GET /api/v1/internal/approval-revisions`

ApprovalQueueController_list

**Operation ID:** `ApprovalQueueController_list`  
**Security:** `bearer`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/internal/approval-revisions/ready-to-publish`

ApprovalQueueController_readyToPublish

**Operation ID:** `ApprovalQueueController_readyToPublish`  
**Security:** `bearer`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/releases/{releaseId}/approval-revisions`

PublishingController_submit

**Operation ID:** `PublishingController_submit`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `releaseId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

### `PATCH /api/v1/internal/releases/{releaseId}/approval-revisions/{revisionId}/approve`

PublishingController_approve

**Operation ID:** `PublishingController_approve`  
**Security:** `bearer`

| Parameter    | In   | Required | Type   | Description |
| ------------ | ---- | -------- | ------ | ----------- |
| `releaseId`  | path | yes      | string | —           |
| `revisionId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `ReviewComment`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/releases/{releaseId}/approval-revisions/{revisionId}/publish`

PublishingController_publish

**Operation ID:** `PublishingController_publish`  
**Security:** `bearer`

| Parameter    | In   | Required | Type   | Description |
| ------------ | ---- | -------- | ------ | ----------- |
| `releaseId`  | path | yes      | string | —           |
| `revisionId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

### `PATCH /api/v1/internal/releases/{releaseId}/approval-revisions/{revisionId}/reject`

PublishingController_reject

**Operation ID:** `PublishingController_reject`  
**Security:** `bearer`

| Parameter    | In   | Required | Type   | Description |
| ------------ | ---- | -------- | ------ | ----------- |
| `releaseId`  | path | yes      | string | —           |
| `revisionId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `ReviewComment`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/releases/{releaseId}/publications/{publicationId}/unpublish`

PublishingController_unpublish

**Operation ID:** `PublishingController_unpublish`  
**Security:** `bearer`

| Parameter       | In   | Required | Type   | Description |
| --------------- | ---- | -------- | ------ | ----------- |
| `releaseId`     | path | yes      | string | —           |
| `publicationId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

## internal releases

### `GET /api/v1/internal/projects/{projectId}/releases`

ReleasesController_list

**Operation ID:** `ReleasesController_list`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/projects/{projectId}/releases`

ReleasesController_create

**Operation ID:** `ReleasesController_create`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `CreateReleaseInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

### `GET /api/v1/internal/projects/{projectId}/releases/compare`

ReleasesController_compare

**Operation ID:** `ReleasesController_compare`  
**Security:** `bearer`

| Parameter   | In    | Required | Type   | Description |
| ----------- | ----- | -------- | ------ | ----------- |
| `projectId` | path  | yes      | string | —           |
| `from`      | query | yes      | string | —           |
| `to`        | query | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/internal/projects/{projectId}/releases/compare/export`

ReleasesController_exportComparison

**Operation ID:** `ReleasesController_exportComparison`  
**Security:** `bearer`

| Parameter   | In    | Required | Type   | Description |
| ----------- | ----- | -------- | ------ | ----------- |
| `projectId` | path  | yes      | string | —           |
| `from`      | query | yes      | string | —           |
| `to`        | query | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/internal/releases/{releaseId}`

ReleasesController_get

**Operation ID:** `ReleasesController_get`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `releaseId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `PATCH /api/v1/internal/releases/{releaseId}`

ReleasesController_update

**Operation ID:** `ReleasesController_update`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `releaseId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `UpdateReleaseInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `PATCH /api/v1/internal/releases/{releaseId}/archive`

ReleasesController_archive

**Operation ID:** `ReleasesController_archive`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `releaseId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/internal/releases/{releaseId}/audience`

ReleasesController_getAudience

**Operation ID:** `ReleasesController_getAudience`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `releaseId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `PATCH /api/v1/internal/releases/{releaseId}/audience`

ReleasesController_setAudience

**Operation ID:** `ReleasesController_setAudience`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `releaseId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `SetReleaseAudienceInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/releases/{releaseId}/changes`

ReleasesController_addChange

**Operation ID:** `ReleasesController_addChange`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `releaseId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `CreateChangeInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

### `PATCH /api/v1/internal/releases/{releaseId}/changes/{changeId}`

ReleasesController_updateChange

**Operation ID:** `ReleasesController_updateChange`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `releaseId` | path | yes      | string | —           |
| `changeId`  | path | yes      | string | —           |

**Request body (required):** `application/json`: `CreateChangeInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `PATCH /api/v1/internal/releases/{releaseId}/changes/bulk`

ReleasesController_bulkUpdateChanges

**Operation ID:** `ReleasesController_bulkUpdateChanges`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `releaseId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `BulkUpdateChangesInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/internal/releases/{releaseId}/export.csv`

ReleasesController_exportCsv

**Operation ID:** `ReleasesController_exportCsv`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `releaseId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `PATCH /api/v1/internal/releases/{releaseId}/submit-review`

ReleasesController_submitForReview

**Operation ID:** `ReleasesController_submitForReview`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `releaseId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `PUT /api/v1/internal/releases/{releaseId}/translations/{locale}`

ReleasesController_saveTranslation

**Operation ID:** `ReleasesController_saveTranslation`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `releaseId` | path | yes      | string | —           |
| `locale`    | path | yes      | string | —           |

**Request body (required):** `application/json`: `ReleaseTranslationInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/internal/search`

ReleasesController_search

**Operation ID:** `ReleasesController_search`  
**Security:** `bearer`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

## internal users

### `GET /api/v1/internal/users`

UsersController_list

**Operation ID:** `UsersController_list`  
**Security:** `bearer`

| Parameter | In    | Required | Type   | Description |
| --------- | ----- | -------- | ------ | ----------- |
| `q`       | query | no       | string | —           |
| `status`  | query | no       | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `PATCH /api/v1/internal/users/{userId}`

UsersController_update

**Operation ID:** `UsersController_update`  
**Security:** `bearer`

| Parameter | In   | Required | Type   | Description |
| --------- | ---- | -------- | ------ | ----------- |
| `userId`  | path | yes      | string | —           |

**Request body (required):** `application/json`: `UpdateUserInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/users/{userId}/password-link`

UsersController_issuePasswordLink

**Operation ID:** `UsersController_issuePasswordLink`  
**Security:** `bearer`

| Parameter | In   | Required | Type   | Description |
| --------- | ---- | -------- | ------ | ----------- |
| `userId`  | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

## notification worker

### `POST /api/v1/internal/notifications/worker/deliveries/{id}/dead`

NotificationWorkerController_dead

**Operation ID:** `NotificationWorkerController_dead`  
**Security:** none declared

| Parameter              | In     | Required | Type   | Description |
| ---------------------- | ------ | -------- | ------ | ----------- |
| `id`                   | path   | yes      | string | —           |
| `x-rdps-worker-secret` | header | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

### `POST /api/v1/internal/notifications/worker/deliveries/{id}/failed`

NotificationWorkerController_failed

**Operation ID:** `NotificationWorkerController_failed`  
**Security:** none declared

| Parameter              | In     | Required | Type   | Description |
| ---------------------- | ------ | -------- | ------ | ----------- |
| `id`                   | path   | yes      | string | —           |
| `x-rdps-worker-secret` | header | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

### `POST /api/v1/internal/notifications/worker/deliveries/{id}/sent`

NotificationWorkerController_sent

**Operation ID:** `NotificationWorkerController_sent`  
**Security:** none declared

| Parameter              | In     | Required | Type   | Description |
| ---------------------- | ------ | -------- | ------ | ----------- |
| `id`                   | path   | yes      | string | —           |
| `x-rdps-worker-secret` | header | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

## public analytics

### `POST /api/v1/public/analytics/events`

PublicAnalyticsController_record

**Operation ID:** `PublicAnalyticsController_record`  
**Security:** none declared

**Request body (required):** `application/json`: `PublicEventInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

## public delivery

### `GET /api/v1/public/host`

PublicController_resolveHost

**Operation ID:** `PublicController_resolveHost`  
**Security:** none declared

| Parameter  | In    | Required | Type | Description |
| ---------- | ----- | -------- | ---- | ----------- |
| `hostname` | query | yes      | {}   | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/public/projects/{slug}`

PublicController_project

**Operation ID:** `PublicController_project`  
**Security:** none declared

| Parameter | In    | Required | Type   | Description |
| --------- | ----- | -------- | ------ | ----------- |
| `slug`    | path  | yes      | string | —           |
| `locale`  | query | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/public/projects/{slug}/changelog`

PublicController_changelog

**Operation ID:** `PublicController_changelog`  
**Security:** none declared

| Parameter  | In    | Required | Type   | Description |
| ---------- | ----- | -------- | ------ | ----------- |
| `slug`     | path  | yes      | string | —           |
| `locale`   | query | yes      | string | —           |
| `pageSize` | query | no       | number | —           |
| `page`     | query | no       | number | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/public/projects/{slug}/page`

PublicPageDeliveryController_page

**Operation ID:** `PublicPageDeliveryController_page`  
**Security:** none declared

| Parameter | In   | Required | Type   | Description |
| --------- | ---- | -------- | ------ | ----------- |
| `slug`    | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/public/projects/{slug}/releases`

PublicController_releases

**Operation ID:** `PublicController_releases`  
**Security:** none declared

| Parameter  | In    | Required | Type   | Description |
| ---------- | ----- | -------- | ------ | ----------- |
| `slug`     | path  | yes      | string | —           |
| `locale`   | query | yes      | string | —           |
| `pageSize` | query | no       | number | —           |
| `page`     | query | no       | number | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/public/projects/{slug}/releases/{version}`

PublicController_release

**Operation ID:** `PublicController_release`  
**Security:** none declared

| Parameter | In    | Required | Type   | Description |
| --------- | ----- | -------- | ------ | ----------- |
| `slug`    | path  | yes      | string | —           |
| `version` | path  | yes      | string | —           |
| `locale`  | query | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/public/projects/{slug}/releases/{version}/attachments/{attachmentId}/download`

PublicController_downloadAttachment

**Operation ID:** `PublicController_downloadAttachment`  
**Security:** none declared

| Parameter      | In   | Required | Type   | Description |
| -------------- | ---- | -------- | ------ | ----------- |
| `slug`         | path | yes      | string | —           |
| `version`      | path | yes      | string | —           |
| `attachmentId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/public/projects/{slug}/releases/{version}/changes`

PublicController_changes

**Operation ID:** `PublicController_changes`  
**Security:** none declared

| Parameter | In    | Required | Type   | Description |
| --------- | ----- | -------- | ------ | ----------- |
| `slug`    | path  | yes      | string | —           |
| `version` | path  | yes      | string | —           |
| `locale`  | query | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/public/projects/{slug}/releases/{version}/share`

PublicController_shareRelease

**Operation ID:** `PublicController_shareRelease`  
**Security:** none declared

| Parameter | In    | Required | Type   | Description |
| --------- | ----- | -------- | ------ | ----------- |
| `slug`    | path  | yes      | string | —           |
| `version` | path  | yes      | string | —           |
| `locale`  | query | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/public/projects/{slug}/releases/latest`

PublicController_latest

**Operation ID:** `PublicController_latest`  
**Security:** none declared

| Parameter | In    | Required | Type   | Description |
| --------- | ----- | -------- | ------ | ----------- |
| `slug`    | path  | yes      | string | —           |
| `locale`  | query | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/public/projects/{slug}/rss.xml`

PublicController_rss

**Operation ID:** `PublicController_rss`  
**Security:** none declared

| Parameter | In    | Required | Type   | Description |
| --------- | ----- | -------- | ------ | ----------- |
| `slug`    | path  | yes      | string | —           |
| `locale`  | query | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/public/projects/{slug}/search`

PublicController_search

**Operation ID:** `PublicController_search`  
**Security:** none declared

| Parameter  | In    | Required | Type   | Description |
| ---------- | ----- | -------- | ------ | ----------- |
| `slug`     | path  | yes      | string | —           |
| `locale`   | query | yes      | string | —           |
| `pageSize` | query | no       | number | —           |
| `page`     | query | no       | number | —           |
| `q`        | query | yes      | {}     | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/public/projects/{slug}/share`

PublicController_shareProject

**Operation ID:** `PublicController_shareProject`  
**Security:** none declared

| Parameter | In    | Required | Type   | Description |
| --------- | ----- | -------- | ------ | ----------- |
| `slug`    | path  | yes      | string | —           |
| `locale`  | query | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

## public subscriptions

### `POST /api/v1/public/projects/{slug}/releases/{releaseId}/subscriptions`

PublicNotificationsController_subscribeRelease

**Operation ID:** `PublicNotificationsController_subscribeRelease`  
**Security:** none declared

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `slug`      | path | yes      | string | —           |
| `releaseId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `SubscribeInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

### `POST /api/v1/public/projects/{slug}/subscriptions`

PublicNotificationsController_subscribe

**Operation ID:** `PublicNotificationsController_subscribe`  
**Security:** none declared

| Parameter | In   | Required | Type   | Description |
| --------- | ---- | -------- | ------ | ----------- |
| `slug`    | path | yes      | string | —           |

**Request body (required):** `application/json`: `SubscribeInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

### `POST /api/v1/public/subscriptions/unsubscribe`

PublicNotificationsController_unsubscribe

**Operation ID:** `PublicNotificationsController_unsubscribe`  
**Security:** none declared

**Request body (required):** `application/json`: `TokenInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

### `POST /api/v1/public/subscriptions/verify`

PublicNotificationsController_confirm

**Operation ID:** `PublicNotificationsController_confirm`  
**Security:** none declared

**Request body (required):** `application/json`: `TokenInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

## release content

### `GET /api/v1/internal/projects/{projectId}/releases/{releaseId}/attachments`

ReleaseContentController_listAttachments

**Operation ID:** `ReleaseContentController_listAttachments`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |
| `releaseId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/projects/{projectId}/releases/{releaseId}/attachments`

ReleaseContentController_uploadAttachment

**Operation ID:** `ReleaseContentController_uploadAttachment`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |
| `releaseId` | path | yes      | string | —           |

**Request body (required):** `multipart/form-data`: object

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

### `GET /api/v1/internal/projects/{projectId}/releases/{releaseId}/attachments/{attachmentId}/download`

ReleaseContentController_downloadPrivate

**Operation ID:** `ReleaseContentController_downloadPrivate`  
**Security:** `bearer`

| Parameter      | In   | Required | Type   | Description |
| -------------- | ---- | -------- | ------ | ----------- |
| `projectId`    | path | yes      | string | —           |
| `attachmentId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `PATCH /api/v1/internal/projects/{projectId}/releases/{releaseId}/attachments/{attachmentId}/public`

ReleaseContentController_setAttachmentPublic

**Operation ID:** `ReleaseContentController_setAttachmentPublic`  
**Security:** `bearer`

| Parameter      | In   | Required | Type   | Description |
| -------------- | ---- | -------- | ------ | ----------- |
| `projectId`    | path | yes      | string | —           |
| `attachmentId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `PublicAttachmentInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/projects/{projectId}/releases/{releaseId}/attachments/{attachmentId}/scan`

ReleaseContentController_scanAttachment

**Operation ID:** `ReleaseContentController_scanAttachment`  
**Security:** `bearer`

| Parameter      | In   | Required | Type   | Description |
| -------------- | ---- | -------- | ------ | ----------- |
| `projectId`    | path | yes      | string | —           |
| `attachmentId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

### `GET /api/v1/internal/projects/{projectId}/releases/{releaseId}/deployments`

ReleaseContentController_listDeployments

**Operation ID:** `ReleaseContentController_listDeployments`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |
| `releaseId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/projects/{projectId}/releases/{releaseId}/deployments`

ReleaseContentController_createDeployment

**Operation ID:** `ReleaseContentController_createDeployment`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |
| `releaseId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `DeploymentInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

### `PATCH /api/v1/internal/projects/{projectId}/releases/{releaseId}/deployments/{deploymentId}`

ReleaseContentController_updateDeployment

**Operation ID:** `ReleaseContentController_updateDeployment`  
**Security:** `bearer`

| Parameter      | In   | Required | Type   | Description |
| -------------- | ---- | -------- | ------ | ----------- |
| `projectId`    | path | yes      | string | —           |
| `deploymentId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `DeploymentUpdateInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `GET /api/v1/internal/projects/{projectId}/releases/{releaseId}/documents`

ReleaseContentController_listDocuments

**Operation ID:** `ReleaseContentController_listDocuments`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |
| `releaseId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `POST /api/v1/internal/projects/{projectId}/releases/{releaseId}/documents`

ReleaseContentController_createDocument

**Operation ID:** `ReleaseContentController_createDocument`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |
| `releaseId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `DocumentInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 201    | —           | —        |

### `GET /api/v1/internal/projects/{projectId}/releases/{releaseId}/documents/{documentId}`

ReleaseContentController_getDocument

**Operation ID:** `ReleaseContentController_getDocument`  
**Security:** `bearer`

| Parameter    | In   | Required | Type   | Description |
| ------------ | ---- | -------- | ------ | ----------- |
| `projectId`  | path | yes      | string | —           |
| `documentId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `PATCH /api/v1/internal/projects/{projectId}/releases/{releaseId}/documents/{documentId}`

ReleaseContentController_updateDocument

**Operation ID:** `ReleaseContentController_updateDocument`  
**Security:** `bearer`

| Parameter    | In   | Required | Type   | Description |
| ------------ | ---- | -------- | ------ | ----------- |
| `projectId`  | path | yes      | string | —           |
| `documentId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `DocumentUpdateInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `DELETE /api/v1/internal/projects/{projectId}/releases/{releaseId}/documents/{documentId}`

ReleaseContentController_deleteDocument

**Operation ID:** `ReleaseContentController_deleteDocument`  
**Security:** `bearer`

| Parameter    | In   | Required | Type   | Description |
| ------------ | ---- | -------- | ------ | ----------- |
| `projectId`  | path | yes      | string | —           |
| `documentId` | path | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

### `PATCH /api/v1/internal/projects/{projectId}/releases/{releaseId}/documents/reorder`

ReleaseContentController_reorderDocuments

**Operation ID:** `ReleaseContentController_reorderDocuments`  
**Security:** `bearer`

| Parameter   | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `projectId` | path | yes      | string | —           |
| `releaseId` | path | yes      | string | —           |

**Request body (required):** `application/json`: `ReorderInput`

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

## Webhook

### `POST /api/v1/integrations/deployments/webhook`

WebhookController_deployment

**Operation ID:** `WebhookController_deployment`  
**Security:** none declared

| Parameter            | In     | Required | Type   | Description |
| -------------------- | ------ | -------- | ------ | ----------- |
| `x-rdps-signature`   | header | yes      | string | —           |
| `x-rdps-timestamp`   | header | yes      | string | —           |
| `x-rdps-delivery-id` | header | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 202    | —           | —        |

### `POST /api/v1/integrations/github/webhook`

WebhookController_github

**Operation ID:** `WebhookController_github`  
**Security:** none declared

| Parameter             | In     | Required | Type   | Description |
| --------------------- | ------ | -------- | ------ | ----------- |
| `x-hub-signature-256` | header | yes      | string | —           |
| `x-github-delivery`   | header | yes      | string | —           |
| `x-github-event`      | header | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 202    | —           | —        |

## WebhookProcessing

### `POST /api/v1/integrations/internal/webhook-events/{eventId}/process`

WebhookProcessingController_process

**Operation ID:** `WebhookProcessingController_process`  
**Security:** none declared

| Parameter             | In     | Required | Type   | Description |
| --------------------- | ------ | -------- | ------ | ----------- |
| `eventId`             | path   | yes      | string | —           |
| `x-rdps-worker-token` | header | yes      | string | —           |

| Status | Description | Response |
| ------ | ----------- | -------- |
| 200    | —           | —        |

## Schemas

### `AcceptInvitationInput`

Schema: object

### `AcceptSuggestionInput`

| Property    | Required | Type          | Description |
| ----------- | -------- | ------------- | ----------- |
| `releaseId` | yes      | string (uuid) | —           |

### `AddProjectMemberInput`

Schema: object

### `AssignClientAudienceInput`

Schema: object

### `BootstrapInput`

Schema: object

### `BulkUpdateChangesInput`

Schema: object

### `ChangePasswordInput`

Schema: object

### `CompletePasswordResetInput`

Schema: object

### `CreateChangeInput`

Schema: object

### `CreateClientAudienceInput`

Schema: object

### `CreateProjectInput`

Schema: object

### `CreateReleaseInput`

Schema: object

### `CreateRepositoryInput`

Schema: object

### `DeploymentInput`

Schema: object

### `DeploymentPolicyInput`

Schema: object

### `DeploymentRunnerStatusInput`

Schema: object

### `DeploymentStatusInput`

Schema: object

### `DeploymentTriggerInput`

Schema: object

### `DeploymentUpdateInput`

Schema: object

### `DeploymentWorkerStatusInput`

Schema: object

### `DocumentInput`

Schema: object

### `DocumentUpdateInput`

Schema: object

### `ExportInput`

Schema: object

### `LinkRepositoryInput`

Schema: object

### `LoginInput`

Schema: object

### `PreferencesInput`

Schema: object

### `PublicAttachmentInput`

Schema: object

### `PublicEventInput`

Schema: object

### `ReleaseTranslationInput`

Schema: object

### `ReorderInput`

Schema: object

### `RequestCustomDomainInput`

Schema: object

### `ReviewComment`

Schema: object

### `SavePublicPageDraftInput`

Schema: object

### `SetReleaseAudienceInput`

Schema: object

### `SubscribeInput`

Schema: object

### `TokenInput`

Schema: object

### `UpdateEnvironmentInput`

Schema: object

### `UpdateProjectBrandInput`

Schema: object

### `UpdateProjectInput`

Schema: object

### `UpdateProjectMemberInput`

Schema: object

### `UpdateReleaseInput`

Schema: object

### `UpdateUserInput`

Schema: object
