# Analytics and exports

## Public event ingestion

`POST /api/v1/public/analytics/events` accepts a deliberately small payload:

```json
{ "projectSlug": "widget", "kind": "PROJECT_VIEW" }
```

For a published release page, send `kind: "RELEASE_VIEW"` and its version. The API accepts a release event only while a non-revoked public snapshot exists. It stores the project, optional snapshot, event kind, UTC calendar day, and server creation time. It does not persist request IP, user agent, referrer, cookies, session keys, or caller-supplied extra fields. Supported kinds are `PROJECT_VIEW` and `RELEASE_VIEW`.

The public web client is intentionally not modified in this change. To enable counts, call the endpoint once when a public project page or release detail page becomes visible; do not send a visitor identifier or request headers as event properties. The API endpoint is ready for this integration.

## Authenticated project APIs

- `GET /api/v1/internal/projects/:projectId/analytics?days=30` returns daily project/release views and the most viewed published releases. `days` is limited to 1–90.
- `POST /api/v1/internal/projects/:projectId/analytics/exports` accepts `{"kind":"ANALYTICS_CSV","days":30}` or `{"kind":"RELEASE_PDF","releaseId":"..."}`.
- `GET /api/v1/internal/projects/:projectId/analytics/exports` lists the latest 20 jobs.
- `GET /api/v1/internal/projects/:projectId/analytics/exports/:exportId/download` streams a completed file with `private, no-store` caching.

Dashboard access requires project membership as Admin, Release Manager, Developer, or Reviewer. Export creation and download require Admin or Release Manager. The PDF renderer receives only the currently published immutable snapshot. Export request, completion, failure, and download are written to the audit log.

## Admin UI integration point

Mount `AnalyticsExportPanel` from `apps/admin-web/src/AnalyticsExportPanel.tsx` in the selected project workspace, passing its `projectId` and the project releases list. Its release list prop is `{ id, version, title, status }[]`; only releases with status `PUBLISHED` are offered for PDF export. This implementation leaves `apps/admin-web/src/main.tsx` and `ProjectAdminPanel.tsx` untouched as requested.

## Worker and operations

The API queues `analytics-exports` jobs in Redis. The worker retries up to five times with exponential backoff and records terminal failures in `analytics-exports-dead-letter`. The API and worker must share `RDPS_WORKER_SHARED_SECRET`, and both need the existing `REDIS_URL` and `RDPS_API_URL` settings. Run the new Prisma migration before starting an API build that imports the generated client.

Events contain no visitor identifiers. Counts are aggregate request counts and are not deduplicated, so automated traffic may affect totals; this design intentionally avoids persistent visitor fingerprinting.
