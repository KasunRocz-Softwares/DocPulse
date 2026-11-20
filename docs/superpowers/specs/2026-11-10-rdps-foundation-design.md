# RDPS Foundation Design

**Date:** 2026-11-10  
**Status:** Superseded by the full-product design  
**Source:** Release Documentation & Publishing System PRD (RDPS)

> The MVP-only boundary in this document is retained for history. The active design is [2026-11-10-rdps-full-product-design.md](./2026-11-10-rdps-full-product-design.md).

## Intent

Create the first production-oriented slice of RDPS: a secure internal foundation for managing projects, releases, and release changes. The slice must establish the internal/public data boundary and project-scoped authorization before any public publishing endpoint is implemented.

## PRD review

The PRD has a strong primary principle: one complete internal release record plus a separately approved client-facing publication. The following requirements are architectural anchors:

- Internal records may contain technical, operational, security, and deployment information.
- Public content must be an explicitly approved snapshot, never an internal record with fields hidden in the frontend.
- Access is project-scoped and must be enforced at the API/database boundary.
- Release changes are independently editable and may be selected for future publication.
- Publishing, approvals, permission changes, and other sensitive mutations must be auditable.
- Public publishing, GitHub integration, attachments, environments, and advanced discovery are separate milestones, not prerequisites for the first secure slice.

The PRD leaves authentication, exact permission semantics, and the initial release lifecycle under-specified. This design makes the following MVP calls: local email/password authentication first; JWT access tokens; four internal roles (admin, release manager, developer, reviewer); project membership for authorization; no client accounts; and no self-approval for public content. Company SSO, client-specific visibility, and external identity providers remain extension points.

## Goals

1. Bootstrap a maintainable TypeScript monorepo in the empty repository.
2. Provide authenticated internal API access.
3. Support project creation and project-scoped membership.
4. Support draft releases and structured release changes.
5. Enforce role and project boundaries in API use cases.
6. Produce audit events for authentication, membership, project, release, and change mutations.
7. Make it impossible for the future public module to depend on internal DTOs or query internal records directly.

## Non-goals for this slice

- Public release pages or public API endpoints.
- Approval and immutable-public-snapshot persistence.
- GitHub webhooks, commit/PR linking, background workers, or Redis.
- Rich text editing, attachments, image storage, or S3 integration.
- Environment deployment tracking.
- SSO, client accounts, subscriptions, RSS, analytics, or custom domains.
- Production deployment infrastructure.

## Approaches considered

### Full-stack-first

Implement admin UI, public UI, API, publishing, and integrations together. Rejected for the first slice because the repository is empty and the most important security rule would be buried under too much unverified surface area.

### UI prototype-first

Build screens against mock data. Rejected because it postpones the internal/public isolation and authorization rules that determine the data model.

### Backend-first modular monolith — selected

Use one repository and one deployable API with explicit internal modules and future public/publishing boundaries. This is the PRD’s recommended architecture, minimizes operational complexity, and allows authorization tests to gate later public functionality.

## Architecture

```text
apps/
  api/          NestJS modular monolith; internal routes first
packages/
  types/        shared domain types and API contracts
  validation/   Zod schemas for boundary validation
  config/       typed environment configuration
database/
  prisma/       schema, migrations, and seed data
docs/
  superpowers/  design and implementation records
```

The API is divided by capability rather than by transport only:

- `auth`: register/login/current-user; password hashing; JWT issuance.
- `users`: internal user identity and role assignment.
- `projects`: project metadata and project membership.
- `releases`: draft release lifecycle and version uniqueness.
- `changes`: structured release changes and internal/public-candidate fields.
- `audit`: append-only audit events.

The public API is intentionally absent from this slice. When added, it will consume a dedicated publication snapshot repository/service and dedicated public DTOs; it will not reuse internal release queries.

## MVP authorization model

- `ADMIN`: manage all projects, members, and releases; cannot approve their own public changes when separation of duties applies.
- `RELEASE_MANAGER`: manage assigned projects, releases, and review/approval workflows when not the author.
- `DEVELOPER`: create and edit releases/changes in assigned projects; cannot approve or publish.
- `REVIEWER`: view assigned internal projects and approve public revisions when explicitly assigned; cannot edit release content.

Every protected use case receives the authenticated user and verifies project membership/role before reading or mutating records. Authorization tests must cover cross-project reads and writes, not only happy-path role checks.

## Initial data model

- `User`: id, email, display name, password hash, active state, timestamps.
- `Project`: id, name, unique slug, description, status, timestamps.
- `ProjectMember`: user, project, role, timestamps; unique per user/project.
- `Release`: project, semantic version, title, release type, channel, lifecycle status, release date, internal summary, timestamps; unique by project/version/channel.
- `ReleaseChange`: release, title, category, internal description, optional public description, visibility, approval state, author, sort order, timestamps.
- `AuditLog`: actor, project scope, action, entity type/id, structured metadata, timestamp; append-only by application policy.

The schema will use UUID identifiers, UTC timestamps, database uniqueness constraints, and indexes for project membership, release lookup, and change ordering. Secrets and credentials are prohibited from documentation fields by validation and product policy.

## Initial API surface

All routes are under `/api/v1/internal`.

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
- `GET /projects`
- `POST /projects`
- `GET /projects/:projectId`
- `PATCH /projects/:projectId`
- `GET /projects/:projectId/members`
- `POST /projects/:projectId/members`
- `PATCH /projects/:projectId/members/:userId`
- `GET /projects/:projectId/releases`
- `POST /projects/:projectId/releases`
- `GET /releases/:releaseId`
- `PATCH /releases/:releaseId`
- `POST /releases/:releaseId/changes`
- `PATCH /changes/:changeId`

Mutation endpoints return sanitized internal DTOs. Public DTOs and routes are not created until the approval/snapshot design is implemented.

## Testing and quality gates

- Unit tests for version validation, role permissions, project scoping, and release/change invariants.
- API tests for registration/login/current-user and protected project/release/change routes.
- Database integration tests for uniqueness constraints and audit-event creation.
- No public route may be added until authorization tests pass for cross-project isolation and role boundaries.
- Format, lint, typecheck, and test commands must be reproducible from the repository root.

## Open decisions intentionally deferred

- Whether production authentication uses company SSO or a managed identity provider.
- Exact publication revision schema and immutable snapshot storage.
- Object storage provider and attachment scanning policy.
- GitHub App ownership, webhook delivery, and idempotency strategy.
- Deployment topology, domain names, and infrastructure provider.

## Implementation boundary

The first implementation milestone ends when an authenticated internal user can create a project, assign project members, create a versioned draft release, manage structured changes, and be denied access outside the project scope—with those decisions covered by automated tests and audit events.
