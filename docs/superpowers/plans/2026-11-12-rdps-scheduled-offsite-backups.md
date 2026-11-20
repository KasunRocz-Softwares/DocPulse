# Scheduled Off-Site Backup Implementation Plan

> **For agentic workers:** Implement the approved full-product operations requirement in small TDD steps. The user authorized full RDPS implementation. Do not claim production backup readiness until the target host has run the job against its provisioned repository and completed a restore drill.

**Goal:** Make coordinated RDPS database and attachment backups reusable by release deployment and an installable, host-managed recurring schedule, with encrypted off-site upload before migrations.

**Architecture:** A single host script starts or verifies PostgreSQL/Redis, acquires an exclusive lock, creates a unique mode-0700 recovery-point directory, runs the existing archive scripts, uploads the pair with Restic, and records the snapshot and retention outcome. Production deployment invokes this command before migration. A systemd oneshot service and timer invoke the same command; the timer is installed/enabled by the deployment owner after approving cadence and RPO.

**Tech Stack:** Bash, Docker Compose, Restic, jq, systemd, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-11-10-rdps-full-product-design.md`; current operational gates in `docs/superpowers/plans/2026-11-11-rdps-full-completion-tracker.md`.

## Files and responsibilities

- `scripts/operations/backup-offsite.sh`: include machine-readable Restic snapshot ID in a protected manifest and record retention success/failure.
- `scripts/ops/backup-production.sh`: create isolated local artifacts and invoke the off-site uploader under a nonblocking host lock.
- `scripts/ops/deploy-production.sh`: use the shared backup command before migrations.
- `scripts/ops/production-preflight.sh`: require an S3-compatible Restic repository and strong repository password before deployment work.
- `scripts/ops/systemd/rdps-backup.service`, `rdps-backup.timer`: installable host units; timer default is daily at 02:15 UTC and owner-adjustable before enablement.
- `scripts/operations/production-backup.test.mjs`, `offsite-backup.test.mjs`, and `production-preflight.test.mjs`: prove fail-closed ordering, per-run isolation/locking, manifest fields, retention outcomes, and configuration rejection.
- `docs/runbooks/backup-and-restore.md`, `production-deployment.md`, tracker: explain installation, secret-file protections, cadence approval, recovery evidence, and external gates.

## Review focus

- No database migration or application rollout may begin after a local-only or failed backup.
- Concurrent timer and deployment runs must not overlap or share a staging directory.
- Logs and manifests must not contain repository passwords or cloud credentials.
- Timer cadence is a host-owner setting; a checked-in default does not constitute approved RPO.
- The scheduler is host-managed and must not mount the Docker socket into a production Compose container.
- Database and attachment files remain locally recoverable if Restic or the remote repository fails; failure preserves the staging directory for operator review.

## Tasks

### 1. Record Restic upload evidence

- [x] Update the Restic test double to emit a successful JSON summary and add assertions for snapshot ID, archive checksums, retention status, and no retention after upload failure.
- [x] Run `node --test scripts/operations/offsite-backup.test.mjs` and confirm the new assertions fail for missing manifest behavior.
- [x] Implement protected JSONL capture, validate the returned snapshot ID, and atomically write/update a per-run manifest without credentials.
- [x] Re-run focused off-site tests.

### 2. Add one host backup entrypoint

- [x] Add tests proving a fresh run directory, exclusive lock behavior, both local archive commands before Restic, and nonzero exit on uploader failure.
- [x] Run the focused operations test and verify the missing entrypoint fails.
- [x] Implement the orchestrator using existing backup scripts and preserve the run directory on failures.
- [x] Test systemd unit contracts and deploy ordering before changing production deployment.
- [x] Update `deploy-production.sh` to call the orchestrator before migrations; add required Restic repository/password validation to production preflight.

### 3. Provide recurring host schedule and runbook

- [x] Add hardened oneshot service and persistent UTC timer; leave timer enablement and cadence approval to the host owner.
- [x] Document protected EnvironmentFile setup, Docker group access, installation/enablement, missed-run behavior, run monitoring, and RPO approval.
- [x] Run the complete `pnpm test`, typecheck, lint, production build, formatting, isolated publish E2E, and Docker Dev health checks; record evidence and remaining external gates.
