# RDPS Production Deployment Runbook

This runbook deploys the production-only stack in `docker-compose.production.yml`. The default `docker-compose.yml` remains the local development stack. The production Compose project has separate named volumes and does not mount or migrate the development database.

## Deployment shape

- `web` is the Nginx reverse proxy and static web server. It serves public traffic on its default virtual host, serves the admin portal on any `admin.*` host, and proxies `/api/` to the private API service.
- Only `web` joins the ingress `edge` network. The API joins `private`, `monitoring`, and controlled `egress`; the blackbox exporter joins `private`, `monitoring`, and `egress` to probe internal health routes and external URLs. Ingress containers cannot bypass Nginx to reach the API, while Prometheus retains access through `monitoring`.
- Terminate TLS at a managed ingress or load balancer. Route both public and `admin.<domain>` HTTPS hosts to port 8080 of the `web` container over the `rdps-production_edge` Docker network. Configure the ingress to overwrite `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`; only `https` is forwarded as a trusted scheme.
- Do not publish PostgreSQL, Redis, API, Prometheus, Alertmanager, or exporter ports to the host or public network. The production Compose file has no host port mappings.
- PostgreSQL and Redis sit on a private internal network. The API, worker, Alertmanager, and probes also have controlled outbound access for integrations and alert delivery.
- Production database, Redis, and monitoring volumes use distinct names from the development volumes.

## Secret and configuration contract

Inject these values from the deployment platform's secret manager into the deployment process. Do not commit a production `.env` file, pass secrets as command-line arguments, or put them into image build arguments.

Required values: `RDPS_RELEASE_MANIFEST` pointing to the downloaded `rdps-production-images.json`, `RDPS_IMAGE_TAG`, `RDPS_GHCR_OWNER` from the published manifest, the five `RDPS_*_IMAGE` references (`RDPS_API_IMAGE`, `RDPS_WORKER_IMAGE`, `RDPS_MIGRATE_IMAGE`, `RDPS_WEB_IMAGE`, and `RDPS_ALERTMANAGER_IMAGE`), `CLAMAV_IMAGE_REPOSITORY`, `CLAMAV_IMAGE`, the digest-pinned production infrastructure images (`POSTGRES_IMAGE`, `REDIS_IMAGE`, `PROMETHEUS_IMAGE`, `POSTGRES_EXPORTER_IMAGE`, `REDIS_EXPORTER_IMAGE`, `BLACKBOX_EXPORTER_IMAGE`, and `NODE_EXPORTER_IMAGE`), `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_EXPORTER_USER`, `POSTGRES_EXPORTER_PASSWORD`, `DATABASE_URL`, `RESTIC_REPOSITORY`, `RESTIC_PASSWORD`, `RDPS_BACKUP_METRICS_FILE`, `RDPS_BACKUP_EXPECTED_INTERVAL_SECONDS`, `REDIS_PASSWORD`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `BOOTSTRAP_SECRET`, `GITHUB_WEBHOOK_SECRET`, `DEPLOYMENT_WEBHOOK_SECRET`, `RDPS_WORKER_SHARED_SECRET`, `NOTIFICATION_WORKER_SECRET`, `PUBLIC_BASE_URL`, `WEB_BASE_URL`, `RDPS_ALERT_WEBHOOK_URL`, and the five `RDPS_PRODUCTION_*_URL` values used by the deployment smoke checks. `RESTIC_REPOSITORY` must be an initialized S3-compatible repository and `RESTIC_PASSWORD` must be injected from the secret manager; provision the S3 credentials through the host's secret manager or workload identity. Set the metrics file to `/var/lib/node_exporter/textfile_collector/rdps-backup.prom` and set the expected interval in seconds to the owner-approved cadence.

Use unique random values of at least 32 characters for passwords and secrets. Build `REDIS_URL` using the same Redis password and URL-encode reserved characters. `DATABASE_URL` must address the PostgreSQL service on the production private network; the preflight rejects the known local development URLs. This Compose profile provisions PostgreSQL and Redis in separate production volumes. Set the public and admin base URLs to HTTPS origins. The alert endpoint must be an HTTPS webhook that accepts Prometheus Alertmanager webhook payloads. Every runtime, migration, database, cache, monitoring, exporter, and ClamAV image must use an OCI `@sha256:<64 lowercase hex>` reference. RDPS references must match `RDPS_GHCR_OWNER` and the exact repositories in the image manifest; ClamAV must match the separately approved `CLAMAV_IMAGE_REPOSITORY`.

OIDC SSO is optional. When enabled, configure all values in [the OIDC setup guide](../auth/oidc-sso.md) through the secret manager. Production preflight requires a complete configuration, HTTPS issuer/callback/origins, and an independent state secret of at least 32 characters. Leave the complete OIDC configuration unset to keep password sign-in only.

Create the PostgreSQL exporter login through a DBA-controlled provisioning path with least privilege. For supported PostgreSQL versions, grant `pg_monitor` and `CONNECT` on the application database; do not reuse the application owner credentials for metrics collection. Confirm the exporter user and password values match that provisioned login.

Email delivery is optional for startup but required for live subscription notifications. Set `EMAIL_DELIVERY_URL` and, when required by the provider, `EMAIL_DELIVERY_TOKEN` from the secret manager. Governed deployment execution is optional until enabled by environment policy; when enabled, set `DEPLOYMENT_RUNNER_URL` to the fixed HTTPS runner endpoint and `DEPLOYMENT_RUNNER_SIGNING_SECRET` to a shared random secret of at least 32 characters on the API, worker, and runner. GitHub App credentials and any external deployment-provider credentials must also be provisioned where those integrations are enabled.

AI-generated release summary suggestions are optional. To enable them, set `AI_SUMMARY_PROVIDER_URL` to the provider's HTTPS OpenAI-compatible chat-completions endpoint and `AI_SUMMARY_MODEL` to its model identifier. Set `AI_SUMMARY_PROVIDER_API_KEY` through the secret manager when the provider requires bearer authentication. `AI_SUMMARY_TIMEOUT_MS` defaults to 12000 and is capped at 20000 by the API. Production preflight rejects partial or non-HTTPS provider configuration. AI output remains a suggestion and still requires normal human review and approval.

Anonymous public API requests use a Redis fixed-window limit, defaulting to 120 requests per client IP per 60 seconds. Tune `PUBLIC_API_RATE_LIMIT` and `PUBLIC_API_RATE_WINDOW_SECONDS` for the deployment. The API ignores forwarded client-IP headers unless the immediate upstream proxy's exact source IP is listed in `TRUSTED_PROXY_IPS`; configure that list from the deployment's observed network topology and keep the API unreachable except through trusted proxies. When no trusted proxy is configured, requests are grouped by the direct socket peer address.

## Deploy

The **Publish production images** GitHub Actions workflow runs for published `v*` tags or a manual semantic-version dispatch from `main`. Before publishing, it runs workspace checks, browser tests, isolated E2E, recovery tests, production configuration checks, and production image builds against the exact resolved source commit. It publishes API, worker, migration, web, and Alertmanager images to GHCR with provenance and SBOM attestations, then creates a GitHub Release with `rdps-production-images.json` attached. That manifest binds the source commit to the five immutable image digests. Registry aliases include the source commit and workflow run attempt, so an interrupted publish can be retried without reusing a partial release tag. The workflow refuses a tag that already has a published GitHub Release. Download the release asset and set `RDPS_RELEASE_MANIFEST` to its protected local path. Load `RDPS_IMAGE_TAG`, `RDPS_GHCR_OWNER`, and all five image references from that same manifest; preflight rejects mismatched overrides. Set `CLAMAV_IMAGE` to the approved ClamAV digest separately.

Run from a trusted deployment runner with Docker Compose, `curl`, `jq`, Restic, `flock`, PostgreSQL client utilities, and permission to pull from GHCR. The deployment script creates a unique protected backup directory, verifies the PostgreSQL and attachment archives, uploads both as one client-side encrypted Restic snapshot, and records its snapshot ID and retention outcome. Any failure stops deployment before migration and preserves local recovery artifacts. Use a new, never-reused `RDPS_IMAGE_TAG` for every release. `RDPS_BACKUP_DIRECTORY` must be durable, access-controlled, and encrypted at rest by the host or storage provider. Set `RDPS_ATTACHMENTS_VOLUME_NAME` to the same value used by Compose when overriding its default. The attachment backup validates the volume's Compose project and logical-volume labels and refuses missing or mismatched volumes. For a genuinely new installation only, set `RDPS_INITIAL_DEPLOYMENT=YES`; the deployment script creates and reports the correctly labelled empty volume before the initial backup. Set `RDPS_PRODUCTION_API_HEALTH_URL`, `RDPS_PRODUCTION_WEB_HEALTH_URL`, `RDPS_PRODUCTION_PUBLIC_URL`, `RDPS_PRODUCTION_SITEMAP_URL`, and `RDPS_PRODUCTION_ADMIN_URL` to the externally routed HTTPS endpoints before deploying; the last URL must load the Admin sign-in page.

```sh
export RDPS_IMAGE_TAG=2026.11.11.1
export RDPS_RELEASE_MANIFEST=/secure/releases/rdps-production-images.json
export RDPS_GHCR_OWNER=example
export RDPS_API_IMAGE='ghcr.io/example/rdps-api@sha256:<64-hex-digest>'
export RDPS_WORKER_IMAGE='ghcr.io/example/rdps-worker@sha256:<64-hex-digest>'
export RDPS_MIGRATE_IMAGE='ghcr.io/example/rdps-migrate@sha256:<64-hex-digest>'
export RDPS_WEB_IMAGE='ghcr.io/example/rdps-web@sha256:<64-hex-digest>'
export RDPS_ALERTMANAGER_IMAGE='ghcr.io/example/rdps-alertmanager@sha256:<64-hex-digest>'
export CLAMAV_IMAGE_REPOSITORY='ghcr.io/example/clamav'
export CLAMAV_IMAGE='ghcr.io/example/clamav@sha256:<64-hex-digest>'
export POSTGRES_IMAGE='docker.io/library/postgres@sha256:<64-hex-digest>'
export REDIS_IMAGE='docker.io/library/redis@sha256:<64-hex-digest>'
export PROMETHEUS_IMAGE='quay.io/prometheus/prometheus@sha256:<64-hex-digest>'
export POSTGRES_EXPORTER_IMAGE='quay.io/prometheuscommunity/postgres-exporter@sha256:<64-hex-digest>'
export REDIS_EXPORTER_IMAGE='ghcr.io/oliver006/redis_exporter@sha256:<64-hex-digest>'
export BLACKBOX_EXPORTER_IMAGE='quay.io/prometheus/blackbox-exporter@sha256:<64-hex-digest>'
export NODE_EXPORTER_IMAGE='quay.io/prometheus/node-exporter@sha256:<64-hex-digest>'
export RDPS_BACKUP_DIRECTORY=/secure/backups/rdps
export RESTIC_REPOSITORY='s3:https://<s3-compatible-endpoint>/<bucket>/<rdps-prefix>'
export RESTIC_PASSWORD='<injected-from-secret-manager>'
export RDPS_BACKUP_METRICS_FILE=/var/lib/node_exporter/textfile_collector/rdps-backup.prom
export RDPS_BACKUP_EXPECTED_INTERVAL_SECONDS=86400
export RDPS_PRODUCTION_API_HEALTH_URL=https://api.example.com/api/v1/health/ready
export RDPS_PRODUCTION_WEB_HEALTH_URL=https://releases.example.com/healthz
export RDPS_PRODUCTION_PUBLIC_URL=https://releases.example.com/
export RDPS_PRODUCTION_SITEMAP_URL=https://releases.example.com/sitemap.xml
export RDPS_PRODUCTION_ADMIN_URL=https://admin.example.com/
scripts/ops/deploy-production.sh
```

The command validates required configuration and digest references, pulls the specified images, and completes the encrypted off-site backup before applying Prisma migrations once using the exact migration digest. It then starts the services on the same release digests. Its post-deployment smoke check retries the external API and web health routes, public home, sitemap, and Admin application page; it also requires healthy API, worker, web, Prometheus, and Alertmanager containers, plus healthy database/cache exporters and internal probes in Prometheus. The worker health check verifies its Redis connection. A live test alert must still be sent to prove delivery through the configured receiver before enabling customer traffic. Image publication is handled by the GitHub Actions workflow; rollout remains an explicit operator action through the protected deployment environment.

### Recurring backup schedule

The host-runner units in `scripts/ops/systemd/` invoke the same locked backup entrypoint used by releases. Install Restic, `jq`, Docker Compose, `flock`, `sha256sum`, `pg_restore`, and `tar` on the host. Create the service account `rdps`, grant it access to the Docker socket through the `docker` group, and set `/opt/rdps/current` to the checked-out release directory (or add a systemd drop-in for the chosen path). Store the complete runtime and backup environment in `/etc/rdps/production.env`, owned by `root:root` with mode `0600`; systemd reads it before launching the service. The file includes `RDPS_BACKUP_DIRECTORY`, `RESTIC_REPOSITORY`, `RESTIC_PASSWORD`, `RDPS_BACKUP_METRICS_FILE`, `RDPS_BACKUP_EXPECTED_INTERVAL_SECONDS`, S3 workload credentials/identity, and the production Compose values. Create the backup directory owned by `rdps` with mode `0700` on encrypted durable storage. Create `/var/lib/node_exporter/textfile_collector` owned by `rdps:rdps` with mode `0755` so the backup process can atomically replace the metrics file and Node Exporter can read its mode-`0644` contents.

Review the timer's `OnCalendar` value against the service owner's approved RPO before installing or enabling it. The checked-in default is 02:15 UTC daily; it is an example schedule, not RPO approval. The persistent timer catches up after host downtime, and the backup lock prevents overlap with deployments or another timer run. Install the units and verify them before use:

```sh
sudo install -o root -g root -m 0644 scripts/ops/systemd/rdps-backup.service /etc/systemd/system/
sudo install -o root -g root -m 0644 scripts/ops/systemd/rdps-backup.timer /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/rdps-backup.service /etc/systemd/system/rdps-backup.timer
sudo systemctl daemon-reload
sudo systemctl start rdps-backup.service
sudo journalctl -u rdps-backup.service --since today
sudo systemctl enable --now rdps-backup.timer
systemctl list-timers rdps-backup.timer
```

Inspect each run's `manifest.txt` and `job-status.txt`; failed runs retain their local artifacts and the service exits unsuccessfully. Monitor timer freshness and service failures in the host monitoring system. The units are not installed or enabled by the release script. Run the first service invocation and confirm its Restic snapshot and restore procedure before enabling a schedule. Local recovery directories are retained; apply the organization's approved staging cleanup policy only to runs whose `job-status.txt` and manifest both record success.

Run the following checks after deployment:

```sh
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs --since=15m api worker web prometheus alertmanager
curl --fail --show-error "$RDPS_PRODUCTION_API_HEALTH_URL"
curl --fail --show-error "$RDPS_PRODUCTION_WEB_HEALTH_URL"
```

Verify that a test alert reaches the operations endpoint before enabling customer traffic. Verify TLS certificate renewal and the ingress header policy independently; TLS is intentionally terminated outside this Compose stack.

## Migration and rollback policy

Use forward-only, backward-compatible expand/migrate/contract migrations:

1. Review the SQL and confirm the migration can coexist with the currently deployed application version.
2. Take and verify a PostgreSQL backup.
3. Apply migrations once with `docker compose -f docker-compose.production.yml --profile release run --rm migrate`.
4. Roll out the new API, worker, and web images.
5. Keep the previous immutable images available until the observation window closes.
6. Remove old columns or constraints only in a later release after all old application instances are gone and recovery has been verified.

Before applying the migration, deployment writes `release-state.json` beside the verified backup manifest. It records the prior API, worker, web, and Alertmanager image digests, candidate release, and Restic snapshot ID. If health checks fail and the schema remains compatible, run `scripts/ops/rollback-production.sh <backup-run>/release-state.json`; the command acquires the shared backup/deployment lock, restores the previous runtime image set, and repeats the external smoke checks without rerunning migrations. First-time deployments have no prior runtime images and cannot use application rollback. Never reverse an applied migration by restoring over the live database. If a migration is not backward compatible, stop rollout and use the database recovery procedure below with an approved outage plan. Record the migration identifier, image digests, operator, UTC timestamps, and health-check output in the deployment record.

## Incident response

For failed health checks, preserve `docker compose ... ps`, recent logs, alert payload, image tags/digests, and migration status before changing services. Roll back application images only when the schema remains compatible. For data corruption or loss, declare an incident, stop writes through the ingress, preserve the current database volume, and restore to a separate database first; see [backup and restore](backup-and-restore.md). Do not run `docker compose down -v` against production or development.
