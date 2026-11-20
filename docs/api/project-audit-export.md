# Project audit CSV export

`GET /api/v1/internal/projects/:projectId/audit/export.csv` downloads the full audit history for one project as a CSV attachment. The caller must be a project administrator or system administrator, matching the access rule for `GET /api/v1/internal/projects/:projectId/audit`.

The response uses `Cache-Control: no-store` and the filename `project-audit.csv`. Its columns are `timestamp`, `actor`, `action`, `entity`, and `metadata`. Actor identity is the display name, email, and user ID; deleted or unavailable actors are blank. Entity is written as `entityType:entityId`, and metadata is JSON encoded. Every data cell is quoted, embedded quotes are doubled, and formula-leading values are prefixed with an apostrophe for spreadsheet safety.

The API reads records in descending timestamp and ID order using 500-row cursor pages and streams each page to the response. There is no row limit. A `project.audit_exported` audit event is written before the export query starts, so the export includes its own export event. A failed authorization is rejected before the export event or data query is written.
