# RDPS Full Product Completion Tracker

> **For agentic workers:** Execute against the approved full-product design and implementation plan. Keep public-data isolation and project authorization as release gates.

**Goal:** Complete all seven phases of the RDPS full-product design and verify the shipped workflows end to end.

**UX completion follow-up (2026-11-18):** All 21 browser scenarios now pass together after the review-by-ID click-target correction. Docker Desktop was started and all current dev images rebuilt. Default host PostgreSQL/Redis ports changed to configurable 15432/26379 because another running project owns 5432/6379. Web containers started, but API watch compilation was killed twice with exit 137; Docker reports OOMKilled=true. Full runtime readiness remains unverified until Docker has sufficient memory for the API compiler and dependent services.

**Current status (2026-11-18):** Docker Desktop's Linux engine is unavailable; admin (5173), public (5174), and API readiness (13001) do not respond. The historical running-state evidence below does not describe today's runtime. UX corrections are implemented: labeled mobile navigation, contained dashboard table scrolling, release section tabs with keyboard navigation and preserved drafts, a skip link that preserves the application route, clearer review navigation, and read-only messaging for locked changes. The latest complete browser run passed 20/21; its remaining failure was the review-by-ID summary target size. That control now has a 44px target and the previously failing browser scenario passes, including desktop/mobile axe checks. Targeted CSS formatting also passes. The complete browser suite has not been rerun together after that final CSS correction, and the correction has not been rebuilt into Docker while its engine is stopped. Production launch and manual assistive-technology gates remain open.

**Implementation status (2026-11-12):** Full local product implementation is present and the current verification suite passes: all 13 package test tasks plus 78 operations/dev-runner tests, typecheck, lint, build, formatting, 21 browser checks, current-source isolated publish/deployment E2E across all 21 migrations, PostgreSQL and attachment-volume restore drills, monitoring configuration validation, and Docker Dev health checks. Production recovery uses exact manifest-bound digests, serialized backup/deploy/rollback operations, self-verifying Restic snapshots, and app-only rollback records. The full PRD is not launch-complete: persistent-Dev credential E2E, formal manual WCAG/assistive-technology review, and deployment-owned production launch evidence remain open; see the latest continuation and launch gates below.

### Latest continuation — 2026-11-12 (production recovery hardening)

- Fixed the production smoke gate to use standard jq with `--exit-status`; command-level fixtures exercise healthy services and fail for unhealthy API readiness or missing/failed backup metrics. The smoke gate now checks the API scrape, PostgreSQL and Redis exporter metrics, fresh successful backup/upload/retention metrics, probe series, and loaded RDPS alert rules.
- Off-site Restic snapshots include both checksum sidecars, verify exact archive filenames and digests, and use matching host grouping for backup and retention. The backup and deployment share one lock; scheduled backup checks running healthy PostgreSQL/Redis without reconciling services. Early failures update backup metrics, and the systemd job has a finite six-hour timeout.
- Attachment volume restore now reapplies Compose identity labels, API ownership/mode, and is verified for API access plus acceptance by the normal backup path. Docker attachment and PostgreSQL restore round trips passed with isolated resources.
- GHCR publication resolves a release tag to a main-reachable commit, runs full CI for that SHA, uses retry-safe source/run-attempt aliases, and emits a five-image digest manifest. The workflow rejects an existing GitHub Release tag and attaches the manifest as a permanent release asset. Production preflight binds all five environment refs to that manifest.
- Deployment records the previous runtime image digests and Restic snapshot before migration. `scripts/ops/rollback-production.sh` takes the shared lock, restores only API/worker/web/Alertmanager images, and reruns the smoke checks without applying migrations.
- Monitoring config is validated before deployment; Prometheus, Blackbox Exporter, and Alertmanager are recreated to apply changed mounted config. Missing target/probe/exporter/backup series now alert. Focused Prometheus/Blackbox/Alertmanager config validation passed.
- Fresh `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm format:check` passed. Operations tests pass 49/49 and browser tests pass 21/21. Current-source isolated publish/isolation E2E passed after applying all 21 migrations. Docker Dev API readiness and admin/public roots return HTTP 200.
- The optional authenticated E2E against the already bootstrapped persistent Dev database remains unrun because `RDPS_E2E_ADMIN_EMAIL` and `RDPS_E2E_ADMIN_PASSWORD` are still unset in process/user/machine environments and `.env*`. No credential values were displayed or persisted.
- Live GHCR publication/deployment, production S3 credentials and restore evidence, DNS/TLS/alert receiver/email/integration evidence, owner-approved RPO/RTO and external 99.9% measurement window, and formal manual WCAG/assistive-technology review remain deployment-owned gates.

### Prior continuation — 2026-11-12 (comparison export and production image publication)

- Closed the custom-domain route gap: verified custom domains now serve `/changelog`, `/search`, and `/releases` history while unsupported routes remain 404. Regression coverage verifies the metadata API routing for all three paths; public-web tests pass 19/19.
- Added authorized internal release-comparison exports in CSV and JSON. The API uses the same project-role scope as comparison reads, emits `no-store` attachment responses, formula-safe CSV, and an audit record; the admin UI offers both formats. API/admin coverage includes allowed/denied roles and download route construction. Fixed the UI to read the API's nested `changes` payload after the first browser run exposed the mismatch.
- Added a GHCR GitHub Actions workflow for semantic release tags/manual dispatch. It publishes API, worker, migration, web, and Alertmanager images with provenance/SBOM, then uploads an immutable digest manifest. Production deployment now pulls those exact digests and preflight rejects mutable or missing RDPS/ClamAV references. Registry publication/deployment itself remains an external release action.
- Hardened release publication after a fresh workflow audit: GHCR publication now waits for the reusable full CI workflow on the exact release source; manual publication is restricted to `main`. An operations regression test asserts this dependency and branch guard.
- Latest `pnpm test` passes 360 tests (API 248, admin web 33, public web 19, shared UI 8, auth 6, config 11, public model 2, shared types 1, validation 4, worker 18, operations 10). `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `pnpm build` all pass.
- Latest Playwright run passes 20/20, including the CSV/JSON comparison download flow. Automated axe scans at desktop and 320/390/460 px report no violations; browser automation does not replace formal manual WCAG/assistive-technology review.
- Fresh `pnpm e2e:isolated-publish` applies all 21 migrations and passes the full publish, deployment, project isolation, client audience pagination/attachment, public attachment, and revocation flow. Owned Postgres/Redis containers were removed; the persistent Dev volumes were untouched.
- Docker Dev remains healthy: API readiness, admin root, public root, and sitemap all return HTTP 200. The runtime does not currently expose `RDPS_E2E_ADMIN_EMAIL` or `RDPS_E2E_ADMIN_PASSWORD`; authenticated E2E against the existing Dev database remains unrun.
- External launch gates remain open: publish a tagged release to GHCR and exercise deployment with deployment-owned secrets, DNS/TLS/ingress, email, integrations, live alert receiver, owner-approved RPO/RTO and encrypted off-host restore, external 99.9% SLO evidence, and formal manual accessibility review.

### Prior continuation — 2026-11-12 (audience pagination verification)

- Bounded the authenticated client release history endpoint to SQL-paged results: it selects the latest active snapshot per version inside the requesting member's audience, caps page size at 100, and hydrates only the selected IDs while rechecking audience and active-publication scope. The response now includes page metadata; the public client portal has previous/next navigation. OpenAPI and API reference documentation include the paging contract.
- Added regression coverage for audience scoping, latest-version canonicalization, SQL pagination parameters, hydrated-page ordering, response metadata, OpenAPI query parameters, and page-size normalization/capping. API tests pass 246/246.
- Added a browser journey that signs into the client portal with a mocked session, visits both pages, and scans the portal with axe at 390 px. The complete browser suite passes 19/19 with zero recorded axe violations.
- Fresh workspace `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `pnpm exec turbo build --force --concurrency=2` pass. The production web and API workspace builds completed.
- Fresh `pnpm e2e:isolated-publish` passed against disposable PostgreSQL and Redis, applied all 21 migrations, and verified client audience release plus authorized attachment download alongside publishing, deployment, cross-project isolation, public attachment, and revocation checks. The owned test containers were removed; persistent Dev volumes were untouched.
- Expanded and reran the isolated E2E so it publishes two client-only versions, requests `page=1&pageSize=1` and `page=2&pageSize=1`, verifies newest-first version ordering and totals, confirms both versions stay absent from anonymous public routes, and verifies page-two attachment authorization. The current-source flow passed and removed its disposable database and Redis containers.
- Rebuilt the development image serially and recreated API, worker, deployment runner, admin web, and public web with `--no-deps`. API readiness, admin web, and public sitemap returned HTTP 200. The unauthenticated client release route returned HTTP 401 as expected. API, PostgreSQL, Redis, and deployment runner are healthy.
- `RDPS_E2E_ADMIN_EMAIL` and `RDPS_E2E_ADMIN_PASSWORD` are unavailable to this runtime and absent from the project `.env*` files. The authenticated E2E against the existing bootstrapped Dev database therefore remains unrun; no credential values were displayed or persisted.
- PostgreSQL and attachment-volume restore round-trip drills passed earlier on 2026-11-12 using disposable labeled resources. Production backup, RPO/RTO, monitoring, deployment credentials, and formal manual accessibility gates remain open.

### Previous continuation — 2026-11-11

- Closed the two remaining local audit gaps: release change management now supports search, category filtering, ordering, grouping, selection, and bulk category/visibility edits; the dashboard now surfaces upcoming releases, drafts/rejected releases, and failed integration counts with direct navigation.
- Fixed a workspace route loading loop by removing a render-time project ref and fetching the authorized project for the detail route. The lifecycle dashboard uses native hash links. Admin icon navigation retains screen-reader labels at narrow widths, and the compact search button has a stable accessible name.
- Expanded Playwright coverage to 320, 390, 460, and desktop widths. Fresh `pnpm test:browser` passed all 18 tests, including full admin authoring/bulk-edit and public release/attachment journeys; every recorded axe scan passed with no violations.
- Fresh `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `pnpm exec turbo build --force --concurrency=2` passed. API tests passed 243/243, including the bulk category update regression.
- Fresh `pnpm e2e:isolated-publish` passed with synthetic per-run credentials and disposable PostgreSQL/Redis; it applied all 21 migrations, completed `v1.0.0` publishing and deployment, verified two-project authorization, client audience attachment access, and public attachment/snapshot revocation, then removed its owned containers.
- Rebuilt `rdps-dev:local` with Compose concurrency limited to one and recreated API, worker, deployment runner, admin web, and public web using `--no-deps`. Persistent database, Redis, and attachment volumes were not recreated. Fresh smoke checks returned HTTP 200 for API readiness, `/metrics`, both web roots, and sitemap. The correct metrics path is `/metrics` (the `/api/v1/metrics` path returns 404).
- `RDPS_E2E_ADMIN_EMAIL` and `RDPS_E2E_ADMIN_PASSWORD` remain unset in process, user, and machine environments. Therefore no fresh authenticated E2E was run against the already bootstrapped Dev database; the isolated full E2E passed independently and did not require these values.
- The Impeccable UI detector returned no findings. Formal manual WCAG 2.2 AA/assistive-technology evidence and all deployment-owned launch gates remain open.

**Architecture:** Preserve the approved TypeScript modular monolith: NestJS API, PostgreSQL/Prisma, BullMQ worker, React admin and public clients. Public APIs and pages must read published snapshots only.

**Tech Stack:** pnpm/Turborepo, NestJS, Prisma, PostgreSQL, Redis/BullMQ, React/Vite, TypeScript, Zod, Docker.

**Spec:** `docs/superpowers/specs/2026-11-10-rdps-full-product-design.md`
**Detailed plan:** `docs/superpowers/plans/2026-11-10-rdps-full-product.md`

## Current continuation — 2026-11-11

- Release document rich-text validation now accepts table, row, header-cell, and data-cell nodes with strict parent-child structure while retaining node/attribute and credential checks. A focused test first reproduced both unsupported-node and malformed-table failures, then passed with 22/22 release-content tests after the fix.
- Added the shared `@rdps/ui` package with eight tested primitives, shared CSS/tokens, and representative admin/public adoption. Its render contract suite passed 8 tests, both app suites passed 32 and 18 tests, and all 12 scoped Turbo typecheck/lint/build/test tasks passed.
- Added and ran the isolated current-source full publish runner. It applied 21 migrations, bootstrapped a synthetic admin, exercised publish/review, deployment completion, two-project authorization and public snapshot/attachment revocation, and cleaned only its labeled tmpfs containers. Persistent Dev volumes were not mounted; all Dev services remained healthy.
- Added headless Playwright and axe checks in CI. The first scans found low-contrast admin/public text, which was corrected; the clean rerun passed all 8 desktop/mobile browser checks with no axe violations. Browser automation remains distinct from a formal manual WCAG 2.2 AA review.
- Re-ran the current-source isolated public-read benchmark: 100 projects, 10,000 snapshots, 400 requests, 0 errors, 400/400 warmed cache hits. Cached p95 was 17.80 ms directory, 16.86 ms history, 17.62 ms search, and 19.08 ms latest. The local API process baseline/peak sampled memory was 182,579,200/221,663,232 bytes. This remains local performance evidence, not production SLO evidence.
- Full-audit workstreams are integrated: shared UI primitives, current-source isolated publish E2E, headless Playwright/axe checks, and architecture/security/API documentation. Fresh local verification passed; the final reconciliation is recorded in the audit-gaps plan.
- Production/customer gates and formal manual WCAG review remain open. The isolated publish flow is complete locally using per-run synthetic credentials and does not touch the already-bootstrapped Dev database.

## Final integrated verification — 2026-11-11

- `pnpm test`: **350 passed** across API (242), admin (32), public web (18), shared UI (8), auth (6), config (11), public model (3), shared types (1), validation (4), worker (18), and operations (7).
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `pnpm exec turbo build --force --concurrency=2` passed. Docker image builds remain serialized because the host has a 1.9 GiB Docker memory limit.
- `pnpm test:browser`: **8 passed**, including desktop and 390 px admin/public flows, keyboard focus/skip navigation, horizontal-overflow checks, SEO metadata, a 5-second load budget, and axe WCAG 2.2 AA scans with zero violations. Initial contrast findings were fixed before the passing rerun.
- `pnpm e2e:isolated-publish`: passed against current source with per-run synthetic credentials, tmpfs-only PostgreSQL/Redis containers, and loopback ephemeral ports. It applied all 21 migrations, completed publication/deployment, exercised two-project authorization and public/client attachment revocation, and cleaned its owned containers. No persistent Dev volumes were mounted.
- Current-source public-read benchmark: 100 projects, 10,000 snapshots, 400 requests, zero errors, and all 400 warmed cache hits; cached p95 was 17.80 ms directory, 16.86 ms history, 17.62 ms search, and 19.08 ms latest. API-process memory sampled at a 182,579,200-byte baseline and a 221,663,232-byte peak.
- Production Compose configuration passed with verification-only synthetic values. Prometheus, Alertmanager, Nginx, Blackbox Exporter, and local production-image checks passed at the production verification checkpoint; those files were unchanged during this continuation.
- Rebuilt `rdps-dev:local` sequentially from the final source and recreated API, worker, runner, and web containers without touching PostgreSQL/Redis/attachment volumes. Docker Dev remains up: API, PostgreSQL, Redis, and deployment runner healthy; worker and both web services running. Readiness, metrics, admin root, public root, and sitemap return HTTP 200. No isolated E2E containers remain.
- Manual WCAG 2.2 AA/assistive-technology evidence and all deployment-owned launch gates remain open; local evidence does not satisfy them.

## Execution checklist

### Phase 1 — Foundation

- [x] Workspace packages, typed configuration, shared contracts, validation, scripts, logging, OpenAPI and readiness.
- [x] Database migrations, deterministic seed/development bootstrap, Docker development and production profiles.
- [x] CI build, lint, typecheck, unit/integration/e2e test pipelines.

### Phase 2 — Identity, authorization, projects and audit

- [x] Identity/session lifecycle, password controls, rate limits, OIDC adapter boundary.
- [x] Project-scoped roles/capabilities, membership administration, separation of duties and policy tests.
- [x] Project/repository/environment/branding administration and append-only audit history.

### Phase 3 — Release authoring

- [x] Release lifecycle, semantic versions/channels, environments and deployments.
- [x] Structured changes, bulk editing, references, ordering, filters/grouping and internal documents.
- [x] Attachment storage, access scoping, checksums, size/type controls and scan workflow.
- [x] Release comparison and authorized internal export.

### Phase 4 — Approval and public publishing

- [x] Exact revision review, approval/rejection rationale, independent approver policy and history.
- [x] Transactional immutable snapshots, publication revisions, unpublish and cache/index revocation.
- [x] Snapshot-only public API: project directory, history/latest/version/changelog/search/RSS/share metadata.
- [x] Public app consumes the API and implements responsive layouts plus accessibility affordances (landmarks, skip links, labels and focus targets). Formal WCAG 2.2 AA conformance, including keyboard, contrast, viewport and assistive-technology validation, remains open in Phase 7.

### Phase 5 — Integrations and workers

- [x] GitHub App connections, signed webhook validation, replay defense, idempotency and reference ingestion.
- [x] Project-admin review of pending integration suggestions, including accept/dismiss actions, loading/error/empty states, and conflict feedback.
- [x] CI/CD deployment ingestion, normalization, release/environment correlation and retries/DLQ.
- [x] Worker processors, job state/diagnostics/retry UI, rate-limit handling and audited configuration.

### Phase 6 — Advanced product capabilities

- [x] Separate authorized internal and published-snapshot public search projections, including searchable release-document content and projection invalidation.
- [x] Project and release subscriptions, preferences, delivery state and unsubscribe handling. Project-level and release-level subscription flows, preferences, verification/unsubscribe tokens, publish notifications, and admin release-scope management are implemented.
- [x] Project branding, client-specific visibility, localized release content and verified custom domains. DNS TXT ownership verification and routing are implemented; production DNS/TLS/ingress verification remains an external launch gate.
- [x] Privacy-conscious analytics and access-controlled PDF/export jobs with audit records.

### Phase 7 — AI, orchestration and launch readiness

- [x] AI summaries with source provenance, authorization, human editing and approval gates.
- [x] Governed deployment orchestration with explicit policy, idempotency and audit trail.
- [ ] Security, cross-project isolation, public leakage, webhook replay, accessibility and performance verification. Current-source cross-project/public leakage E2E, webhook replay, and the 100-project/10,000-snapshot benchmark are verified; all four automated axe scans pass at desktop/390 px, keyboard smoke flows pass, and observed contrast defects were corrected. Formal manual WCAG/assistive-technology review and production SLO evidence remain open.
- [ ] Backup/restore, monitoring, alerting, production routing/secrets/runbooks and release checklist. The isolated local PostgreSQL backup/restore round-trip is verified; production off-host recovery, alert delivery, DNS/TLS/ingress, customer secrets, runbooks and release sign-off remain open.

## Completion rule

Mark a checkbox only after implementation is present and its stated behavior has fresh verification evidence. Database models, static mock screens, queue names, and infrastructure that starts do not count as a completed product workflow. Record blockers and remaining requirements in this file; do not claim full completion while any requirement remains unchecked.

## Verification record — 2026-11-11

- Docker development stack rebuilt and running: API healthy; PostgreSQL, Redis, and deployment runner healthy; worker, admin web, and public web running. `docker compose config --quiet` passed. Local HTTP checks returned 200 for `http://localhost:13001/api/v1/health`, `http://localhost:5173`, and `http://localhost:5174`.
- `pnpm e2e:release-publish` passed against Docker. It created and published `v1.0.0`, exercised the deployment runner through `SUCCEEDED`, client-only release `v1.1.0`, authorized client attachment access, public attachment publication/revocation, public snapshot revocation, and CSV/PDF export jobs (2 exports).
- `pnpm test` passed: API 185/185; admin-web 19/19; public-web 7/7; auth package 6/6; worker tests passed in the workspace run. `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm format:check` passed. Lint reports 6 React hook dependency warnings and 0 errors.
- Prisma reports all 19 migrations applied and the database schema up to date.
- Local development administrator used by the E2E run: `kasun@parallaxtec.com`. The local-only password is configured in the developer environment and is intentionally not stored in this tracker.

## Verification update — subscriptions and Host security (2026-11-11)

- Public history, changelog, and search now return bounded database-paginated responses. SQL selects the latest active public snapshot per version before search filtering, counts in PostgreSQL, hydrates only the requested page, and preserves project/audience/revocation filters. Directory/profile reads no longer hydrate all release snapshots; RSS is capped at 50 items; stable-latest reads version identifiers before loading one release. Added read indexes and Prisma migration `20261111200000_public_snapshot_read_indexes`.
- Public web now renders history/changelog/search page navigation. `pnpm test` passed across the workspace (API 195, admin 21, public 7, auth 6, worker 18); `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm format:check` passed. Prisma schema validation passed with a synthetic local `DATABASE_URL`. Lint has no errors or warnings.
- Docker production preflight and `docker compose -f docker-compose.production.yml config --quiet` passed with synthetic values. Production image build failed with Docker engine RPC EOF and npm registry timeouts; YAML config parsing passed, while `nginx`, `promtool`, and `amtool` were unavailable for native checks.
- Docker Desktop’s CLI restart failed because its backend/frontend processes remained running. The dev stack and named volumes were not intentionally stopped, removed, or recreated. Docker health, migration application, and the cache-aware E2E against the new API image therefore remain unverified. The previous Docker E2E result above is historical and does not cover this session’s query/pagination changes.
- Added isolated PostgreSQL backup/restore round-trip automation with unique run-labeled containers/volumes, migration application, representative release/publication/changelog/audit fixtures, checksum validation, restore assertions, and ownership-checked cleanup. Shell syntax and resource-safety scans passed; it has not run because Docker is unavailable. CI now invokes it.
- Expanded the Docker E2E flow with a second project and cross-project read/write denial checks across project, release, member, repository, environment, audit, documents, attachments, deployments, integrations, and internal/public search. Node syntax and formatting pass; HTTP execution remains pending Docker recovery.
- Added authorized positive controls for the cross-project project/release/document/attachment/deployment/member/repository/environment/integration read and write surfaces. Corrected the integration retry denial expectation to 403, which is returned by membership authorization before the webhook-event lookup; the previous placeholder release ID could otherwise have made a 404 assertion pass for the wrong reason.
- Public project directory delivery is now paginated and searched in PostgreSQL; the directory UI reads URL-addressable query/page state. Release-history/search pages hydrate only the first three change titles/categories and no attachment metadata; detail/latest endpoints retain full content. Out-of-range pages clamp to the last available page.
- Latest verification after these changes: workspace tests passed (API 196, admin 21, public 7, auth 6, worker 18); `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `pnpm build` passed. E2E script syntax/format checks passed. Docker engine calls still hang and local Docker service remains unavailable, so the new migration, E2E, and PostgreSQL restore drill are still unverified at runtime.
- Expanded the pending E2E public checks to cover paged and filtered directory delivery; unpublished project/history/latest/changelog/RSS/share/release/change routes; published latest/history/changelog/changes/RSS/project-share/release-share routes; client-only visibility; and publication/attachment revocation. Node syntax and Prettier checks pass; HTTP behavior is still pending a live Docker API.
- Added a public history regression assertion that list responses omit the internal snapshot ID and attachment metadata. The API suite passes 196 tests with this assertion.
- Docker startup diagnosis: `docker desktop start` reports the app already running, but `docker desktop status` remains `starting`; the active context is `desktop-linux`, and `wsl --list --verbose` reports no installed distributions. Docker-dependent checks need WSL2/Linux-engine host setup before they can run.
- Added `scripts/operations/public-read-benchmark.mjs`, an isolated, ownership-labeled 100-project/10,000-snapshot benchmark that applies migrations to a fresh disposable database, exercises directory/history/search/latest HTTP routes, measures cached p50/p95/p99, error/cache-hit rates, and samples API memory. Added five unit tests and wired them into root `pnpm test`. Local workspace typecheck, lint, build, formatting, and all package tests pass. Benchmark preflight timed out on `docker info` while Docker Desktop remains `starting`; it stopped before creating any containers or volumes. Runtime measurements and migration execution remain open.
- No Brave Chrome-extension browser-control tool is exposed in this session, so browser/axe/keyboard/viewport auditing remains unrun; no full-desktop browser automation was used.

## Historical verification checkpoint — 2026-11-11 (superseded for current stack state)

The checkpoint below records successful verification at that time. Its claim that the dev stack was running/healthy and its report of 18 migrations are historical; they are superseded by the later 19-migration checkpoint below and by the subsequent API exit described in the latest status note. Do not use this checkpoint as evidence of current Docker health.

- The Docker dev stack was rebuilt twice from current workspace source. API, worker, admin web, public web, deployment runner, PostgreSQL 17, and Redis 7 are running; API/PostgreSQL/Redis/deployment-runner health checks are healthy. API readiness and liveness, API metrics, and both web roots return HTTP 200. Readiness reports database and Redis healthy. Prisma reported 18 migrations found and no pending migrations.
- Development Compose and production Compose configuration both validate; production configuration was rendered using synthetic verification-only environment values.
- The full Docker publish-flow E2E passed against the latest rebuilt stack: public release `v1.0.0` and revision 1, two analytics exports, deployment request `SUCCEEDED`, client-audience release `v1.1.0`, authorized client attachment access, public attachment publication/revocation, and revoked public snapshot. The flow also exercises two-project authorization and public-data isolation. The local admin's pre-test password hash was restored after each E2E run.
- Local authentication now applies independent HMAC-keyed failure buckets for `(source IP, email)` and source IP, limiting password-spray attempts across rotating email addresses. The regression suite verifies 60 distinct emails from one IP are blocked before a 61st account lookup; identifiers remain hashed. Focused auth tests pass 13/13; full workspace verification after this change is pending.
- Full `pnpm test` passed: API 235, admin web 25, public web 7, auth 6, shared types 1, config 11, validation 4, public model 2, worker 18, and operations scripts 7 (316 total). `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `pnpm build` all passed. Lint completed with no errors; build completed all 8 build tasks.
- Attachment uploads now validate extension, declared MIME, text encoding/content, JSON syntax, and file signatures before storage writes; HTML/SVG and unsupported types are rejected. The OpenAPI contract test covers publishing, approval, authenticated multipart attachment operations, and integration suggestions. Integration-suggestion acceptance now publishes its required UUID request body in OpenAPI. Corresponding focused tests pass.
- API Prometheus metrics now expose request totals, route-template/status labels, latency histograms, uptime, and resident memory. Readiness probes DB and Redis. Prometheus scrapes the API and alerts on sustained server errors and elevated p95. `promtool check config` accepted the Prometheus config and `promtool check rules` accepted all 7 alert rules. README guidance now reflects the actual suggestion-review and snapshot-publishing workflows.
- The isolated public-read benchmark passed with 100 projects, 10,000 published snapshots, 100 samples per route, 400 measured requests, zero errors and 100% warmed cache hits. Latest cached p95: directory 16.59 ms, history 15.95 ms, search 17.23 ms, latest 16.97 ms. Overall target (cached p95 under 500 ms and cache hit rate at least 99%) was met. The benchmark fixture uses PostgreSQL 17 and Redis 7.
- Docker-backed PostgreSQL backup verification and restore round-trip passed. It restored and verified representative project, release, publication, public snapshot, changelog, and audit records, then removed only its run-labeled test resources. This is local development evidence, not production/off-host recovery evidence.
- Regression fixes made during verification: `@rdps/config` now has CommonJS and ESM runtime entry points; the public-cache Redis dependency has an explicit Nest injection token; benchmark rate limits accommodate the configured request samples; benchmark output reports the actual PostgreSQL fixture image. Associated tests pass.
- Brave Chrome-extension browser controls are not exposed in this Codex session. No full-desktop browser automation was used. Browser-based axe, keyboard-only, viewport, contrast and SEO audits remain unverified.

## Historical verification notes — superseded where they conflict with Current verification

## Follow-up verification — 2026-11-11

- Completed release-scoped subscriptions end to end: nullable release linkage and migration, project plus release preferences/listing, subscriber delivery on publication, verification/unsubscribe flows, and release-scope administration in the project UI. API notification tests and admin route/component tests passed in the workspace run.
- Hardened server-rendered metadata and sitemap origin handling. Unverified hosts and Host path/query/fragment delimiters are rejected; custom-domain canonical URLs are fixed to HTTPS and ignore forwarded-protocol values; sitemap cache entries include the resolved project so reassignment cannot serve the prior project's sitemap. Public-web tests pass 17/17 and its lint passes.
- Fresh workspace verification: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm format:check` all passed after the security fixes. Public-web's server suite reports 17/17 tests; API suite reports 240/240 in the workspace run.
- Rebuilt the Docker dev image and restarted API, worker, admin web, public web, deployment runner, PostgreSQL, and Redis. All services are running; API, database, Redis, and runner health checks are healthy. API health/readiness/metrics plus admin and public web roots return HTTP 200. Prisma reports 19 migrations and no pending migrations.
- `docker compose -f docker-compose.production.yml config --quiet` passed with synthetic verification-only environment values. Production image build and ingress runtime are not verified.
- A fresh `pnpm e2e:release-publish` attempt stopped before making requests because `RDPS_E2E_ADMIN_EMAIL` and `RDPS_E2E_ADMIN_PASSWORD` are absent in this session. The prior Docker publish-flow E2E remains historical evidence; this follow-up does not claim it reran.
- The Brave Chrome-extension control is not exposed in this Codex session. Formal browser, axe, keyboard-only, viewport, contrast, and external production routing checks remain open.

## Latest environment status — 2026-11-11

- A production web image build completed successfully. During its subsequent isolated runtime smoke, the development API container exited with code 137 (`OOMKilled=true`). The smoke container was removed and the API recovered after the production build ended.
- Current Docker verification: API health/readiness/metrics and admin/public roots return HTTP 200; API, PostgreSQL, Redis, and deployment runner report healthy, and all 21 migrations are applied with none pending. Production Compose AI configuration and preflight pass with synthetic values; disabled and valid configured modes pass, while partial and HTTP provider configurations are rejected. Production web image runtime smoke returns 200 for `/healthz`, `/`, and `/sitemap.xml` against the recovered API.
- The fresh publish E2E remains unrun because `RDPS_E2E_ADMIN_EMAIL` and `RDPS_E2E_ADMIN_PASSWORD` were not available. Do not infer a fresh end-to-end pass from the earlier historical run.

## Implementation update — production AI and public API configuration (2026-11-11)

- Wired `AI_SUMMARY_PROVIDER_URL`, `AI_SUMMARY_MODEL`, `AI_SUMMARY_PROVIDER_API_KEY`, and `AI_SUMMARY_TIMEOUT_MS` into the production API service. Production preflight accepts the disabled and complete HTTPS configuration, rejects partial/non-HTTPS settings, and validates timeout syntax. Provider credentials remain optional and must come from the secret manager.
- Exposed the public API rate limit/window and trusted-proxy IP settings in production Compose and documented the forwarding trust boundary. Development and production Compose validation and formatting checks pass.
- The Brave Chrome-extension control remains unavailable in this Codex session; no full-desktop browser automation was used.

## Full workspace verification — 2026-11-11

- Fresh uncached workspace tests passed: API 242/242, admin web 32/32, public web 18/18, auth 6/6, config 11/11, public model 3/3, shared types 1/1, validation 4/4, worker 18/18, and operations 7/7 (342 total).
- Fresh `pnpm exec turbo typecheck --force`, `pnpm exec turbo lint --force`, `pnpm exec turbo build --force --concurrency=2`, and `pnpm format:check` passed. Build completed all 8 build tasks; lint and typecheck each completed all 8 package tasks.
- Production preflight accepted both disabled AI and a complete HTTPS provider configuration and rejected partial or HTTP configurations. Development and production Compose configuration passed; formatting passed.
- Docker now reports 21 Prisma migrations with none pending. API readiness, admin/public roots, and metrics return HTTP 200; production web image smoke returned HTTP 200 for `/healthz`, `/`, and `/sitemap.xml`. The fresh publish E2E is still not run because local E2E credentials are unavailable.
- Internal search includes indexed release-document content with project-scoped query authorization and project-scope refresh on release reassignment. Localized titles, summaries, and change descriptions can be authored and are frozen into the approved public snapshot; public APIs report published locales and the public locale picker follows snapshot fallback behavior. These changes are covered by the passing workspace suite and Docker migration check.
- Localization accepts valid BCP 47 tags up to the 255-character standard limit through the admin model, API, database and public DTOs. Public release/profile DTOs include published locale options; migration `20261112140000_expand_bcp47_locale_tags` is applied.

The notes below preserve prior investigation results. Current state and latest evidence are recorded above; earlier statements that Docker was unavailable, the benchmark could not start, localization/search/rate limiting were missing, or the local restore drill had not run are superseded by the current verification record.

## Docker runtime follow-up — 2026-11-11

- Added `scripts/e2e/webhook-runtime-smoke.mjs` and the root command `pnpm e2e:webhook-runtime`. The smoke signs a unique GitHub push event inside the API container so no webhook secret is exposed, submits the same delivery twice, asserts duplicate idempotency, and polls PostgreSQL until the BullMQ worker completes the intentionally unmatched repository event.
- Fresh run passed after formatting: the two responses referenced one persisted event, and the worker completed it with status `UNMATCHED`. No admin credentials or volume resets were needed. The local generated event has no project-side effects.
- Fresh Docker checks returned HTTP 200 for API readiness, metrics, admin root, public root, and sitemap. PostgreSQL reports 21 applied migrations and zero pending/rolled-back migration rows. `RDPS_E2E_ADMIN_EMAIL` and `RDPS_E2E_ADMIN_PASSWORD` are not set; the full publish/isolation E2E remains unrun in this session.
- The Brave Chrome-extension controller is not exposed in this Codex session. No full-desktop browser automation was used; manual keyboard/viewport/axe/contrast/WCAG checks remain open.

## Production build and configuration follow-up — 2026-11-11

- Production preflight accepted synthetic required values and a complete synthetic GitHub App/OIDC/AI/deployment-runner configuration. Nine malformed/missing/partial cases were rejected with the expected exit code. Production Compose interpolation passed.
- Prometheus config syntax and all 7 alert rules passed `promtool`; rendered Alertmanager config passed `amtool` with HTTPS and rejected HTTP. The built production web image passed `nginx -t`.
- `docker compose -f docker-compose.production.yml build` completed with verification-only environment values. Local images built: `rdps-api:local-verify-20261111`, `rdps-worker:local-verify-20261111`, `rdps-web:local-verify-20261111`, and `rdps-alertmanager:local-verify-20261111`. No images were published or deployed. Registry push/digest promotion and production runtime remain external gates.
- `promtool check config` then validated the complete Prometheus config and its referenced alert file (all 7 rules) in a temporary container populated with `docker cp`, avoiding the workspace bind-mount issue. Pinned Blackbox Exporter v0.29.1 also accepted `scripts/ops/monitoring/blackbox.yml` with native `--config.check` in an isolated network-disabled container (exit 0).
- The parallel production image build exceeded Docker’s 1.917 GiB memory limit and caused the Dev Node containers to be OOM-killed (exit 137); PostgreSQL and Redis remained healthy. The Dev services were restarted in stages, and fresh readiness, metrics, both web roots, sitemap, all 21 migrations, and a second `pnpm e2e:webhook-runtime` run passed. Current Dev stack is up and healthy; keep future image builds sequential on this Docker memory limit.

### Previous continuation — 2026-11-11

- Docker Desktop recovered (Docker Engine 29.9.3). PostgreSQL, Redis, API, worker, deployment runner, admin web, and public web are running; database/Redis/runner/API health checks are healthy, and API/web HTTP smoke checks return 200. These containers still need rebuilding from the latest source before they count as current verification.
- Dev Compose now builds the shared config package before starting API/worker because the Docker context excludes package `dist/` outputs. `docker compose config --quiet` passes.
- Shared typed config is consumed at API/worker startup and populates validated defaults for legacy environment consumers. Config tests pass 10/10; API and worker typechecks pass.
- Current focused verification: release-content validation 21/21, public rate-limit guard 4/4, internal document search 7/7, admin search navigation 2/2, validation package 4/4, public-model package 2/2, shared types 1/1. Internal document search uses a PostgreSQL GIN full-text projection and trigger migration, but the migration still needs application against the live Docker database.
- Added private-network ClamAV wiring to production Compose. Configuration validation passed; the image has not yet been pulled or run.
- Static UI accessibility review added skip links/focus targets to the admin shell and standalone public client/subscription routes, made logo dimensions explicit, and tightened search/email control names/autocomplete. Admin and public web typechecks pass. Full keyboard/axe/viewport and measured WCAG contrast checks remain unrun because the Brave extension controller is unavailable.
- Added an HTTP-level Nest endpoint test for webhook signature rejection, stale signed timestamp rejection, and duplicate delivery replay. The API test suite now passes 197 tests; API typecheck and lint pass. The endpoint is exercised over a live local HTTP listener, but its persistence and BullMQ runtime path still need Docker E2E verification.
- Reconciled shared package contracts: restored the missing typed config source, aligned release validation with project IDs, and wired the public-model package dependency/latest-release profile. Direct TypeScript compilation and package tests pass (types 1, config 8, validation 4, public-model 2). Workspace `pnpm` package scripts currently misquote the repository path because it contains spaces, so these were verified with the local TypeScript compiler and Node test runner directly.
- Hardened release document validation for the Markdown editor's `{type:"markdown",source}` format and strict supported rich-text nodes/attributes, including safe link/image URL handling. Focused API release-content tests pass 21/21. The attachment scanner now selects the development EICAR implementation only for explicit `development`/`test`; unset or unknown environments require ClamAV and fail closed when it is unavailable.
- Added a Redis-backed API-wide public route rate limit with atomic fixed-window counters, configurable limits/windows, `Retry-After`, fail-closed Redis errors, and trusted-proxy allowlisting. Focused guard tests pass 4/4; API typecheck passes. Full Docker/Redis HTTP verification remains pending.
- Connected the typed `@rdps/config` parser to API and worker entrypoints so validated defaults populate the existing environment consumers; config package tests pass 10/10 and API/worker package dependencies are wired. Added the ClamAV service to the private production network with health/dependency/resource controls and deployment guidance; production Compose config validation passed, while live daemon/image validation remains outstanding.
- Full audit reopened internal search and localization: search must include release-document content with indexed invalidation, and localized release content must be stored/published per locale (UI catalogs/default locale alone do not implement translation workflows). The public API-wide Redis rate limiter is present with fixed-window limits, `Retry-After`, trusted-proxy allowlisting, and fail-closed Redis behavior; Docker-backed HTTP verification remains open. Public snapshot-linked attachment delivery is implemented with revocation and integrity checks, but its latest E2E verification remains Docker-gated.

## Remaining external launch evidence

- Configure and prove live email delivery, including subscription verification/unsubscribe delivery in the deployment environment.
- Enable the deployment runner and exercise a real deployment integration through the production deployment path; local runner E2E is not evidence that the production runner is enabled.
- Publish production images to the approved registry, record immutable image digests, and prove the digest-based promotion/rollout path. Compose config validation and a local image build do not satisfy this gate.
- Obtain service-owner approval for explicit RPO and RTO targets, then configure encrypted off-host backup storage/retention and complete a restore drill against that target. The local PostgreSQL round-trip does not satisfy this gate.
- Establish external synthetics and collect a representative production measurement window demonstrating the 99.9% monthly availability SLO; local cached-read latency benchmarks do not establish uptime.
- Connect the production alert receiver and prove alert receipt end to end.
- Configure and verify production DNS, TLS certificates, ingress/routing, and externally reachable public routes.
- Complete a formal WCAG 2.2 AA review for public and admin critical flows, including keyboard-only use, viewport coverage, contrast, automated scans and assistive-technology checks.
- Exercise a real GitHub App installation and delivery using deployment-owned App ID, private key, webhook secret, and a linked repository; local signed-event tests cover validation and routing.
- Exercise login/link against the customer's actual OIDC issuer and client credentials; local provider tests cover the implemented protocol flow.
- Exercise the configured AI provider with deployment-owned credentials; local AI summary tests cover provenance, authorization, human editing and approval gates.
- Validate the production ClamAV image/signature update cadence and production image plus `nginx`/`promtool`/`amtool` configuration with deployment infrastructure. The local two-project HTTP E2E, 100-project/10,000-snapshot benchmark, backup/restore drill, and full Docker publish-flow E2E are complete.

The final sentence above records local evidence only. Production release readiness remains open until every applicable external gate listed here has deployment-owned evidence.

## Host monitoring and latest local verification — 2026-11-12

- Added a digest-required Node Exporter container restricted to the production monitoring network, with read-only host mounts and hardened container settings. Prometheus scrapes host metrics; alert rules cover exporter outage, disk capacity, available memory, and sustained CPU saturation.
- Preflight rejects a missing or mutable exporter image. Deployment pulls and starts the exporter, and production smoke checks require the exporter target to be up. Runbooks and CI preflight fixtures are updated.
- Verified `pnpm test` (372 total, 17 operations tests), lint, typecheck, formatting, shell syntax, Prometheus configuration, and all 11 alert rules. Focused monitoring/preflight/deployment tests passed 9/9.
- Docker Dev endpoints are healthy: API readiness `:13001/api/v1/health/ready`, Admin `:5173`, public `:5174`, and sitemap return HTTP 200; API readiness reports database and Redis healthy.
- This is local/configuration verification. Running Node Exporter against production, selecting the approved digest, publishing/deploying GHCR images, and deployment-owned external evidence remain open. The persistent-Dev authenticated E2E remains unrun because `RDPS_E2E_ADMIN_EMAIL` and `RDPS_E2E_ADMIN_PASSWORD` are not available in this runtime.

## Previous verification — 2026-11-12 (superseded by the latest continuation)

- Added project audit-history CSV export to the API, Admin UI, and isolated project-boundary E2E. The API streams complete history in cursor pages, records the export action, enforces project-admin authorization, and neutralizes formula-leading cells. Current isolated publish E2E passed with the export allowed to the Admin and denied to a non-member.
- Production publishing now requires the full reusable CI workflow and restricts manual runs to `main`. Production image preflight validates RDPS/ClamAV repository identity, digest-pinned infrastructure images, and five required HTTPS smoke URLs before backups or migrations.
- The deployment script now retries routed API/web/public/sitemap/Admin checks, validates API database/Redis readiness, checks healthy replicas for API/worker/web/Prometheus/Alertmanager, checks Prometheus/Alertmanager readiness, and verifies exporter/internal API/web targets and probe values. The worker healthcheck pings Redis.
- At that checkpoint, `pnpm test` passed 370 tests (including 15 operations tests), `pnpm test:browser` passed 21/21, and typecheck, lint, formatting and build passed. The 21-migration isolated publish/isolation flow passed. The production worker image built and its Redis probe returned `PONG` against Dev Redis.
- Docker Dev API readiness, Admin root and sitemap return HTTP 200; all services are running and the database is current at 21 migrations. The image build temporarily terminated Dev API/Admin containers with exit 137; both were restarted and rechecked. Dev PostgreSQL and Redis volumes were not changed.
- The Phase 7 verification groups above remain unchecked. Production image publication/rollout, production secrets and integrations, external alert receipt, DNS/TLS/ingress, owner-approved and measured RPO/RTO with encrypted off-host restore, external 99.9% SLO evidence, production ClamAV operations, and formal manual WCAG/assistive-technology review remain open. Persistent-Dev authenticated E2E also remains unrun because the credential variables are absent from this runtime.

## Current verification — 2026-11-12

- Independent production-readiness review found that the API was attached to the public ingress `edge` network, allowing ingress containers to bypass the Nginx web proxy. The production API now joins only `private`, `monitoring`, and `egress`; the blackbox exporter uses those same networks for private and outbound probes. Only the web service remains attached to `edge`, and Prometheus can still scrape the API through `monitoring`.
- Hardened GHCR release publication: the workflow checks out complete history and requires the release commit to be an ancestor of `main`, for tag pushes as well as manual dispatches. This prevents a semver tag on an off-main commit from publishing production images.
- Added `production-network-isolation.test.mjs`. It failed against the exposed topology, then passed after the network change. Production preflight's synthetic digest-pinned fixture validates the rendered Compose configuration.
- Current verification passed: `pnpm test` (374 total: 356 package tests and 18 operations tests), `pnpm test:browser` (21/21), `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm format:check`. `pnpm e2e:isolated-publish` applied all 21 migrations, passed the complete isolated publish/isolation flow, and cleaned up its owned PostgreSQL/Redis containers.
- Re-ran the isolated performance benchmark with 100 projects, 10,000 published snapshots, and 400 requests (100 per endpoint). It recorded zero errors, 400/400 warmed-cache hits, and cached p95 of 19.02 ms directory, 18.10 ms history, 21.20 ms search, and 17.64 ms latest; all meet the `<500 ms` target. Sampled API-process memory was 195,457,024 bytes baseline and 232,570,880 bytes peak. This is local performance evidence, not production availability evidence.
- Fresh PostgreSQL backup/restore round trip passed with representative project, release, publication, snapshot, changelog, and audit records verified. Attachment archive/checksum/restore passed, including overwrite refusal and rejection of a backup destination nested under the source. These are local drills; off-host encryption/retention and approved production RPO/RTO remain external gates.
- Docker Dev API readiness reports PostgreSQL and Redis healthy; Admin, public home, and sitemap return HTTP 200. The Compose stack remains running.
- Updated the design status to approved for implementation, reflecting the user's direction to proceed with the full-product design. Production publication/deployment, owner-controlled secrets and external evidence, persistent-Dev authenticated E2E credentials, and formal manual accessibility review remain open.
- The connected GitHub integration returned no installed repository matching `release-docs-system`, and this workspace has no Git metadata. The image workflow is verified locally; GHCR publication itself remains unexecuted.
- An independent read-only audit of Phases 1–6 found no concrete locally fixable requirement gaps. It identified persistent-Dev authenticated E2E, formal manual WCAG/assistive-technology review, and live provider/production validation as still weakly verified or deployment-owned.

## Encrypted off-site backup implementation — 2026-11-12

- Added `scripts/operations/backup-offsite.sh`: requires a Restic S3-compatible repository and a protected Restic password, accepts exactly one PostgreSQL archive plus one attachment archive, verifies both SHA-256 sidecars and archive formats, then uploads them together in one `rdps` snapshot. Retention defaults to 7 daily, 4 weekly, and 12 monthly snapshots and runs only after successful upload.
- Added operations tests for the valid upload/retention path, invalid repository/password/retention, corrupted archive, and failed-upload/no-prune behavior. The focused checks passed 6/6; latest full `pnpm test` passed 380 tests (356 package tests and 24 operations tests). Bash syntax validation passed.
- Documented S3 repository provisioning, secret injection, retention variables, recovery checks, and protected staging cleanup in both backup runbooks. The off-site path is implemented but has not been run against a real S3-compatible bucket; Restic is not installed in this runtime. Bucket credentials, immutability/lifecycle, access policy, and owner-approved RPO/RTO remain deployment-owned evidence.
- Latest `pnpm format:check` passed. Docker Dev containers remain running; API readiness, Admin, public home, and sitemap returned HTTP 200. The persistent-Dev E2E email/password variables are still absent in this runtime, and Restic is not installed here for a live S3 repository run.
- Final verification sweep passed: forced sequential production build (9/9 tasks), typecheck (9/9), lint (9/9), `pnpm test` (380), Playwright (21/21, including axe and responsive viewport checks), `pnpm format:check`, and Bash syntax validation. The browser suite's axe checks do not replace the still-pending manual WCAG/assistive-technology review.
- Re-ran `pnpm e2e:isolated-publish` against current source: all 21 migrations applied, synthetic admin bootstrap succeeded on disposable services, publish/audience/attachment/revocation/deployment flows passed, and the script removed its owned PostgreSQL and Redis containers. Docker Dev API/Admin/public/sitemap remained HTTP 200 after verification.
- Actual GHCR publication/production rollout, live external integrations and alert receipt, persistent-Dev authenticated E2E, production uptime evidence, DNS/TLS/ingress validation, and formal manual WCAG/assistive-technology review remain open.

## Scheduled off-site backup orchestration — 2026-11-12

- Added `scripts/ops/backup-production.sh` as the shared host entrypoint for both releases and scheduled runs. It takes a nonblocking `flock`, creates a unique mode-0700 recovery-point directory, starts/verifies PostgreSQL and Redis through production Compose, runs the existing database and attachment archive tools, uploads the pair as one Restic snapshot, and preserves per-run status/artifacts on failure. Restic JSON output is mode 0600; manifests record snapshot ID, archive checksums, upload state, and retention outcome without credentials.
- Production deployment now completes the encrypted backup before migration. Production preflight requires an S3-compatible Restic repository, a strong repository password, a fixed Node Exporter textfile metrics path, and the operator-approved expected interval. Added hardened systemd oneshot/timer units; their default persistent daily 02:15 UTC schedule must be reviewed against the service owner's RPO before installation/enabling.
- Added Node Exporter backup success/freshness/retention metrics and Prometheus alerts for missing status, failed jobs, and overdue successful uploads. Updated deployment, backup/restore, monitoring, and release-checklist runbooks. Failed local bundles are retained for diagnosis; local artifact cleanup policy remains an operator decision to avoid deleting recovery data without an approved retention policy.
- Fresh verification passed: `pnpm test` (390 total: 356 package and 34 operations), `pnpm build` (9/9 tasks), `pnpm typecheck` (9/9), `pnpm lint` (9/9), `pnpm format:check`, `pnpm test:browser` (21/21 including axe/responsive checks), focused Bash syntax and operational tests, and `pnpm e2e:isolated-publish` (all 21 migrations; publish, audience, attachment, revocation, analytics, and deployment flows; owned containers cleaned up). Docker Dev API readiness and Admin/public roots returned HTTP 200.
- Production Compose could not be rendered on this workstation because deployment-only secrets and digest references are unset; preflight tests cover synthetic valid/invalid configurations. `systemd-analyze` could not run because this Windows host has no installed WSL distribution. Restic is not installed and no S3 credentials/repository were provided, so live encrypted upload, remote retention, and restore drill remain unverified.
- The E2E administrator email/password remain absent from Process/User/Machine environment scopes despite the user's intent to set them; persistent-Dev authenticated E2E is still pending. GHCR is the selected registry, but publishing/rollout still requires a connected repository/CI identity and deployment approval.
- Remaining launch evidence: owner-approved RPO/RTO and local artifact policy; real S3 bucket/access/lifecycle plus production backup/restore drill; GHCR immutable publication/rollout; production integrations/secrets and alert receipt; DNS/TLS/ingress and measured 99.9% uptime; persistent-Dev authenticated E2E; manual WCAG 2.2 AA/assistive-technology review. The browser axe suite is not a substitute for the manual accessibility review.

## Isolated sandbox deployment verification — 2026-11-12

- RED — Ran the new post-success health assertion in isolation. It exited 1 with `RDPS_E2E_SANDBOX_TARGET_URL is required to verify deployment.` Then ran `pnpm e2e:isolated-publish` before wiring the target. It applied all 21 migrations, exited 1 during runner startup with `DEPLOYMENT_TARGET_URL must be a valid absolute URL`, and removed both owned containers. The runner startup failure prevented that run from reaching the new assertion.
- GREEN — Re-ran `pnpm e2e:sandbox-deployment` on current source. It exited 0 with disposable PostgreSQL/Redis, all 21 migrations applied, and synthetic administrator bootstrap. The API deployment request reached `SUCCEEDED`; the signed sandbox target reported the exact active project `c15aac4e-9b7f-4063-9952-c2452f725c01`, environment `10e56744-7662-4d7c-b836-e45d54450558`, and release `bc1885c5-2ea4-4c71-826a-f5b17165d83f`. Replaying the API trigger preserved one API request and the target recorded exactly one signed delivery (`apiTriggerCount: 1`, `targetDeliveryAttempts: 1`). Target unit coverage confirms duplicate signed deliveries are separately counted. The harness removed its owned PostgreSQL and Redis containers.
- Fresh `pnpm test` passed all 13 package tasks and 78 operations/dev-runner tests. The temporary verification PATH supplied `jq` required by the production operations checks. `pnpm typecheck`, `pnpm lint`, and `pnpm build` each passed 9/9 tasks; `pnpm format:check` passed; `pnpm test:browser` passed 21/21, including automated axe checks at desktop and 320/390/460 px. Docker Compose config validation passed. API readiness, admin/public roots, and sitemap returned HTTP 200; API, runner, sandbox target, PostgreSQL, and Redis report healthy. The sandbox target remains private to the Compose network; a request from the runner container returned its health payload with empty current-session attempt counters.
- Owner-controlled production gates remain open. These include GHCR publication and digest-based rollout, live runner and provider integrations, production credentials and alert delivery, DNS/TLS/ingress, availability evidence, approved RPO/RTO and off-site recovery, and manual WCAG/assistive-technology review. This verification used the isolated harness with its synthetic administrator. Persistent Docker Dev authenticated verification remains outstanding: `RDPS_E2E_ADMIN_EMAIL` and `RDPS_E2E_ADMIN_PASSWORD` are absent from this shell's process, user, and machine environment scopes.

## External gate recheck — 2026-11-12

- The current shell has no RDPS persistent-E2E admin variables, GitHub/GHCR credentials, Restic repository/password, or AWS S3 credentials in process, user, or machine environment scopes. No secret values were read into output.
- The connected GitHub account search returned no repository named `release-docs-system`; the workspace itself has no Git metadata. The GHCR workflow is implemented, but a real publish/rollout run cannot be evidenced from this workspace/account state.
- The Codex-in-Chrome extension tools required for the user's requested Brave extension workflow are not exposed in this session. Automated browser/axe checks are recorded above; manual keyboard/assistive-technology/WCAG sign-off remains open.
