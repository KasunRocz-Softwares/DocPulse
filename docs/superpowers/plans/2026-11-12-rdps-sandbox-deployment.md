# RDPS Local Sandbox Deployment Implementation Plan

> **For agentic workers:** Execute with the already authorized subagent-driven development approach. Tasks use checkbox syntax and each behavior is tested before implementation.

**Goal:** Make the Docker development deployment path apply an approved release to an observable sandbox target and report success only after the target confirms the deployed release is healthy.

**Architecture:** Keep the configured production runner contract unchanged. Replace the development runner's unconditional success simulation with a signed call to a dedicated local target service, which atomically records the release per environment and exposes deployment health. The runner reports RUNNING, SUCCEEDED, or FAILED through the existing signed RDPS callback.

**Tech Stack:** Node.js 22, built-in HTTP/crypto/filesystem APIs, Docker Compose, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-10-rdps-full-product-design.md`, Task 21 in `docs/superpowers/plans/2026-11-10-rdps-full-product.md`.

## Global Constraints

- Deployment triggers require explicit authorization, environment policy, idempotency, and a complete audit trail.
- Deployment execution never publishes or changes the release.
- Secrets are read from process environment and never persisted in request records or status summaries.
- Keep the production runner contract and production Compose stack unchanged.
- Local HTTP is permitted only on the private Docker development network.

**Ruling:** The dev runner durably journals accepted dispatches before returning `202`, resumes unfinished work after restart, and retries authenticated status callbacks and transient health probes. This matches the existing deployment-runner runbook's durable acceptance and reconciliation contract. The tradeoff is a small persistent runner-state volume and additional failure-path tests.

## Review Focus

- Replayed request IDs must not apply a deployment twice; verify the target receives one state change.
- A target failure or unhealthy deployment must never produce SUCCEEDED; verify a FAILED callback.
- The target must reject expired, malformed, or invalid signatures before changing state.
- A restarted target must retain its active environment-to-release mapping; verify persistence across process restart.
- A journal write failure must not leave an in-memory accepted job that makes a later retry return `202` without persistence or scheduling.
- Status summaries and logs must not contain signing secrets or raw provider response bodies; assert only constrained result codes and safe summaries.

---

### Task 1: Persistent sandbox target

**Files:**

- Create: `scripts/dev-runner/sandbox-target.mjs`
- Create: `scripts/dev-runner/sandbox-target.test.mjs`
- Modify: `docker-compose.yml`
- Modify: `package.json`

**Interfaces:**

- `POST /deploy` accepts the signed project/release/environment/request/idempotency fields.
- `GET /health` returns health and active deployment state without secrets.
- State is stored under `RUNNER_STATE_DIR` and atomically replaced after validation.

- [x] Write tests for valid apply, per-environment state, invalid signature/replay, duplicate idempotency, and state recovery after restart.
- [x] Run the focused Node test file and confirm the expected failures.
- [x] Implement the HTTP target with bounded body size, five-minute timestamp window, timing-safe HMAC comparison, same-key idempotency, and atomic durable state writes.
- [x] Add the service and named state volume to development Compose only; add `pnpm test` discovery for runner tests.
- [x] Run the focused tests and verify all scenarios pass, including the follow-up delivery-attempt diagnostic.

### Task 2: Runner applies and verifies target deployments

**Files:**

- Modify: `scripts/dev-runner/server.mjs`
- Create: `scripts/dev-runner/server.test.mjs`
- Modify: `docker-compose.yml`
- Modify: `docs/runbooks/deployment-runner.md`

**Interfaces:**

- Runner consumes the existing complete signed dispatch payload, including `projectId`, `releaseId`, `environmentId`, and `idempotencyKey`.
- Runner signs a fixed `DEPLOYMENT_TARGET_URL` request; it does not accept a target URL from the dispatch payload.
- Runner reports success only after bounded target health polling confirms the requested release is active.

- [x] Write HTTP integration tests for dispatch, exact target state, duplicate dispatch, unhealthy target failure, and RDPS callback ordering.
- [x] Extend tests for restart recovery, callback failures/retries, transient health probe errors, and cross-project health mismatches.
- [x] Run the focused integration test and confirm the expected failures.
- [x] Implement durable acceptance journaling before `202`, restart recovery, idempotent processing, target application, bounded retrying health probes, retried callbacks, fixed-host cleartext URL validation, no redirects, constrained callbacks, and safe error handling.
- [x] Configure the development runner to use the private target service and persist its journal; keep production configuration unchanged.
- [x] Update the runbook to describe the local sandbox deployment and retain its production-runner separation.
- [x] Run focused tests and the complete workspace test suite.

### Task 3: Docker end-to-end deployment proof

**Files:**

- Modify: `scripts/e2e/run-isolated-publish.mjs`
- Modify: `scripts/e2e/full-publish-flow.mjs`
- Modify: `package.json`
- Modify: `docs/superpowers/plans/2026-11-11-rdps-full-completion-tracker.md`

**Interfaces:**

- The isolated harness starts a temporary signed sandbox target and runner with run-scoped state directories, then passes `RDPS_E2E_SANDBOX_TARGET_URL` into the publish flow.
- The publish flow verifies the target's active deployment matches the governed request's project, environment, and release.

- [x] Extend the existing isolated publish/isolation E2E to start a temporary target and runner and verify the sandbox health state after the governed request completes.
- [x] Run `pnpm e2e:sandbox-deployment` with Docker and confirm the target reports the requested environment/release, the API trigger replay remains idempotent, exactly one signed target delivery is recorded, and the API reports successful completion.
- [x] Re-run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm format:check`.
- [x] Record fresh evidence and list the remaining owner-controlled production gates separately.
