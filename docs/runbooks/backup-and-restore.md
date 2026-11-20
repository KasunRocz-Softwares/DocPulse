# RDPS Backup and Restore Runbook

PostgreSQL contains the authoritative RDPS records and public snapshots. Attachment bytes are stored under `RDPS_UPLOAD_DIR` on the durable `rdps_production_attachments` volume. The supplied scripts create a PostgreSQL custom archive and a separate attachment archive, verify both, and create SHA-256 checksums. The volume backup refuses a missing volume and validates the Compose project/logical-volume labels to avoid silently backing up an empty or unrelated volume. `backup-offsite.sh` validates one pair together, uploads both into one client-side encrypted Restic snapshot on an S3-compatible repository, and applies the configured snapshot retention after upload succeeds.

## Backup

Provide `DATABASE_URL` through the secret manager and choose a new, access-controlled local staging directory for this recovery point. The caller's umask is tightened by the database backup script and output files are mode `0600`.

```sh
export DATABASE_URL='postgresql://<user>:<url-encoded-password>@<production-host>:5432/<database>?sslmode=require'
scripts/operations/backup-postgres.sh /secure/backups/rdps/20261112T000000Z
scripts/operations/backup-attachments-volume.sh /secure/backups/rdps/20261112T000000Z
```

Verify a selected archive before copying or restoring it:

```sh
scripts/operations/verify-postgres-backup.sh /secure/backups/rdps/rdps-postgres-<UTC-stamp>.dump
```

Transfer each archive and matching `.sha256` file together. Keep the database and attachment capture in the same backup window and use a staging directory containing exactly one of each archive. Set the Restic repository password and S3 credentials through the secret manager; do not put them in shell history, command-line arguments, or repository files. The repository must be provisioned in a separate failure domain with access limited to backup and restore operators. Restic encrypts and authenticates data client-side; protect and escrow its password separately because the object store cannot recover it.

```sh
export RESTIC_REPOSITORY='s3:https://<s3-compatible-endpoint>/<bucket>/<rdps-prefix>'
export RESTIC_PASSWORD='<injected-from-secret-manager>'
# Inject AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY or the provider's supported
# workload identity through the deployment secret mechanism.
# Once per new repository, initialize it with the same injected environment:
restic init
scripts/operations/backup-offsite.sh /secure/backups/rdps/20261112T000000Z
```

The command checks both checksum sidecars, the PostgreSQL archive table of contents, and the attachment tar before uploading a single `rdps`-tagged snapshot. Defaults retain 7 daily, 4 weekly, and 12 monthly snapshots. Set `RDPS_RESTIC_KEEP_DAILY`, `RDPS_RESTIC_KEEP_WEEKLY`, and `RDPS_RESTIC_KEEP_MONTHLY` to approved positive integer counts when invoking it. Retention pruning runs only after `restic backup` exits successfully and targets the `rdps` tag. Run backups and pruning in a scheduled window because pruning temporarily locks the repository. Schedule `restic check` with the same repository credentials, rotate `restic check --read-data-subset=1/10` through `10/10` to cover the pack data, and use a full `restic check --read-data` during a recovery drill; the full read downloads the entire repository. Configure object-lock/immutability and lifecycle policy at the S3 provider if required by the organization.

Define approved RPO/RTO targets, retention, object-lock, geographic replication, credential rotation, and recovery ownership with the service owner; the product design does not prescribe numeric values. Record the local archive names and checksums, Restic snapshot ID, upload result, and retention policy for each run.

## Restore drill and recovery

Restore only to a newly provisioned isolated database that is not serving production or development traffic. First use Restic to restore a selected `rdps` snapshot into a fresh empty staging directory, then run the archive verification and restore commands below. The restore script requires explicit confirmation and refuses the known development database URLs. It verifies the checksum and archive before invoking `pg_restore`.

```sh
export RDPS_RESTORE_DATABASE_URL='postgresql://<restore-user>:<url-encoded-password>@<isolated-restore-host>:5432/rdps_restore?sslmode=require'
export RDPS_RESTORE_CONFIRM=YES
scripts/ops/restore-postgres-safe.sh /secure/backups/rdps/rdps-postgres-<UTC-stamp>.dump
RDPS_RESTORE_ATTACHMENTS_CONFIRM=YES scripts/operations/restore-attachments-volume.sh \
  /secure/backups/rdps/rdps-attachments-<UTC-stamp>.tar.gz rdps-restore-<unique-name>
```

The volume restore script creates a new, empty Docker volume and refuses a reused name. Set `RDPS_ATTACHMENTS_VOLUME_NAME` to the printed volume name in the protected Compose environment, then restart the API service so it mounts the restored files. Keep the previous volume intact until the isolated restore checks pass. After restore, apply the application version and migrations intended for the recovery point against the isolated target. Run API health checks and inspect project, release, approval, publication, audit, and subscription records. Validate that published snapshot attachments pass checksum checks and revoked publications remain unavailable. Do not point production traffic at the restored database until the incident commander approves the recovery and the target has been independently checked.

Run a restore drill before launch and on the organization's recovery cadence. Record the archive checksum, PostgreSQL version, restore duration, validation outcomes, and any data-loss interval. Keep the current live database untouched until the restored copy is accepted.

## Scope and limitations

These scripts cover PostgreSQL and local attachment files. Restic protects the off-site snapshot with client-side encryption; the local staging archives remain plaintext and must stay on protected storage and be removed under the approved staging cleanup policy after upload verification. They do not back up Redis queue state, container images, external email, GitHub, or deployment-provider state. Redis is configured with AOF persistence but its loss can discard queued/retry state; recovery must include queue reconciliation and replay from source systems. Remote bucket credentials, endpoint availability, immutability, and restore readiness require deployment-owner configuration and drills.
