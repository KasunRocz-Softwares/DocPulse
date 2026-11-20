# RDPS Full Product Design

**Date:** 2026-11-10  
**Status:** Approved for implementation  
**Approval:** User directed implementation to proceed with this full-product design in the Codex conversation.  
**Source:** Release Documentation & Publishing System PRD (RDPS)

## Intent

Build the complete Release Documentation & Publishing System described by the PRD: a multi-project internal release authoring and governance platform plus a separate public release-notes delivery platform. The product must support the entire release lifecycle from source changes through reviewed, immutable, version-specific public publications.

The design treats the PRD's P0, P1, and P2 delivery phases as part of the target product. The items listed as “out of scope for MVP” are included in the full product end state: AI-assisted summaries, subscriptions, customer-specific visibility, localization, custom domains, analytics, PDF export, and deployment orchestration.

## PRD review and governing principles

The PRD is coherent around five principles:

1. Internal release records are complete and may include sensitive technical and operational information.
2. Public release notes are a separately approved representation, never a frontend-filtered internal record.
3. Authorization is project-scoped and enforced at API and persistence boundaries.
4. Publication creates an immutable snapshot tied to an approved revision.
5. All publishing, approval, permission, and integration activity is auditable.

The PRD has several areas that need implementation decisions. This design resolves them as follows:

- Use a modular monolith first, with separate internal, public, publishing, integration, and worker modules. This keeps deployment simple while preserving hard boundaries.
- Use local JWT authentication behind an identity-provider interface; add company SSO/OIDC without changing domain authorization.
- Model public content as publication revisions and materialized snapshots, with public queries reading snapshots only.
- Keep internal and public DTOs, repositories, and route namespaces separate.
- Treat generated AI copy as a draft suggestion that can never approve or publish itself.
- Treat GitHub and deployment webhooks as idempotent ingestion sources; they can prepare drafts but can never publish automatically.

## Full-product goals

- Manage unlimited projects, repositories, environments, members, brands, and independent release histories.
- Author complete internal release documentation with rich text, Markdown, tables, code, images, and attachments.
- Manage hundreds of structured changes per release with filtering, sorting, grouping, and bulk editing.
- Review, approve, publish, revise, unpublish, and archive releases with separation of duties.
- Serve stable public project, version, latest, changelog, search, RSS, and sharing URLs.
- Integrate GitHub repositories, commits, pull requests, issues, tags, and CI/CD events.
- Track deployments across Development, QA, Staging, Beta, Enterprise, Canary, and Production.
- Provide project-scoped RBAC, audit history, search, comparisons, subscriptions, branding, analytics, export, and localization.
- Preserve public data isolation under direct API access, cache usage, search indexing, exports, and background jobs.

## Anti-goals

- Publishing internal documents by hiding fields in a public frontend.
- Letting a merged pull request or automated job publish customer-visible content without explicit approval.
- Storing secrets, credentials, API keys, or production configuration in release documentation.
- Making public URLs mutable when a new release is published.
- Allowing authorization to depend on UI visibility alone.

## Delivery shape

This is one product delivered as independently testable vertical phases:

1. Foundation: repository, configuration, database, authentication, users, roles, projects, members, audit events.
2. Release management: releases, semantic versions, environments, internal editor, structured changes, attachments, comparisons.
3. Public publishing: public candidate content, approval workflow, immutable snapshots, public API, public web pages, stable URLs.
4. Integrations: GitHub App/webhooks, commit/PR/issue linking, tag detection, CI/CD and deployment ingestion, idempotent jobs.
5. Advanced product: search, RSS, subscriptions, branding, client-specific visibility, analytics, PDF/export, localization, AI assistance, custom domains, deployment orchestration.

Each phase ends with automated tests and a usable increment. Later phases may not weaken guarantees established by earlier phases.

## Approaches considered

### Full distributed microservices from day one

Separate services for identity, authoring, publishing, integrations, search, analytics, and notifications. Rejected initially because it multiplies deployment, consistency, and authorization failure modes before the domain is proven.

### UI-first product prototype

Build admin and public screens against mocks. Rejected because the core risk is not visual layout; it is internal/public isolation, publication revision semantics, authorization, and auditability.

### Modular monolith with separate delivery modules — selected

Use a pnpm/Turborepo TypeScript monorepo. NestJS provides one API process with explicit bounded modules, Prisma/PostgreSQL provides transactional domain storage, a worker handles asynchronous integrations and projections, and React applications provide the internal and public experiences. This preserves the PRD's modular boundaries without premature distributed-system overhead.

## Repository architecture

```text
apps/
  admin-web/                 React internal portal
  public-web/                React public release pages
  api/                       NestJS internal/public API modules
  worker/                    BullMQ jobs, webhooks, projections, notifications
packages/
  ui/                        shared accessible UI primitives
  types/                     domain and API contracts
  validation/                Zod schemas and input policies
  config/                    typed environment configuration
  auth/                      identity-provider and token contracts
  public-model/              public DTO and snapshot schemas
database/
  prisma/                    schema, migrations, seeds
  search/                    search indexing definitions and adapters
docs/
  prd/                       product requirements and review notes
  architecture/              ADRs, diagrams, threat model
  api/                       OpenAPI sources and generated references
  security/                  security policy and disclosure controls
  deployment/                operations and recovery runbooks
infrastructure/
  docker/                    local and production images
  nginx/                     routing and security headers
  ci/                        CI/CD definitions
```

The API is a modular monolith with these bounded capabilities:

- `identity`: users, sessions, provider adapters, password/SSO lifecycle.
- `authorization`: roles, permissions, project membership, policy checks.
- `projects`: metadata, repositories, branding, visibility, members.
- `releases`: versioning, lifecycle, environments, internal documents.
- `changes`: structured change records, public candidates, ordering, bulk operations.
- `publishing`: approval revisions, snapshot materialization, publication and unpublication.
- `integrations`: GitHub and CI/CD connections, webhook verification, references.
- `deployments`: environment deployment records and history.
- `search`: internal and public indexes with separate document sources.
- `notifications`: subscriptions and delivery preferences.
- `analytics`: public page events and operational metrics without leaking internal data.
- `audit`: append-only activity records and exportable audit trails.

## Domain model

Core entities:

- `User`, `Identity`, `Session`, `Role`, `Permission`.
- `Project`, `ProjectMember`, `ProjectBrand`, `ProjectVisibility`.
- `ProjectRepository`, `RepositoryCredentialReference`.
- `Release`, `ReleaseEnvironment`, `ReleaseDocument`, `ReleaseAttachment`.
- `ReleaseChange`, `ChangeReference`, `ChangePublicDraft`.
- `ApprovalRevision`, `ApprovalDecision`, `ReleasePublication`, `PublicReleaseSnapshot`, `PublicSnapshotChange`.
- `Deployment`, `DeploymentEvent`.
- `GitReference`, `WebhookEvent`, `IntegrationConnection`, `JobExecution`.
- `Subscription`, `NotificationDelivery`.
- `SearchDocument`, `SearchProjectionVersion`.
- `AnalyticsEvent`, `AuditLog`.

Important constraints:

- Project slugs are globally unique.
- Release version/channel combinations are unique per project.
- A version may have many environment deployments.
- Public snapshots reference an approved revision and copy only approved public fields.
- Public snapshot rows do not resolve internal documents dynamically.
- Internal changes are not queryable through public repositories or search indexes.
- Every permission, approval, publication, unpublication, webhook, and export operation creates an audit event.
- Webhook event IDs and job keys are idempotent.
- Attachment metadata includes access scope, checksum, content type, size, and malware-scan state.
- All timestamps are UTC; public and internal APIs serialize ISO-8601 values.

## Internal/public boundary

Internal routes live under `/api/v1/internal`. Public routes live under `/api/v1/public`. They use different application services, repositories, DTOs, serialization policies, and search indexes.

The public publication workflow is:

```text
Internal release/change data
        ↓ editor selects candidates
Public change drafts
        ↓ reviewer/approver accepts exact revision
Approved approval revision
        ↓ transactional publication command
Immutable public snapshot + publication record
        ↓ cache/index/feed generation
Public API and public web pages
```

Unpublishing revokes public access while preserving the snapshot and audit history. Re-publication creates a new publication revision; previously published version URLs remain stable and resolve to the version's current valid publication according to explicit product policy.

## Authorization and roles

MVP role names from the PRD remain the base model: Admin, Release Manager, Developer, Reviewer, and Client. Client is public-only by default and cannot access internal routes. Permissions are explicit capabilities, scoped to a project where applicable:

- project management
- member management
- view/edit internal documentation
- create/edit releases and changes
- draft public changes
- approve public revisions
- publish/unpublish releases
- manage integrations and deployment records
- view audit history
- manage branding, subscriptions, and exports

Policy checks run in application services and are backed by database query scoping. The system supports separation of duties: an author cannot approve their own public revision when the project policy requires an independent approver, and a publisher cannot publish an unapproved revision.

## API surface

Internal API families include:

- `/auth`: registration, login, logout, sessions, current user, SSO callback.
- `/projects`: CRUD, members, repositories, branding, environments, settings.
- `/projects/:id/releases`: release CRUD, comparisons, lifecycle, deployments.
- `/releases/:id/documents`: structured internal documents and attachments.
- `/releases/:id/changes`: structured changes, references, bulk operations.
- `/releases/:id/review`: submit, approve, reject, revisions, publication history.
- `/integrations/github`: connections, repositories, sync, webhook status.
- `/search`: scoped internal search.
- `/audit`: project-scoped audit history and exports.
- `/analytics`: internal usage and public engagement metrics.

Public API families include only published data:

- `/projects`
- `/projects/:slug`
- `/projects/:slug/releases`
- `/projects/:slug/releases/latest`
- `/projects/:slug/releases/:version`
- `/projects/:slug/releases/:version/changes`
- `/projects/:slug/changelog`
- `/projects/:slug/search`
- `/projects/:slug/rss.xml`

Public responses never include internal user identities, internal comments, deployment commands, credentials, private references, approval metadata, or unpublished records.

## Internal portal

The admin web application provides:

- dashboard with upcoming, draft, review, published, and failed-integration states;
- project navigation and project-scoped timelines;
- release editor with internal documentation and structured changes side by side;
- public candidate drafting and exact approval preview;
- bulk change editing, filtering, sorting, grouping, and comparison;
- deployment/environment history;
- GitHub integration and suggested changes;
- search across authorized projects;
- audit history, permissions, branding, subscriptions, and exports.

The UI is not trusted for authorization. It mirrors server policies for usability, while every API call is independently checked.

## Public portal

The public web application provides responsive, accessible, SEO-friendly pages for project directories, release history, latest stable release, version-specific notes, changelog, search, RSS, copy-link, and social previews. Public pages are generated from public snapshots and can be cached aggressively. Client-specific visibility, localization, custom domains, and branding are project settings applied during public projection.

## Integrations and asynchronous processing

GitHub integration uses a GitHub App with signed webhook verification. The system supports multiple repositories per project, PR/commit/issue references, release tags, automatic change suggestions, and idempotent event processing. CI/CD integrations ingest deployment events and associate them with releases/environments.

Background jobs use BullMQ and Redis for webhook processing, search projection, publication projection, notification delivery, analytics aggregation, exports, AI suggestions, and retryable integration work. Jobs carry idempotency keys, retry policy, dead-letter state, and audit correlation IDs.

Publishing is never triggered by a merged PR, tag, or deployment event alone.

## Security, reliability, and operations

- Passwords are hashed with a modern password-hashing library; raw passwords, tokens, and secrets are never logged.
- Secrets are referenced through the approved secret manager, never stored in documentation content.
- Public API has dedicated DTOs, rate limits, caching, security headers, and no internal joins.
- Webhook signatures, replay protection, idempotency, and payload limits are enforced.
- Attachments are access-controlled, checksum-verified, size-limited, and malware-scanned before use.
- Database writes for approval/publication are transactional.
- Backups, restoration tests, health checks, structured logs, metrics, and alerting are part of deployment readiness.
- Targets from the PRD are p95 under 500 ms for cached public responses, 99.9% monthly uptime, WCAG 2.2 AA, and support for 100+ projects and 10,000+ releases initially.

## Full-product testing strategy

- Unit tests for domain invariants, semantic versions, permissions, approval rules, snapshot projection, visibility, and redaction.
- API integration tests for every internal/public route family and project boundary.
- Database tests for uniqueness, transactions, cascading behavior, and audit append-only policy.
- Contract tests for public DTOs and OpenAPI schemas.
- End-to-end tests for author → review → approval → publication → public URL flow.
- Security tests for direct public access to internal IDs, unpublished versions, private attachments, search leakage, cache leakage, webhook replay, and cross-project authorization.
- Integration tests for GitHub signatures, duplicate events, retries, deployment ingestion, notifications, exports, and AI draft suggestions.
- Accessibility, responsive, SEO, performance, and browser tests for both web applications.
- Disaster-recovery tests for backups and publication data restoration.

## Implementation sequence

The implementation plan will be split into independently reviewable plans while preserving this full target:

1. Repository and shared platform foundation.
2. Identity, authorization, projects, and audit.
3. Release authoring, changes, documents, attachments, and deployments.
4. Approval revisions, immutable snapshots, public API, and public web.
5. GitHub/CI integrations and worker reliability.
6. Search, subscriptions, notifications, analytics, branding, comparisons, feeds, exports, and client visibility.
7. AI assistance, localization, custom domains, deployment orchestration, hardening, operations, and launch readiness.

No phase may bypass the internal/public isolation rules or publish automatically.

## Approval and implementation record

The user approved proceeding with the complete PRD scope, including all post-MVP features. The task-level implementation plan is maintained at `docs/superpowers/plans/2026-11-10-rdps-full-product.md`; current implementation and verification evidence are tracked at `docs/superpowers/plans/2026-11-11-rdps-full-completion-tracker.md`. Production and external launch evidence remains distinct from local implementation completion.
