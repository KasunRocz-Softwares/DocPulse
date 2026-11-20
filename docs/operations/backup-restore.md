# PostgreSQL backup and restore runbook

RDPS local attachment bytes are stored under `RDPS_UPLOAD_DIR` on the durable
`rdps_production_attachments` Compose volume. Back up and restore that volume
with the PostgreSQL archives as one coordinated recovery point. Use
`scripts/operations/backup-attachments-volume.sh` and
`scripts/operations/restore-attachments-volume.sh`; their safeguards are
documented in `docs/runbooks/backup-and-restore.md`.

## Scope and roles

Use the platform's managed-database backup/PITR facility as the primary
production recovery mechanism. These scripts create portable PostgreSQL custom
archives for an additional logical backup and a repeatable isolated restore
drill. Production execution belongs to the on-call database operator using
approved secret injection and access controls. Never copy production
credentials into a workstation, shell history, CI workflow, or this repository.

Required tools: Bash, PostgreSQL `pg_dump`/`pg_restore`, and `sha256sum`.
Use PostgreSQL client utilities compatible with the server's major version.

## Create a backup

Set `DATABASE_URL` through the secret manager or a protected environment
injection mechanism, then run:

```sh
bash scripts/operations/backup-postgres.sh /secure/rdps-backups
```

The script writes a UTC-named custom-format dump, verifies it can be listed by
`pg_restore`, then writes a SHA-256 sidecar. Files are created with restrictive
permissions (`umask 077`, mode `0600`). The `.partial` archive is removed on
failure; only a successfully listed archive is renamed to its final name.
Store the archive and checksum together in encrypted, access-controlled,
retention-managed storage. For the S3-compatible Restic path, stage exactly one
PostgreSQL archive and one attachment archive in a recovery-point directory,
then run `scripts/operations/backup-offsite.sh <recovery-point-directory>`.
That command validates both sidecars and archive formats before it uploads a
single client-side encrypted snapshot. It applies retention only after the
upload succeeds. Configure `RESTIC_REPOSITORY` with the `s3:` scheme, and inject
`RESTIC_PASSWORD` plus S3 credentials from the secret manager. The default
retention is 7 daily, 4 weekly, and 12 monthly snapshots; approved positive
counts can be set with `RDPS_RESTIC_KEEP_DAILY`, `RDPS_RESTIC_KEEP_WEEKLY`, and
`RDPS_RESTIC_KEEP_MONTHLY`. Initialize a newly provisioned repository once with
`restic init` under the same injected environment. Keep the Restic password
recoverable separately from the repository. Schedule `restic check` and
rotate `restic check --read-data-subset=1/10` through `10/10` for pack-data
coverage; use `restic check --read-data` during a full recovery drill. Full
data reads download the whole repository. Schedule backups and pruning in a
window that allows pruning to lock the repository.
Configure bucket immutability, replication, and provider lifecycle policy in
the approved storage account.

The backup identity needs read access to all application schemas and objects
that must be recovered. Include large objects if RDPS begins using them; the
current script uses `pg_dump` custom format without `--no-large-objects`.

## Verify archive and checksum

```sh
bash scripts/operations/verify-postgres-backup.sh /secure/rdps-backups/rdps-postgres-<UTC timestamp>.dump
```

Verification checks the SHA-256 sidecar and PostgreSQL custom archive table of
contents. It detects corruption or a mismatched pair; it does not prove that a
complete database restore or application recovery will succeed.

## Restore drill to an isolated database

1. Create a new, disposable database on an isolated development or recovery
   PostgreSQL service. Do not point a restore drill at production or a shared
   environment.
2. Verify the selected archive and checksum.
3. Inject the target URI as `RDPS_RESTORE_DATABASE_URL`. Set
   `RDPS_RESTORE_CONFIRM=YES` only after independently checking that the URI
   names the disposable target.
4. Restore with the command below. It does not use `--clean` or drop objects;
   use an empty target database so existing objects cause a visible failure.

```sh
RDPS_RESTORE_DATABASE_URL='postgresql://rdps:rdps_dev_only@localhost:5432/rdps_restore_drill' \
RDPS_RESTORE_CONFIRM=YES \
  bash scripts/operations/restore-postgres.sh /secure/rdps-backups/rdps-postgres-<UTC timestamp>.dump
```

5. Run `pnpm --filter @rdps/api db:deploy` with `DATABASE_URL` pointed only at
   the restored disposable database, then run application smoke checks and
   inspect key row counts and foreign-key consistency.
6. Record archive name, SHA-256, restore duration, client/server versions,
   migration result, checks performed, and issues. Delete the disposable
   database when the drill is approved complete.

The restore script validates the checksum and archive listing before calling
`pg_restore --exit-on-error --no-owner --no-acl`. It never deletes the target
database. PostgreSQL custom archives do not make the script a point-in-time
recovery tool; use managed PITR for recovery to a precise time.

## Recovery notes

- Prefer managed PITR for accidental updates, deletion, or regional recovery.
- Restore logical archives to a new database first; validate before changing
  application connection routing.
- Recover the matching application release, database migrations, and secrets
  from their respective controlled systems. Do not restore secrets from an
  application database dump.
- Keep the previous database and application routes available until the
  recovery owner approves cutover. Capture a rollback plan before changing DNS
  or connection endpoints.
- After recovery, check API health, worker queue consumption, login, project and
  release reads, publication snapshot reads, and audit continuity.

## Retention and access

Set retention, encryption-at-rest, replication, access review, immutability,
and deletion policy in the approved backup platform. Restic performs
client-side authenticated encryption for off-site snapshots; local staging
archives are not encrypted by these scripts and must stay on protected storage.
Restrict restore access to named operators, log access without logging
connection strings or secrets, and periodically verify repository data and
restore a retained snapshot in an isolated environment.
