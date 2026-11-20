# RDPS Monitoring and Alerting Runbook

The production Compose profile starts Prometheus, Alertmanager, PostgreSQL and Redis exporters, the Blackbox Exporter, and a digest-pinned Node Exporter. Node Exporter reads host `/proc`, `/sys`, and filesystem data through a read-only root mount on the private monitoring network, with all Linux capabilities dropped. Prometheus scrapes host CPU, memory, and filesystem metrics alongside API request counters, request-latency histograms, process uptime and resident memory; it also checks the dependency-aware API readiness endpoint, Nginx health endpoint, and database/cache exporter metrics. Persistent metrics data is stored in the production Prometheus volume with a 15-day retention period.

## Alerts

Configured alerts cover API readiness failures, sustained API server-error rates, API p95 request latency above 500 ms, Nginx/web failures, PostgreSQL exporter/database failures, Redis exporter failures, host metrics exporter failure, host filesystem space below ten percent, host available memory below ten percent, host CPU utilization above ninety percent for ten minutes, and health-probe latency above one second. Availability alerts fire after two minutes; resource, latency, and error-rate alerts fire after five to ten minutes. Alertmanager groups notifications and sends firing and resolved notifications to `RDPS_ALERT_WEBHOOK_URL`.

The webhook URL is injected from the secret manager and must accept Alertmanager's webhook JSON. Alertmanager configuration is rendered at container startup with URL validation; the secret is not embedded in the image or checked-in configuration. Prometheus and Alertmanager web UIs are not published to host ports. Use a protected operations network or `docker compose exec` for access, and add authentication/access controls before exposing either UI.

The production host backup job publishes `rdps_backup_last_run_success`, `rdps_backup_last_run_timestamp_seconds`, and `rdps_backup_expected_interval_seconds` through Node Exporter's textfile collector. Prometheus alerts if these metrics disappear, if the last run failed, or if the last successful encrypted upload is older than 1.5 times the configured interval. Set `RDPS_BACKUP_METRICS_FILE` to `/var/lib/node_exporter/textfile_collector/rdps-backup.prom` and `RDPS_BACKUP_EXPECTED_INTERVAL_SECONDS` to the operator-approved schedule interval. Install and enable the systemd timer only after the RPO and cadence have been approved; the shipped 02:15 UTC daily schedule is a default example. A missed metric alert usually means the backup job could not publish its atomic status file or the Node Exporter textfile collector is misconfigured.

## Operational checks

```sh
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs --since=15m prometheus alertmanager postgres-exporter redis-exporter blackbox-exporter node-exporter
docker compose -f docker-compose.production.yml exec prometheus promtool check config /etc/prometheus/prometheus.yml
docker compose -f docker-compose.production.yml exec prometheus promtool check rules /etc/prometheus/alerts.yml
docker compose -f docker-compose.production.yml exec alertmanager /bin/amtool check-config /tmp/alertmanager.yml
```

On an alert, confirm the probe from the affected container network, check service health and recent logs, and correlate with deployment and migration timestamps. For host resource alerts, identify the affected mount or container pressure before increasing capacity. For database/cache alerts, check host disk, memory, connection saturation, and exporter authentication. For missed notifications, inspect Alertmanager logs and validate the provider endpoint from its container network.

## Coverage boundary

The API metrics endpoint is available at `/metrics` on the private API service network and intentionally sits outside the public `/api/v1` proxy namespace. It uses route templates rather than concrete paths as labels to avoid high-cardinality IDs. Host-level CPU, memory, and filesystem metrics are included, but these mechanisms do not establish the PRD's 99.9% monthly uptime target. The stack does not include distributed tracing, synthetic checks from outside the deployment network, certificate-expiry alerts, or paging-provider credentials. Validate the Prometheus rules and prove alert delivery to the selected receiver before launch.
