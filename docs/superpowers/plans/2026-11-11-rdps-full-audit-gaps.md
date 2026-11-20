# RDPS Full Product Audit Gaps Implementation Plan

> **For agentic workers:** Continue the approved full-product implementation. Use `superpowers:subagent-driven-development` for independent tasks and TDD for behavior changes. Do not mark a requirement complete without fresh evidence.

**Goal:** Close the full-design requirements omitted from the previous tracker: shared UI primitives, browser-level quality checks, isolated current-source publish E2E, fresh read-benchmark evidence, and architecture/security/API documentation.

**Architecture:** Keep the existing pnpm/Turborepo monorepo and React/NestJS modular monolith. Implement a small in-house accessible React primitives package and adopt it in both web apps without a wholesale visual rewrite. Run browser tests headlessly with Playwright and axe. Run publish E2E with disposable PostgreSQL/Redis containers and synthetic credentials, never the persistent Dev database. Document the running architecture and generate API reference from the application's OpenAPI document.

**Tech Stack:** TypeScript, React, Vite, NestJS, Prisma, PostgreSQL, Redis/BullMQ, Playwright, axe-core, Docker Compose, Markdown/Mermaid.

**Spec:** `docs/superpowers/specs/2026-11-10-rdps-full-product-design.md`; `docs/superpowers/plans/2026-11-10-rdps-full-product.md`; findings in the full completion tracker.

## Global constraints

- Keep server-side project authorization, public snapshot-only delivery, audience isolation, and revocation behavior intact.
- Do not read, reset, or modify the persistent Dev PostgreSQL/Redis/attachment volumes from isolated E2E or benchmark runs.
- Generate synthetic E2E credentials per run and keep them out of logs and checked-in files.
- Any Docker resources created by a script must be uniquely named, ownership-labeled, and cleaned up only by that run.
- Automated axe results and browser smoke checks do not replace manual keyboard, assistive-technology, or formal WCAG evidence.
- Local build, benchmark, and monitoring checks do not establish production SLO or deployment evidence.

## Review focus

- Isolated E2E cleanup must never target the running Dev Compose project or its named volumes.
- Parallel image builds can exceed the available 1.9 GiB Docker memory; build orchestration must limit concurrency.
- UI primitives must preserve visible keyboard focus, accessible names, labels, and existing workflows in both apps.
- Browser tests must exercise both web applications at desktop and narrow viewport sizes and report axe violations with route and viewport context.
- API reference generation must be reproducible from the current OpenAPI document and must not include runtime secrets or local-only values.

## Tasks

### Task 1 — Shared accessible UI package

- [x] Support table, row, header-cell, and data-cell nodes with strict parent-child structure in validated rich release documents; the focused suite passed 22/22.
- [x] Add failing render/accessibility contract tests for shared Button, TextField, TextArea, Panel, Badge, PageHeading, EmptyState, and StatusBadge primitives.
- [x] Implement typed React primitives and shared CSS/tokens in `packages/ui` with React as a peer dependency.
- [x] Add `@rdps/ui` workspace dependencies and adopt the shared primitives in representative high-traffic admin and public views, retaining app-specific behavior and layout.
- [x] Run the UI package tests plus workspace typecheck, lint, and build; confirm both applications bundle the shared package. The UI suite passed 8 tests; admin/public suites passed 32/18; all 12 scoped Turbo tasks passed.

### Task 2 — Isolated publish and isolation E2E

- [x] Add an isolated E2E runner that creates disposable PostgreSQL and Redis containers without persistent mounts, selects collision-free host ports, and assigns unique labels/names.
- [x] Start the API, worker, and local deployment runner against those containers with per-run secrets; apply all 21 migrations and bootstrap a synthetic admin.
- [x] Run `scripts/e2e/full-publish-flow.mjs` against the isolated API, covering cache behavior, two-project denial/positive controls, public route behavior, and deployment runner completion.
- [x] Guarantee child-process/container cleanup in success, failure, and interruption paths; actual tmpfs ownership was accepted and named-volume/bind-mount cases were rejected.
- [x] Document and run `pnpm e2e:isolated-publish` against current source while the persistent Dev stack remained untouched.

### Task 3 — Browser quality suite

- [x] Add Playwright and axe-core browser test tooling and a CI setup that installs the Playwright-pinned Chromium.
- [x] Cover critical admin and public entry views at desktop and 320/390/460 px mobile widths; exercise release authoring, structured bulk change updates, public release detail/attachment navigation, no horizontal overflow, accessible names, and public SEO metadata.
- [x] Run axe WCAG 2.2 AA scans on both applications at desktop and all three mobile widths; initial scans found low-contrast text and collapsed navigation names, which were corrected. The latest full run reported no violations.
- [x] Add a 5-second DOMContentLoaded budget and capture traces, screenshots, video, and axe JSON artifacts on failure. Automated checks do not replace manual WCAG sign-off.
- [x] Run the suite against isolated Vite servers using mocked API requests, separate from Docker Dev; all 18 browser tests passed.

### Task 4 — Current-source public read benchmark

- [x] Run the isolated 100-project/10,000-snapshot benchmark harness against current source after the public API/cache changes.
- [x] Record command, dataset size, request count, error/cache-hit rates, latency quantiles, and memory scope in the tracker.
- [x] Keep cached latency results separate from production uptime/SLO claims.

### Task 5 — Architecture, security, and API references

- [x] Add a system context/data-flow diagram and ADR describing the modular monolith, PostgreSQL/Redis boundaries, public snapshots, worker queues, and deployment runner.
- [x] Add a threat model covering tenant isolation, admin sessions, public delivery/cache, attachments, webhooks, queues, secrets, and deployment execution, with current mitigations and residual risks.
- [x] Add a security policy and responsible-disclosure instructions without inventing an unapproved contact address.
- [x] Generate and check in an API reference from the current OpenAPI document; document the regeneration command and freshness check.
- [x] Link the new artifacts from the root documentation and review the Markdown/Mermaid and generated API document; the policy explicitly leaves the monitored disclosure contact for the repository owner to configure.

### Task 6 — Completion reconciliation

- [x] Re-run formatting, workspace tests, typecheck, lint, build, isolated E2E, browser suite (18 passed), public-read benchmark (400 requests, zero errors), production Compose config validation with synthetic values, and Docker Dev health checks after integration. Fresh API tests passed 243/243; monitoring config validation remains current from the production verification run; monitoring files were not changed in this continuation.
- [x] Reconcile both the full-product tracker and launch-readiness plan; deployment-owned gates remain open until their evidence exists.

## Execution order

Run Task 1, Task 2, Task 3, and Task 5 as independent, reviewable workstreams with non-overlapping files; Task 4 may run independently after confirming Docker headroom. Integrate and verify all changes in Task 6.
