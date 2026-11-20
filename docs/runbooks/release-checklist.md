# RDPS Production Release Checklist

## Before release

- [ ] CI passed formatting, lint, typecheck, unit/integration tests, the invite-to-publication E2E flow, workspace builds, production Compose validation, production image builds, and `nginx -t`.
- [ ] Review the migration SQL, verify the change is backward compatible, and identify the previous image tag/digest.
- [ ] Set `RDPS_RELEASE_MANIFEST` to the protected copy of the downloaded GHCR artifact; load its release tag, source commit, and five image digests without changing them. Add the reviewed `CLAMAV_IMAGE` digest and required secrets/config to the production environment.
- [ ] Confirm the database and exporter accounts are separate, Redis URL/password match, public/admin URLs use HTTPS, and production values differ from CI/development values.
- [ ] Confirm the S3-compatible Restic repository is initialized, encrypted, access-controlled, and reachable from the host; confirm free space and local staging policy.
- [ ] Obtain service-owner approval for RPO/RTO and timer cadence; enable the systemd timer only after a successful host backup and isolated restore drill.
- [ ] Confirm the external ingress has valid TLS, routes public and `admin.*` hosts to Nginx, and overwrites forwarded headers.
- [ ] Confirm the operations webhook endpoint is reachable and accepts Alertmanager requests.

## Deploy

- [ ] Run the production preflight and check it reports valid Compose configuration without printing secret values.
- [ ] Run the coordinated database/attachment backup and verify its Restic snapshot, archive checksums, and retention outcome before migration.
- [ ] Confirm the deployment wrote `release-state.json` beside the successful backup manifest, then apply the reviewed migration once with the release profile.
- [ ] Deploy API, worker, and web images; keep the previous image digests available.
- [ ] Verify API and web health through the external ingress and check service health/logs.
- [ ] Send a test alert and confirm receipt; confirm database/cache exporter targets are healthy.
- [ ] Exercise the release publish E2E flow in a production-like environment with test project data, then verify public snapshot isolation and internal authorization.
- [ ] Record image digests, migration ID, backup archive/checksum, operator, UTC times, test output, and rollback decision in the deployment record.

## Rollback and closeout

- [ ] If application health fails and the schema remains compatible, preserve logs and migration state, then run `scripts/ops/rollback-production.sh <backup-run>/release-state.json` to restore prior runtime images without rerunning migrations.
- [ ] Restore data only to an isolated target under the backup/restore runbook and incident approval; never restore over development data.
- [ ] Verify alert resolution, queue state, and user-facing health after recovery.
- [ ] Keep the release under observation for the agreed period and record incidents or follow-up actions.

## External launch gates

- [ ] Production secret manager and operator access are provisioned.
- [ ] TLS ingress/DNS and certificate renewal are configured.
- [ ] Email delivery provider credentials are configured if subscriptions are enabled.
- [ ] GitHub App and deployment-provider credentials are configured for enabled integrations.
- [ ] Alert receiver/paging integration and host-level monitoring are configured.
- [ ] Backup encryption, off-host retention, restore schedule, and approved RPO/RTO are in effect.
