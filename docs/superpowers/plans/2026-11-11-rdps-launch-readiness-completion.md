# RDPS Launch Readiness Completion Plan

> **For agentic workers:** Continue the already-authorized full-product implementation in the current workspace. Use test-driven development for behavior changes. Do not claim completion while a requirement or required evidence remains open.

**Goal:** Track local verification and external launch evidence for Tasks 22–23 from the approved full-product plan. This document is reconciled to the completion tracker; successful local checkpoints do not establish production readiness.

**Architecture:** Keep the existing NestJS/PostgreSQL/Redis modular monolith. Add a shared Redis response cache only for anonymous public snapshot GETs, with a five-second TTL and project-scoped generation invalidation after publication changes. Keep audience-specific routes, host resolution, and attachment downloads uncached. Move public search filtering/pagination into PostgreSQL. Use production config/build validation and disposable restore targets without touching development volumes.

**Tech Stack:** TypeScript, NestJS, Prisma, PostgreSQL, Redis/ioredis, React/Vite, Docker Compose, Nginx, Prometheus, Alertmanager.

**Spec:** `docs/superpowers/specs/2026-11-10-rdps-full-product-design.md`; `docs/superpowers/plans/2026-11-10-rdps-full-product.md` Tasks 22–23.

## Global constraints

- Public delivery reads published snapshots only.
- Project authorization is checked on the server and backed by project-scoped queries.
- Client-audience data and attachment bytes are never shared through the anonymous public cache.
- Unpublishing retains immutable history while revoking public access promptly.
- Never use a development database or existing persistent volume as a destructive restore target.
- Local measurements are not production SLO, external TLS, alert delivery, or off-host retention evidence.

## Review focus

- Concurrent public reads racing publication or revocation must not repopulate the active cache generation with stale content.
- Cache keys must include host, path, and query and must bypass requests with credentials.
- Public search must scope before pagination and return total counts without hydrating every matching release.
- Cross-project denial and public snapshot revocation must be asserted over HTTP, not inferred from UI behavior.
- Restore and backup checks must identify the source volume/database and validate restored application records.

## Tasks

### Task 1 — Public response cache and revocation

- [x] Add unit tests for Redis hit/miss, project/global generation keys, TTL, credential bypass, cache backend failure, and generation invalidation.
- [x] Add a Nest interceptor for anonymous public JSON/RSS GETs; exclude `/public/host`, attachment downloads, and any request with `Authorization` or `Cookie`.
- [x] Replace `no-store` on eligible public routes with short shared-cache headers; leave private/download routes `no-store`.
- [x] Invalidate the project cache generation after successful public publish/unpublish. Preserve publication success if Redis is down; cache TTL bounds stale data and the failure is logged.
- [x] Re-run Docker E2E assertions for cache miss/hit, publish invalidation, and unpublish revocation against the current source. `pnpm e2e:isolated-publish` passed with a synthetic administrator and isolated tmpfs PostgreSQL/Redis; the persistent Dev volumes were not mounted. All 21 migrations applied.

### Task 2 — Bounded public query work

- [x] Add tests proving public search uses database `LIMIT`/`OFFSET` and a scoped count, and hydrates only the requested page.
- [x] Implement paged snapshot queries and stable version ordering with PostgreSQL-compatible SQL; retain public-only snapshot filters.
- [x] Add a repeatable isolated seed/benchmark harness for 100 projects and 10,000 published releases, including warmed-cache p50/p95/p99, error rate, cache hit rate, and API memory sampling.
- [x] Run the benchmark against Docker/PostgreSQL/Redis and record warmed-cache results. Fresh current-source run: 100 projects, 10,000 snapshots, 400 measured requests, zero errors, 100% warmed cache hits; per-route cached p95 was 17.80 ms directory, 16.86 ms history, 17.62 ms search, and 19.08 ms latest. This is cached latency evidence only, not production availability or a 99.9% SLO measurement.

### Task 3 — Security boundary E2E and browser accessibility

- [x] Reconfirm the two-project HTTP assertions for unauthorized reads/writes across release, documents, attachment, deployment, member, audit, integration, and search surfaces against current source. The isolated publish E2E pairs protected read/write checks with authorized controls and passed.
- [x] Re-run the expanded public route checks through isolated E2E. Assertions cover unpublished and published public surfaces, scoped search, client-only data, cache behavior and revocation; the full current-source flow passed.
- [x] Complete automated browser checks for public/admin critical views at desktop and 390 px, including keyboard focus/skip navigation, responsive overflow and axe WCAG 2.2 AA scans. All 8 tests passed with zero axe violations. Manual assistive-technology review remains open and is not inferred from automation.
- [x] Add and run a local HTTP-level Nest test for invalid GitHub signatures, correctly signed but expired deployment timestamps, and duplicate deployment delivery responses using the real ingestion service with isolated in-memory persistence/queue adapters.
- [x] Run the same webhook checks against Docker-backed PostgreSQL/Redis and verify persisted duplicate handling plus queue delivery. `pnpm e2e:webhook-runtime` posted a signed event twice, confirmed both responses referenced the same PostgreSQL event, and observed the worker complete it as `UNMATCHED` for the deliberately unlinked test repository. The script is repeatable and does not require admin credentials or reset volumes.

### Task 4 — Recovery and production evidence

- [x] Correct conflicting production topology documentation and make attachment-volume backup require an explicit, verified source volume.
- [x] Execute the disposable local PostgreSQL backup/restore drill and verify restored release/publication/audit records. The local Docker round-trip passed at a recorded checkpoint; it does not demonstrate encrypted off-host storage, retention, or recovery from the production backup target.
- [x] Exercise attachment-volume backup/restore with a uniquely named disposable volume and content/checksum validation.
- [x] Validate production Compose/preflight, build all local production image targets, and validate Prometheus/rules, rendered Alertmanager, Nginx, and Blackbox Exporter configuration. Synthetic preflight accepted required settings and complete optional integration configurations and rejected nine invalid cases; all four local production images (`rdps-api`, `rdps-worker`, `rdps-web`, `rdps-alertmanager`) built successfully; `promtool check config` validated the complete Prometheus config and its referenced file with all 7 rules; Alertmanager accepted its rendered HTTPS configuration and rejected HTTP; `nginx -t` passed; pinned Blackbox Exporter v0.29.1 accepted `blackbox.yml` with `--config.check` in an isolated network-disabled container. Registry publication and production runtime remain open.
- [ ] Keep deployment-owned secrets, DNS/TLS/ingress, live email, enabled deployment runner, production registry publication and immutable-digest promotion/rollout, owner-approved RPO/RTO, encrypted off-host backup/retention and restore, external synthetics/99.9% monthly SLO, alert receipt, and production ClamAV validation as unresolved launch gates.

### Task 5 — Closeout evidence

- [x] Run the workspace tests (API 242, admin 32, public 18, shared UI 8, auth 6, config 11, public model 3, shared types 1, validation 4, worker 18, operations 7; 350 total), typecheck, lint, format, and build after the implementation changes.
- [x] Re-run the full Docker publish/isolation E2E using per-run synthetic credentials and complete production image/config-tool validation. The isolated full flow passed; Docker Dev readiness, metrics, admin/public roots, and sitemap returned HTTP 200; API, PostgreSQL, Redis, and deployment runner were healthy with all 21 migrations applied. Production deployment evidence remains open below.
- [x] Update the completion tracker and progress ledger with evidence, measurement scope, and every remaining external gate.

## Reconciled launch gates — 2026-11-11

The following requirements remain open and are not satisfied by local tests, Compose validation, image builds, or local backup drills:

- Live email delivery, including subscription verification and unsubscribe flows.
- Production deployment runner enabled and exercised through its deployment-owned integration path.
- Production images published to the approved registry, immutable digests recorded, and digest-based promotion/rollout exercised.
- Service-owner-approved RPO and RTO values; encrypted off-host backups with defined retention; and a restore drill against the production storage target.
- External synthetic monitoring and a representative production measurement window supporting the 99.9% monthly availability SLO.
- Production alert receiver connected with end-to-end alert receipt proven.
- Production DNS, TLS certificates, ingress/routing, and external route verification.
- Formal WCAG 2.2 AA assessment for public and admin critical flows, including broader viewport and assistive-technology checks. The automated axe scans now pass at desktop and 390 px, keyboard smoke checks cover the tested flows, and the contrast findings were corrected; this does not replace the formal manual assessment.
- Deployment-owned secrets and credentials for GitHub App, OIDC, AI provider, and other enabled integrations; production ClamAV image/signature-update validation.

The full completion tracker is the source of detailed implementation and verification chronology. Its older reports of 18, 19 and 20 migrations are historical and superseded by the current 21-migration healthy Docker verification. The local 100-project benchmark and PostgreSQL restore round-trip passed, but neither closes production SLO or off-host recovery gates.

## Latest verification — 2026-11-12

- Client-audience release history now pages in SQL and returns a maximum of 100 items per page. Audience scope, active-publication filtering, latest snapshot per version, and page ordering are covered by API regression tests and the current-source isolated PostgreSQL E2E.
- Full workspace tests, typecheck, lint, formatting, and forced build passed. Browser coverage is 19/19, including client portal page navigation and an automated axe scan.
- The isolated publish E2E now publishes two client-only versions and verifies `page=1&pageSize=1` and `page=2&pageSize=1` against PostgreSQL, including ordering, totals, audience isolation, and attachment authorization. All 21 migrations applied, and the script removed its disposable resources.
- Docker Dev was rebuilt and recreated without modifying persistent data volumes. API readiness, admin web, and public sitemap returned HTTP 200; the protected client route returns HTTP 401 without a session. The authenticated E2E against the persistent Dev database remains unavailable because the local credential variables are not visible to this runtime.
- The credential-based E2E against the pre-existing Dev database remains open because `RDPS_E2E_ADMIN_EMAIL` and `RDPS_E2E_ADMIN_PASSWORD` are unavailable in the runtime. The authenticated values were not written to chat or documentation.
- Production integrations and operational gates listed above remain open until exercised with deployment-owned credentials and targets. Automated axe results do not substitute for a formal manual accessibility assessment.

## Latest continuation — 2026-11-12

- Fixed custom-domain routing for changelog, search, and release-history pages, with public-web regression coverage.
- Implemented project-authorized CSV/JSON release-comparison downloads with audit logging and UI controls. The first browser run found a nested API response mismatch; the UI now consumes `changes`, and the full 20-test browser suite passes.
- Added GHCR semantic-tag/manual publishing with provenance/SBOM and a downloadable immutable digest manifest for five RDPS images. Production preflight requires digest-pinned RDPS and ClamAV images; deploy pulls those exact references before migration and rollout.
- Made the publishing job depend on the full reusable CI workflow for the tagged source and restricted manual image publication to `main`; the production runbook describes both gates.
- Final local verification: 360 workspace/operations tests, all 20 browser tests, typecheck, lint, formatting, build, and the 21-migration isolated publish E2E passed. Docker Dev API readiness and both web roots/sitemap returned HTTP 200.
- The GHCR workflow has not published a tagged release, and production rollout and other deployment-owned gates listed above remain outstanding. Authenticated E2E against the persistent Dev database is still blocked because the credential variables are not visible in this runtime.
