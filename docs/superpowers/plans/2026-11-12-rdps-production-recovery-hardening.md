# RDPS Production Recovery and Release Hardening Plan

> **For agentic workers:** Execute this plan with TDD. Keep production release gating fail-closed and preserve recoverable state before any migration or service mutation.

**Goal:** Make the GHCR promotion, production deployment, off-site backup, restore, monitoring, and rollback path consistent and verifiable end to end.

**Architecture:** One immutable release manifest binds source commit and all production image digests. Deployment validates that manifest before taking a project-wide lock, then captures the existing production state before migrations or candidate service changes. Scheduled backups use the same lock and only inspect running services. Recovery artifacts include everything needed to verify a restore; restored attachments are readable by the application and accepted by the normal backup checks.

**Tech Stack:** GitHub Actions, Bash, Docker Compose, PostgreSQL, Restic, Prometheus, Node built-in tests.

**Spec:** `docs/superpowers/specs/2026-11-10-rdps-full-product-design.md`
**Tracker:** `docs/superpowers/plans/2026-11-11-rdps-full-completion-tracker.md`

## Global constraints

- A deployment must never mutate stateful services before capturing the existing database and attachment data.
- The database archive must target the same PostgreSQL database that the candidate migration uses.
- Restic retention must group the RDPS snapshots together across unique per-run input paths while excluding other hosts/tags.
- A recoverable off-site snapshot must contain its checksum sidecars with its archives.
- Timer and deployment backup windows must not overlap migrations, service replacement, or smoke validation.
- Restored attachment files must retain the API runtime's read access and the volume must pass the standard backup identity checks.
- A released version tag binds to one source commit and one complete set of immutable digests.
- Candidate monitoring rules/config must be valid and loaded before deployment smoke checks pass.

## Review focus

- Valid health responses must pass smoke checks with standard jq; malformed or unhealthy responses must fail.
- Interrupted, failed, and lock-contending backup/deploy jobs must not report a stale success as a fresh run.
- A copied sidecar for another filename must fail even when its checksum is valid for that other archive.
- Multiple scheduled snapshots from different temporary paths must be pruned according to the configured policy.
- A disaster restore must be verifiable using only the Restic snapshot, then usable by the app and accepted by the next backup.
- A failed publication attempt or manual workflow dispatch must not create a mixed or mislabeled image release.

## Tasks

### 1. Fix the production smoke gate

- [x] Add command-level smoke tests for a healthy API/web/monitoring fixture and for unhealthy responses using standard jq.
- [x] Confirm the healthy fixture fails because jq rejects `--silent`.
- [x] Remove the unsupported option and retain `--exit-status` checks.
- [x] Run the smoke fixture with real jq and the production smoke tests.

### 2. Make off-site snapshots self-verifying and retention-effective

- [x] Add tests that verify only exact archive-matching sidecars are accepted and that all four recovery files are included in the Restic snapshot.
- [x] Add tests asserting backup and forget use compatible `host` grouping and forget is scoped to the configured host plus RDPS tag.
- [x] Confirm current retention tests preserve snapshots from unique source paths and accept a mislabeled-sidecar regression fixture before the fix.
- [x] Validate exact sidecar name/digest, include both sidecars in the snapshot, and set consistent Restic group-by behavior.
- [x] Run focused Restic tests.

### 3. Protect live state and serialize all deployment work

- [x] Add tests proving a scheduled backup never runs `compose up`, rejects stopped/unhealthy stateful services, and runs under the shared deployment lock.
- [x] Add a deployment test proving the same lock spans pre-backup, migration, candidate service changes, and smoke checks.
- [x] Move initial PostgreSQL/Redis creation into the explicitly authorized initial-deployment branch; upgrade backups inspect existing services only.
- [x] Hold one project-scoped lock across the complete deployment; avoid nested-lock deadlocks in the shared backup entrypoint.
- [x] Verify the backup target and migration target refer to the same database using parsed, non-logged connection metadata.
- [x] Bound service runtime and ensure actual failures cannot leave stale run-success metrics indefinitely.

### 4. Make attachment restores operational

- [x] Add tests that assert restored file ownership is UID/GID 10001 and the volume receives the labels required by the production backup.
- [x] Restore with application-readable ownership and the production Compose project/logical-volume labels.
- [x] Verify API read/write access and run the standard attachment backup identity check on the restored volume.

### 5. Bind deployment to one approved immutable release

- [x] Add tests for tag-to-commit resolution, published GitHub Release tag reuse rejection, manifest integrity, and rejection of mixed image digests.
- [x] Resolve a single release tag to a commit before CI/build and record source commit plus all five image digests in the manifest.
- [x] Require that manifest in preflight/deployment and reject environment overrides that do not match it.
- [x] Record the previous effective release and backup snapshot before migration; add a locked rollback command that restores the prior runtime image set without rerunning migrations.

### 6. Apply and verify monitoring configuration during deployment

- [x] Add tests that require candidate Prometheus rules/config, Blackbox config, API metrics, dependency exporter metrics, backup textfile metrics, and probe series.
- [x] Validate current candidate monitoring configuration with the selected images before rollout; reload/recreate changed services and verify loaded rules and targets before smoke passes.
- [x] Alert when the Blackbox scrape or expected probe series is absent, not only when its value is zero.
- [x] Run smoke and operational tests using real `jq`/`promtool` where available.

### 7. Re-run complete verification and update the completion tracker

- [x] Run package/operations tests, browser tests, isolated publish E2E, build, typecheck, lint, format, shell checks, production preflight, config validators, and Docker Dev health checks.
- [x] Update both plans and the main tracker with current results and remaining deployment-owned evidence.
