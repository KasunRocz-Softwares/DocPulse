# SDD ledger — plan: docs/superpowers/plans/2026-11-11-rdps-full-completion-tracker.md

## Workspace and baseline

- Workspace: `E:\KR Softwares\release-docs-system`.
- The directory is not a Git repository; managed Git worktrees and commit-based recovery are unavailable. Changes are being made in the authorized workspace and separated by explicit file ownership.
- Approved authority: `docs/superpowers/specs/2026-11-10-rdps-full-product-design.md`; execution detail: `docs/superpowers/plans/2026-11-10-rdps-full-product.md`.
- Baseline graph index: project `release-docs-system`, 488 nodes / 954 edges; refreshed implementation checks should re-index after feature slices settle.

## Work allocation

- Local: project membership/administration APIs, release metadata lifecycle, release comparison, integration and cross-scope review.
- Agent Euclid: `apps/admin-web/**` only.
- Agent Mendel: `apps/api/src/public/**` and `apps/public-web/**` only; root module wiring reserved for local integration.
- Agent Hubble: `apps/api/src/integrations/**` and `apps/worker/**` only; root module wiring/schema reserved for local integration.
- Agent Hooke: `apps/api/src/release-content/**` only; module wiring/schema reserved for local integration.

## Rulings

- Ruling: Project membership reads return 404 for a non-member and do not query member rows — this preserves project existence privacy; project members without ADMIN role receive 403 for member administration — selected to satisfy project-scoped authorization while avoiding cross-project discovery.
- Ruling: Removing or demoting the final project administrator is rejected inside a serializable transaction — this prevents accidental project lockout; database contention can produce a retryable transaction conflict.
- Ruling: Release comparison identifies matching changes by repository/reference identity, falling back to normalized category/title — references are stable across releases while titles handle unlinked changes; duplicate identical unlinked titles are paired by occurrence order.
- Ruling: No public query is allowed to join internal release/change/document records at request time — public delivery must depend on publication snapshots only.

## Completed local slices

- Added API test runner using Node's built-in test framework and `ts-node`.
- Added project-member listing with admin policy and project-scoped filtering.
- Added member add/update/remove operations with audit records and final-admin protection.
- Added repository management, environment listing/update, and paged project audit query endpoints.
- Added draft/rejected release metadata updates with version/channel uniqueness conflict mapping and audit events.
- Added internal release comparison by stable references with normalized-title fallback.
- RED/GREEN evidence: project membership test first failed because `listMembers` was absent; release comparison first failed because module was absent; release update first failed because method was absent. Current focused API tests: 7 passed, 0 failed (project members, release comparison, release update).

## In-flight integration notes

- Parallel agents expose their in-progress source in the shared workspace. A build/typecheck during their edits failed on incomplete public/integration/release-content files, so it is not an integration verdict. Full checks must be rerun after all agent reports and local module wiring.
- Agent files currently use `.spec.ts`/`.test.ts` in `src`; API test discovery includes these. Reconcile test conventions and dependencies before declaring the suite healthy.

## Final review

- Pending: wire modules, run full typecheck/build/lint/test and migration checks, run API and UI smoke tests, review authorization/public isolation, update the completion tracker with evidence, and leave every unavailable production capability explicitly unchecked.

## Continued full-product implementation — 2026-11-11

- Added auth session listing/revocation and password-change behavior; password changes verify the existing credential, preserve the current session, revoke other sessions, and audit the change. Added a local password identity-provider adapter and an OIDC authorization-code interface boundary.
- Added authorization-scoped public-approval review queue endpoint and an atomic pending-to-decision transition to prevent concurrent reviewers from recording duplicate decisions.
- Added admin-only project branding APIs for colors, HTTPS logo URLs, and BCP 47 default locale; updates are audited. Custom-domain verification is still pending.
- Added project-membership-scoped internal release/change search with bounded page size.
- Added admin-web HttpOnly-cookie credentials and single-flight access-token refresh/retry; client tests, typecheck and production build passed.
- Latest observed API test suite before branding/search test additions: 52 passed. Focused auth tests: 7 passed; publishing queue/race tests: 4 passed; branding tests: 6 passed; internal search/release tests: 6 passed. API typecheck and build passed after the auth/branding work; typecheck passed after search work. Re-run full build and suite after parallel slices settle.
- Parallel work: Rawls owns integration queue/schema/Compose/module wiring (also asked to register ReleaseContentModule and snapshot brand fields); Arendt owns admin workflows including review queue, project settings, release content and security settings; Hilbert owns CI/production runtime/backup and restore artifacts. Hegel completed a read-only audit and was closed.
- Audit finding: all seven completion-tracker groups remain unchecked; schema-only capabilities are not counted. Public attachment snapshot linkage, subscription delivery, verified custom domains, analytics/export, AI, deployment orchestration, production readiness and end-to-end evidence remain open pending implementation.

## Continued full-product implementation — invitation lifecycle

- Added expiring, single-use project invitations. The database stores only SHA-256 token hashes; the raw token is returned once to the project administrator, is excluded from audit metadata, and expires after seven days. Reissuing an invitation revokes the prior pending token for that project/email.
- Added public invitation acceptance with password creation, compare-and-swap claim/activation, refresh-session issuance, and audit events. Existing active or suspended accounts cannot use an invitation to reset credentials.
- Added an invitation acceptance screen to the admin app and a one-time copyable invite link after member administration.
- Added `ProjectInvitation` Prisma model and migration `20261111093000_project_invitations`. `migrate dev` detected a pre-existing edited migration checksum and proposed destructive reset; preserved existing development data by generating a forward-only diff and applying it with `migrate deploy` instead.
- Verification: full API suite 65/65 passed; API typecheck/build passed. Admin-web suite 17/17 passed; typecheck/build passed. Focused invitation tests cover valid, expired, and concurrently consumed tokens; project tests cover token hashing and avoiding audit leakage.
- Added a reproducible `scripts/e2e/full-publish-flow.mjs` that creates a clean project, invites an independent reviewer, accepts the invitation, submits/approves/publishes a release, and verifies the snapshot-only public response. It requires explicit local Docker admin credentials through environment variables; full runtime execution is pending the current API/container rebuild.
- Restored workspace linting with ESLint flat config and wired `pnpm lint` into CI. `pnpm lint` passes with 5 existing React hook dependency warnings. The initial `pnpm format:check` uncovered broad existing formatting drift across 66 files; format cleanup is pending after parallel edits settle.
- Implemented DNS TXT custom-domain ownership requests and verification using the existing `ProjectBrand.settings` JSON: 24-hour challenge expiry, SHA-256-only persistence, constant-time hash comparison, project-admin authorization, and audited request/verify/remove operations. The admin panel is mounted into project settings, and public host resolution plus custom-host route support are implemented. Focused domain-verification tests passed (6/6) in the preceding pass; host-resolution tests now pass (3/3).
- Integrated the custom-domain panel into project settings and added public host resolution that maps only verified domains with an active published snapshot. The public app now supports project root, release history, changelog, search, and release paths on a custom hostname without rewriting the visible URL. Added API resolver tests and public route-mapping tests; API focused public-service tests pass (9/9), API typecheck passed before a parallel analytics module appeared, and public-web tests (6/6), typecheck, build plus admin-web typecheck/build pass.
- Analytics/export implementation is underway in a disjoint subagent-owned vertical. A concurrent API typecheck saw its new test file before its service implementation was written; the failure was reported to the owner and needs a fresh full typecheck after that work settles.
- Public attachment snapshot work has a red/green test seam: approval revision capture now filters to `publicAllowed && CLEAN` and freezes checksum, MIME type, file name, size, and source ID. Tests confirm that behavior; the publication snapshot test remains red while its new snapshot-attachment relation and public download gate are pending the shared schema migration window.
- Latest focused client verification: admin-web tests passed 19/19, typecheck and build passed; public-web tests passed 7/7, typecheck and build passed. Docker API health and admin/public HTTP 200 checks passed against the currently running containers (containers still need rebuilding from the final source state).
- Public-web localization is implemented for English, Sinhala, and Tamil with English fallback and snapshot/browser locale selection. The public-web agent reports 3/3 focused tests plus typecheck/build passed. Other locales currently fall back to English.

## Audit-driven continuation — 2026-11-11

- Refreshed the saved codebase-memory index before discovery; the full indexer crashed on a source file. The saved graph remains available but stale (488 nodes / 954 edges), so targeted code reads were used only where graph results were insufficient.
- A requirements-to-plan audit found implementation gaps that must remain open: OIDC runtime flow, client-specific audiences, GitHub App installation/repository lifecycle, project-authorized integration retry/diagnostics, and measurable accessibility/performance/production evidence. These are delegated or in progress; do not mark the corresponding phase gates complete before integration and verification.
- Deployment orchestration now enqueues idempotent BullMQ jobs, signs fixed HTTPS runner requests, retries and dead-letters failures, and records authenticated callback status. Focused verification reported 11 API deployment tests and 17 worker tests passing. Added a signed runner-status callback API and a development-only local mock runner; typecheck, compose runtime, and end-to-end checks for this extension are still pending.
- Production deployment operations now back up both PostgreSQL and the durable attachment volume before migrations. The Compose-backed PostgreSQL archive path passed against the local development database; attachment backup/restore safety tests passed, including a read-only named-volume archive and checksum check. Production preflight and development Compose configuration parsed successfully before the latest runner callback additions; rerun after integration.
- Docker development remains stale at this point: the previous API container is unhealthy from an earlier compile error and no worker exists. Rebuild/recreate application services after parallel source slices settle, preserving PostgreSQL/Redis/attachment volumes, then provision a local bootstrap administrator and run the expanded end-to-end flow.
- The completion tracker remains intentionally unchecked until the full suite, app build, migration status, Docker health, author/reviewer/publish/unpublish/attachment/export/runner flow, and public/client audience isolation have fresh evidence. Production external launch gates (DNS/TLS, provider secrets, alert receiver, encrypted off-host retention, measured SLOs) require actual environment evidence and cannot be inferred from configuration files.

## Continued full-product implementation — snapshots, analytics, AI, and deployment hardening

- Added immutable public attachment snapshots with source ID, storage key, file name, MIME type, byte count, and SHA-256. Submission includes only explicitly public, scan-clean attachments; publication rechecks exact reviewed metadata before copying; active snapshot downloads verify checksum and size and stop working after revocation. Applied migration `20261111130000_public_snapshot_attachments` forward-only to the existing dev database.
- Added project-admin attachment visibility controls and a public release attachment list. Private attachment APIs remain private and storage keys never enter public payloads.
- Wired the analytics/export panel into project administration and public clients now record aggregate project/release views without visitor identifiers. CSV and published-snapshot PDF exports remain project-authorized, queued, downloaded without caching, and audited.
- Wired AI summary suggestions into the API and release editor. Suggestions use public-candidate change descriptions, show source provenance, fill an editable field, and still require normal human review and approval. Provider URLs require HTTPS; regression coverage rejects HTTP before credentials can be sent.
- Updated production web API defaults to use same-origin `/api/v1`, retaining localhost defaults for development. Extended the E2E flow to check analytics, CSV/PDF export jobs, download access, and public revocation; CI now starts the worker for those checks.
- Verification: focused API coverage passed 46/46 across AI provider/service, public snapshots/attachments, release-content permissions, and approval snapshots. Full workspace tests passed: API 103/103, admin 19/19, public 7/7, plus worker tests. Workspace typecheck passed; lint passed with existing React hook dependency warnings; format check passed after formatting the workspace. `pnpm build` passed before the final production base-URL adjustment and will be rerun after deployment orchestration integration.
- Started the separate Task 21 deployment-orchestration API slice with agent Locke. Module wiring, integration review, migration status, Docker rebuild, and the extended end-to-end run remain pending.

## Final integration and Docker verification — 2026-11-11

- Integrated GitHub App `push`, `pull_request`, `issues`, and `release` event normalization into the existing retryable webhook ingestion path. Events are accepted only for repositories linked to the installation; unlinked repositories are ignored. Added signed-event routing coverage and updated the setup runbook.
- Rebuilt the Docker development image and recovered a slow API startup after Prisma generation/migration I/O stalled temporarily. The API subsequently started, reported healthy, and the complete Compose stack started without touching persistent volumes.
- Full Docker E2E passed: publication and revision approval, client-only visibility and authorized attachment download, public attachment snapshot and revocation, staging deployment runner success callback, analytics, CSV/PDF exports, and access revocation.
- Latest workspace verification passed: API 185 tests, admin 19, public 7, auth 6, and worker tests; `pnpm typecheck`, `pnpm build`, `pnpm lint`, and `pnpm format:check`; Docker Compose configuration and all 15 Prisma migrations are valid/up to date. Lint has 6 React hook dependency warnings and no errors.
- Development endpoints are responding: API health `:13001` (200), admin `:5173` (200), public `:5174` (200). Current service state and remaining production evidence gates are recorded in `2026-11-11-rdps-full-completion-tracker.md`.
- Remaining work is limited to deployment-specific evidence: real GitHub App and customer OIDC credentials, production DNS/TLS/ingress and alert routing, off-host backup retention/restore drill, measured SLO, and formal accessibility/performance audit. These cannot be truthfully certified from the local development environment.

## Public query scaling and latest verification — 2026-11-11

- Replaced unbounded public release/search hydration with PostgreSQL canonical-snapshot selection, scoped counts, and bounded page hydration. Directory/profile queries now aggregate in SQL, latest stable loads version identifiers plus one snapshot, and RSS loads at most 50 releases. History, changelog, and search UI expose URL-addressable pagination. Public snapshot IDs are removed from response payloads.
- Added composite indexes and migration `20261111200000_public_snapshot_read_indexes`. Prisma schema validation passes; migration application is pending because the local Docker engine is unavailable.
- Full workspace verification passed after the changes: API 195 tests, admin 21, public 7, auth 6, worker 18; typecheck, production builds, lint (0 warnings/errors), and format check. Attachment-volume backup/restore round-trip passed earlier in this continuation using disposable labeled volumes.
- Production Compose preflight/config and YAML syntax parsing passed with synthetic configuration. Production image build failed with Docker engine RPC EOF and npm registry timeouts; `promtool`, `amtool`, and Nginx config validation remain unrun.
- Docker Desktop restart attempts failed because backend/frontend processes remained active. Docker CLI engine calls time out; the previous healthy dev stack was not intentionally stopped or deleted, and named volumes were not removed. Current dev API, migrations, cache behavior, and full E2E cannot be verified until the engine recovers.
- Open: recover Docker Desktop and rerun cache-aware Docker E2E; apply migration; execute PostgreSQL backup/restore drill; seed/measure 100 projects and 10,000 releases; add cross-project HTTP boundary E2E and browser/axe/keyboard/viewport accessibility checks; complete production image and Prometheus/Alertmanager/Nginx validation; retain real credentials, DNS/TLS, alert delivery, off-host retention, and SLO evidence as external gates.

## Cross-project E2E expansion — 2026-11-11

- Extended `scripts/e2e/full-publish-flow.mjs` with a second isolated project and a non-admin member of the first project. It now asserts 404 isolation across project, release, member, repository, environment, audit, document, attachment, deployment, and integration-operation reads; attempts unauthorized release/document/member/repository/environment/deployment/attachment/integration writes; and checks internal search, public directory/detail, and public search for cross-project leakage.
- The script passes Node syntax and Prettier checks. Docker is still unresponsive, so these new HTTP assertions have not run against the API and remain an open verification gate.

## PostgreSQL recovery drill automation — 2026-11-11

- Added `scripts/operations/test-postgres-restore-roundtrip.sh`. It provisions unique labeled disposable containers and volumes, applies checked-in migrations, inserts linked project/release/approval/publication/snapshot/changelog/audit fixtures, exercises the existing backup/checksum/restore scripts, validates restored records, and removes only resources bearing its own run label.
- Added the round-trip script to CI. Git Bash syntax and a static resource-safety scan passed; `shellcheck` is unavailable. The database round trip itself remains unrun until Docker recovers.

## Public directory and E2E hardening — 2026-11-11

- Added server-side directory search and pagination in PostgreSQL, with page clamping and URL-backed query/page state in the public web UI. Release history/search list hydration is limited to three change previews and omits attachment metadata; detail/latest keep complete release content. Short searches consistently return page 1.
- Expanded E2E authorization controls with authorized requests to prove protected routes exist and accept valid data before testing non-member denial. Integration retry now expects 403 from the membership guard, which runs before event lookup; the test no longer depends on a fabricated event ID yielding 404.
- Verification passed: `pnpm test` (API 196, admin 21, public 7, auth 6, worker 18), `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`, Node syntax check, and Prettier check.
- Docker remains unavailable: the CLI engine call did not return, and earlier service inspection showed `com.docker.service` stopped with service start denied in this session. Docker-backed E2E, migration application, PostgreSQL restore round-trip, production image/config validation, and seed benchmark remain open.
- No Brave Chrome extension control is available in this session's browser tools, so no browser/axe/keyboard/viewport audit was run; no full-desktop browser automation was used.

## Expanded public route E2E assertions — 2026-11-11

- Added HTTP assertions for directory search, all public project and release routes while unpublished, and latest/history/changelog/changes/RSS/share routes after publication. Existing client-only and revoke checks remain part of the same flow.
- `node --check` and Prettier checks pass for the E2E script. Docker is still stopped (`com.docker.service` stopped; API/web ports closed), so these assertions are prepared but not executed against a running service.
- Added and passed an API regression assertion that paged public snapshots do not expose their internal database ID or attachment metadata.
- Docker startup diagnosis: Desktop CLI says the app is running but engine status remains `starting`; `desktop-linux` is the active context and WSL reports no installed distributions. Docker-backed work awaits WSL2/Linux-engine host setup.

## Public read benchmark harness and latest local verification — 2026-11-11

- Implemented the isolated performance harness for 100 projects and 10,000 published snapshots. It owns only run-labeled temporary containers/volume, applies migrations to its fresh disposable database, validates seeded HTTP responses, warms Redis-backed reads, records p50/p95/p99, errors, cache hit rate, and sampled API memory, and cleans up only resources carrying its own run label.
- Added tests for latency quantiles, empty samples, Docker ownership-inspection arguments, safe run IDs, and fixed fixture SQL; root `pnpm test` now runs these five operations tests after the workspace suites.
- Fixed Windows process launching so the harness can invoke the `pnpm.cmd` shim. `node --check`, focused operations tests, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm format:check` pass.
- Attempted benchmark preflight. `docker info` timed out because Docker Desktop reports `starting`; the script exited before creating any benchmark resources. No benchmark measurement or migration application is claimed.
- A parallel review found no defects in fixture/schema alignment, API route assumptions, resource ownership, cleanup guards, or API readiness checks. The review independently confirms Docker-backed SQL execution is still unverified.
- Added a live local Nest HTTP test around the production webhook controller and ingestion service. It verifies invalid GitHub signature rejection, stale timestamp rejection despite a correctly computed HMAC, and duplicate delivery response/event identity with the same deterministic BullMQ job ID; API unit tests pass 197/197, with API typecheck and lint passing. The adapters use in-memory persistence and queue doubles, so Docker-backed persistence/worker delivery remains open.
- Browser audit remains open because this session exposes no Brave Chrome-extension control tool. Full-desktop browser automation was not used.

## Current-source closeout — 2026-11-12

- Fixed custom-domain routing for `/changelog`, `/search`, and `/releases` history. Regression coverage confirms metadata routing and unsupported-route 404 behavior.
- Implemented authorized CSV/JSON internal release-comparison downloads with audit logging and admin controls. The browser test exposed and fixed the UI/API response-shape mismatch; the UI now renders `comparison.changes`.
- Added the GHCR image-publishing workflow for semantic tags/manual dispatch, producing API, worker, migration, web, and Alertmanager images with provenance/SBOM and an immutable digest manifest. Production preflight and deployment require digest-pinned RDPS and ClamAV images and pull the reviewed digests before migration/rollout.
- Final local verification passes: 360 workspace/operations tests, 20 Playwright browser tests, typecheck, lint, formatting, and production build. The isolated publish/isolation E2E applies all 21 migrations and passes against disposable PostgreSQL/Redis without touching persistent Dev volumes.
- Docker Dev API readiness, admin root, public root, and sitemap return HTTP 200. The stack remains healthy.
- External launch gates remain open: actual GHCR publication and deployment, deployment-owned secrets/integrations, DNS/TLS/ingress, live email and alert delivery, production RPO/RTO and encrypted off-host restore, external 99.9% SLO evidence, formal manual accessibility review. The authenticated E2E against the persistent Dev database remains unrun because the credential variables are absent from this runtime.

## Full-product closeout continuation — 2026-11-12

- Completed project-scoped audit-history CSV export: project-admin authorization, no-store attachment response, cursor-paged streaming without a row cap, formula-safe cells, audit of the export action, and a matching Admin project-panel download with accessible feedback and object-URL cleanup.
- Added the export to the isolated HTTP publish/isolation flow. The Admin user can export its own project's CSV; a project non-member is denied. The isolated run passed and applied all 21 migrations on disposable PostgreSQL/Redis, then cleaned up its owned containers.
- Hardened release publishing: the GHCR workflow calls the full reusable CI workflow before publishing, and manual publication is restricted to `main`. Production manifests include the approved GHCR owner; preflight enforces that RDPS image paths match that owner, ClamAV matches its approved repository, and PostgreSQL, Redis, Prometheus, and all exporters use digest references.
- Latest verification: `pnpm test` passed all 368 tests (252 API; 34 Admin; 19 Public; 8 shared UI; 6 auth; 11 config; 2 public model; 1 types; 4 validation; 18 worker; 13 operations). `pnpm test:browser` passed 21/21, including audit export and axe/responsive checks. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `pnpm build` passed.
- Docker Dev remains healthy; API readiness, Admin root, and public sitemap each returned HTTP 200; database migrations are current. Authenticated E2E against the persistent Dev DB remains unrun: `RDPS_E2E_ADMIN_EMAIL` and `RDPS_E2E_ADMIN_PASSWORD` are not present in this Codex process.
- Production launch evidence remains open: actual GHCR publication and rollout, production secret/integration configuration, DNS/TLS/ingress, live email and alert delivery, production RPO/RTO and encrypted off-host restore, external 99.9% SLO evidence, and formal manual WCAG/assistive-technology review. Local implementation and tests do not establish these deployment-owned gates.

## Production smoke-gate completion — 2026-11-12

- Replaced the deployment script's two-URL check with a retrying production smoke suite for API readiness, web health, public home, sitemap XML, the Admin application page, and healthy API/worker/web/Prometheus/Alertmanager containers. Prometheus and Alertmanager readiness endpoints are also checked from inside their containers.
- The smoke suite validates API database/Redis readiness content and checks Prometheus target state for PostgreSQL/Redis exporters and the internal API/web probes; exporter containers are not incorrectly treated as Docker-healthchecked services.
- Added a production worker healthcheck that pings its configured Redis connection; the release smoke suite now requires this healthcheck to pass.
- Updated the production deployment runbook with the routed URL variables and the checks that must pass. Live test-alert delivery remains a separate operator gate because its result depends on the configured external receiver.
- Production preflight now requires every routed smoke-check URL and rejects missing or non-HTTPS targets before backup or migration work begins. The smoke check validates API/database/Redis readiness, routes and sitemap, every replica's container health, exporter/internal-probe target health, and actual API/web `probe_success` values.
- Latest checks pass: all 370 workspace and operations tests, typecheck, lint, formatting, and production build. The Docker-backed isolated publish/isolation E2E (including audit-export authorization) and 21 browser tests also pass from the preceding closeout run.
- Built the production worker image and ran its Redis healthcheck code from that image against the healthy Dev Redis; the probe returned `PONG`. The image build temporarily caused the Dev API and Admin containers to exit 137 under resource pressure; both were restarted, API readiness/Admin/public checks returned HTTP 200, and all Dev services are running again. PostgreSQL and Redis volumes were not changed.
- Production has not been deployed from this workspace. GHCR publication, deployed HTTPS route checks, real alert delivery, backup restore and measured RPO/RTO, external uptime measurement, and manual assistive-technology review therefore remain unverified.

## Host resource monitoring and current verification — 2026-11-12

- Added a digest-pinned, read-only Node Exporter service on the isolated production monitoring network and a Prometheus scrape target for host metrics. Added alerts for exporter availability, low disk, low available memory, and sustained high CPU.
- Production preflight now requires `NODE_EXPORTER_IMAGE` to be digest-pinned. Deployment pulls and starts the exporter, and the production smoke check requires its Prometheus target to be healthy. Updated CI fixtures and production/monitoring runbooks.
- Verification passed: `pnpm test` (372 total, including 17 operations tests), `pnpm lint`, `pnpm typecheck`, and `pnpm format:check`; `bash -n` on deployment/preflight/smoke scripts; Prometheus config and all 11 alert rules validated by `promtool`; focused monitoring/preflight/deployment tests passed 9/9.
- Docker Dev is running. API readiness at `http://localhost:13001/api/v1/health/ready`, Admin at `http://localhost:5173/`, public home at `http://localhost:5174/`, and sitemap at `http://localhost:5174/sitemap.xml` each returned HTTP 200; readiness reports database and Redis healthy.
- Host exporter has not been launched against a production host; the required approved image digest, actual GHCR publication/deployment, and all deployment-owned launch evidence remain open. Persistent-Dev authenticated E2E remains unrun because its credentials are not present in this process.

## Production ingress isolation and full verification — 2026-11-12

- Independent production configuration review found the API joined the ingress edge network, permitting ingress containers to bypass Nginx. Removed that attachment and moved the blackbox exporter to private/monitoring/egress, leaving only the web proxy on ingress while retaining internal health probes and controlled external probes. Documented the network boundary in the production runbook.
- Added a regression test and observed it fail against the exposed topology, then pass with the corrected network. The production preflight's synthetic, digest-pinned fixture validates the Compose file.
- Fresh verification passed: 374 workspace/operations tests (356 package tests and 18 operations tests), 21 browser tests, typecheck, lint, build, formatting, and the isolated full publish/isolation E2E with all 21 migrations. Docker Dev readiness, Admin, public home, and sitemap checks remain HTTP 200.
- Re-ran the 100-project/10,000-snapshot public-read benchmark: 400 requests, zero errors, 400/400 warmed-cache hits; cached p95 was 19.02 ms directory, 18.10 ms history, 21.20 ms search, and 17.64 ms latest. The `<500 ms` cached p95 target passed. This does not certify production uptime.
- Fresh PostgreSQL backup/restore passed with representative release and audit data verified. Attachment backup/restore passed checksum verification, safe extraction, no-overwrite behavior, and source/destination boundary checks. Production off-host retention and approved RPO/RTO still need deployment-owner evidence.
- Hardened `.github/workflows/release-images.yml` so both pushed tags and manual publication require a release commit reachable from `main`; the workflow fetches complete history before ancestry validation. The operations regression test failed before this guard and passes afterward. A connected GitHub repository was not available, so no live image publish was attempted.
- The full-product tracker now labels the 370-test result as a prior checkpoint and records the 373-test run as current. External production launch evidence and the persistent-Dev authenticated flow remain open.
