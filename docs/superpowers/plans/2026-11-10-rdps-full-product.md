# RDPS Full Product Implementation Plan

> **For agentic workers:** Work through the phases in order. Keep public-data isolation and project authorization as release gates.

**Goal:** Deliver the complete Release Documentation & Publishing System in the approved full-product design.

**Architecture:** TypeScript pnpm/Turborepo monorepo with React admin and public apps, a NestJS modular monolith, a worker, PostgreSQL/Prisma, Redis/BullMQ, and explicit internal/public application boundaries. Public delivery reads immutable approved snapshots only.

**Tech Stack:** React, TypeScript, Vite, NestJS, PostgreSQL, Prisma, pnpm, Turborepo, Redis, BullMQ, Zod, Playwright, Vitest/Jest, Docker.

**Spec:** `docs/superpowers/specs/2026-11-10-rdps-full-product-design.md`

## Global Constraints

- Internal data is project-scoped and server-authorized.
- Public APIs and pages expose published snapshots only.
- Public content is approved separately and immutable per publication revision.
- GitHub or CI/CD events can prepare drafts but never publish automatically.
- Secrets are referenced through an approved secret manager; never stored in release content or logs.
- Publishing, approvals, permission changes, integration events, and exports are auditable.
- Use a modular monolith before considering service extraction.
- Meet the design targets: cached public p95 under 500 ms, monthly uptime target 99.9%, WCAG 2.2 AA, 100+ projects, 10,000+ releases.

## Review Focus

- Cross-project reads and writes: reject access unless membership and capability both permit it.
- Public access by internal IDs: return only published snapshot data; never disclose internal fields.
- Approval/publication races: publish only the exact approved revision in one transaction.
- Replayed or duplicated webhooks/jobs: process idempotently and preserve one audit trail per event.
- Unpublish and cache invalidation: revoke public access promptly while retaining immutable history.

---

## Phase 1 — Repository and shared platform foundation

### Task 1: Monorepo bootstrap

**Files:** root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.editorconfig`, `README.md`; workspace package manifests under `apps/*` and `packages/*`.

- Define workspaces for `admin-web`, `public-web`, `api`, `worker`, `ui`, `types`, `validation`, `config`, `auth`, and `public-model`.
- Add root scripts for dev, build, lint, typecheck, format, and test.
- Add development Docker Compose services for PostgreSQL and Redis with health checks.
- Document prerequisites, local setup, environment variables, and commands.

### Task 2: Shared contracts and configuration

**Files:** `packages/config`, `packages/types`, `packages/validation`.

- Define typed environment parsing and fail-fast validation.
- Define shared IDs, pagination, error envelope, semantic-version, project, release, and change contracts.
- Define reusable Zod boundary schemas; reject credential-like fields from release documentation inputs.

### Task 3: API, worker, and database base

**Files:** `apps/api`, `apps/worker`, `database/prisma`.

- Create NestJS modules and health/readiness endpoints.
- Configure Prisma client, PostgreSQL schema/migrations, seed command, and worker bootstrap.
- Add correlation IDs, structured logging, OpenAPI, and consistent error handling.

## Phase 2 — Identity, authorization, projects, and audit

### Task 4: Identity and session lifecycle

- Local email/password login with secure hashing, JWT/session lifecycle, current-user endpoint, and identity-provider interface for later OIDC/SSO.
- No plaintext secrets in logs; rate-limit authentication and provide account state controls.

### Task 5: Roles, permissions, and project membership

- Implement Admin, Release Manager, Developer, Reviewer, and Client capabilities.
- Enforce policies in application services and scoped repository queries.
- Support separation-of-duties policy configuration.

### Task 6: Project administration and audit

- Project CRUD, unique slug, member assignment, repositories, environments, settings, and initial branding metadata.
- Append-only audit service; record project, permission, and identity mutations.

## Phase 3 — Release authoring, changes, documents, attachments, deployments

### Task 7: Release lifecycle and versioning

- Create/edit releases, semantic version/channel uniqueness, lifecycle states, release date, summaries, and environment association.
- Track deployments independently per environment.

### Task 8: Structured changes and internal documents

- CRUD for categorized changes, internal/public draft descriptions, ordering, references, bulk operations, filters, and grouping.
- Internal document sections support rich text/Markdown, tables, code, and images.

### Task 9: Attachments and release comparison

- Access-scoped attachment metadata and storage adapter; size/type/checksum controls and malware-scan state.
- Compare releases and export authorized internal comparisons.

## Phase 4 — Approval, snapshots, public API and public web

### Task 10: Review and approval revisions

- Submit exact public candidate revision, approve/reject with rationale, enforce independent approver policy, and retain revision history.

### Task 11: Immutable publication snapshots

- Transactionally publish approved revision to a standalone snapshot model and publication record.
- Revisions are immutable; unpublish revokes access but retains history.
- Public access path must not query internal release/document/change repositories.

### Task 12: Public API and portal

- Public project directory, project history, latest stable, version details, changes, changelog, search, RSS, metadata, and copy/share links.
- Responsive accessible pages; public DTOs and cache keys based solely on public snapshots.

## Phase 5 — GitHub, CI/CD, and reliable workers

### Task 13: GitHub App and webhook ingestion

- Multi-repository connections, signature validation, replay defense, idempotent webhook records, commit/PR/issue references, tag detection, and draft suggestions.

### Task 14: CI/CD deployment ingestion

- Normalize deployment events across environments and correlate with project releases; retries and dead-letter handling.

### Task 15: Integration operations

- Job status/retry UI, delivery diagnostics, rate-limit handling, and audited configuration changes.

## Phase 6 — Search, notifications, analytics, branding, exports

### Task 16: Separate internal and public search

- Index only authorized internal documents in internal search; index only published snapshot projections publicly.
- Support project/version filters and cache/index invalidation.

### Task 17: Subscriptions and notifications

- Project/release subscriptions, preferences, delivery tracking, and unsubscribe controls.

### Task 18: Branding, client visibility, localization, and domains

- Project branding and client-specific public visibility; localized public descriptions; domain verification and routing.

### Task 19: Analytics and exports

- Privacy-conscious public engagement metrics, internal dashboards, PDF/export jobs, access controls, and audit records.

## Phase 7 — AI assistance, orchestration, hardening, and launch

### Task 20: AI-assisted summaries

- Generate suggestions only from authorized source data; preserve provenance; require human editing and approval.

### Task 21: Deployment orchestration

- Optional governed deployment triggers with explicit authorization, environment policy, idempotency, and complete audit trail.

### Task 22: Security, accessibility, performance, and recovery

- Test project boundaries, public leakage paths, webhook replay, attachment access, cache invalidation, WCAG 2.2 AA, responsiveness, p95 goals, backups, and restore procedures.

### Task 23: Production readiness

- Complete Docker/Nginx and CI/CD, secrets management, monitoring, alerting, runbooks, migrations, rollback, and launch checklist.

## Phase gates

- Phase 1: all workspaces start, build, typecheck, and local services report healthy.
- Phase 2: authenticated project workflows and cross-project denial are proven.
- Phase 3: complete internal release records and deployment history are usable.
- Phase 4: end-to-end author/review/publish/public-URL/unpublish flow preserves snapshot isolation.
- Phase 5: duplicate and invalid integration events are safely rejected or idempotently handled.
- Phase 6: search, notifications, analytics, and exports respect audience and authorization boundaries.
- Phase 7: operational targets and recovery procedures are verified before launch.
