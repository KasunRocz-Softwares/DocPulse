#!/usr/bin/env bash
set -Eeuo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
root_dir=$(cd -- "$script_dir/../.." && pwd)
cd "$root_dir"

compose_file=${RDPS_PRODUCTION_COMPOSE_FILE:-$root_dir/docker-compose.production.yml}
compose=(docker compose --file "$compose_file")
api_url=${RDPS_PRODUCTION_API_HEALTH_URL:?set RDPS_PRODUCTION_API_HEALTH_URL to the externally routed API readiness URL}
web_url=${RDPS_PRODUCTION_WEB_HEALTH_URL:?set RDPS_PRODUCTION_WEB_HEALTH_URL to the externally routed web health URL}
public_url=${RDPS_PRODUCTION_PUBLIC_URL:?set RDPS_PRODUCTION_PUBLIC_URL to the externally routed public home URL}
sitemap_url=${RDPS_PRODUCTION_SITEMAP_URL:?set RDPS_PRODUCTION_SITEMAP_URL to the externally routed sitemap URL}
admin_url=${RDPS_PRODUCTION_ADMIN_URL:?set RDPS_PRODUCTION_ADMIN_URL to the externally routed admin sign-in page URL}

for url in "$api_url" "$web_url" "$public_url" "$sitemap_url" "$admin_url"; do
  if [[ "$url" != https://* ]]; then
    echo 'Production smoke check requires HTTPS for every routed URL.' >&2
    exit 1
  fi
done

temporary_dir=$(mktemp -d)
trap 'rm -rf -- "$temporary_dir"' EXIT

check_http() {
  local label=$1
  local url=$2
  if ! curl --fail --location --silent --show-error --output /dev/null "$url"; then
    echo "Production smoke check failed: $label." >&2
    return 1
  fi
  echo "Production smoke check passed: $label."
}

if ! curl --fail --location --silent --show-error "$api_url" -o "$temporary_dir/readiness.json" ||
  ! jq --exit-status '
    .status == "ok" and .checks.database == "ok" and .checks.redis == "ok"
  ' "$temporary_dir/readiness.json"
then
  echo 'Production smoke check failed: API readiness or database/cache checks.' >&2
  exit 1
fi
echo 'Production smoke check passed: API, database, and cache readiness.'
check_http "web health" "$web_url"
check_http "public home" "$public_url"
if ! curl --fail --location --silent --show-error "$admin_url" -o "$temporary_dir/admin.html" ||
  ! grep --ignore-case --quiet '<title>RDPS' "$temporary_dir/admin.html"
then
  echo 'Production smoke check failed: Admin application page.' >&2
  exit 1
fi
echo 'Production smoke check passed: Admin application page.'

if ! curl --fail --location --silent --show-error "$sitemap_url" -o "$temporary_dir/sitemap.xml" ||
  ! grep --ignore-case --quiet --extended-regexp '<urlset([[:space:]>])' "$temporary_dir/sitemap.xml"
then
  echo 'Production smoke check failed: sitemap response is missing or invalid.' >&2
  exit 1
fi
echo 'Production smoke check passed: sitemap.'

for service in api worker web prometheus alertmanager; do
  if ! "${compose[@]}" ps --format json "$service" |
    jq --slurp --exit-status \
      'length > 0 and all(.[]; .Health == "healthy")' >/dev/null
  then
    echo "Production smoke check failed: $service is not healthy." >&2
    "${compose[@]}" ps "$service" >&2
    exit 1
  fi
done
echo 'Production smoke check passed: API, worker, web, Prometheus, and Alertmanager health.'

"${compose[@]}" exec --no-TTY alertmanager wget --quiet --output-document=/dev/null http://127.0.0.1:9093/-/ready
"${compose[@]}" exec --no-TTY prometheus wget --quiet --output-document=/dev/null http://127.0.0.1:9090/-/ready
echo 'Production smoke check passed: Prometheus and Alertmanager readiness.'

if ! "${compose[@]}" exec --no-TTY prometheus \
  wget --quiet --output-document=- 'http://127.0.0.1:9090/api/v1/targets?state=active' \
  >"$temporary_dir/targets.json" ||
  ! jq --exit-status '
    [
      .data.activeTargets[]
      | select(
          .labels.job == "rdps-api" or
          .labels.job == "postgres-exporter" or
            .labels.job == "redis-exporter" or
            .labels.job == "node-exporter" or
            .labels.job == "rdps-api-health" or
            .labels.job == "rdps-web-health"
        )
    ] as $targets
    | ($targets | length) == 6 and all($targets[]; .health == "up")
  ' "$temporary_dir/targets.json"
then
  echo 'Production smoke check failed: database/cache exporters or internal probes are not up in Prometheus.' >&2
  exit 1
fi
echo 'Production smoke check passed: host, database/cache exporters, and internal API/web probes are up in Prometheus.'

if ! "${compose[@]}" exec --no-TTY prometheus \
  wget --quiet --output-document=- 'http://127.0.0.1:9090/api/v1/query?query=probe_success' \
  >"$temporary_dir/probes.json" ||
  ! jq --exit-status '
    [
      .data.result[]
      | select(
          .metric.job == "rdps-api-health" or
            .metric.job == "rdps-web-health"
        )
    ] as $probes
    | ($probes | length) == 2 and all($probes[]; .value[1] == "1")
  ' "$temporary_dir/probes.json"
then
  echo 'Production smoke check failed: internal API/web health probes report a failure.' >&2
  exit 1
fi
echo 'Production smoke check passed: API and web health probes report success.'

query_prometheus() {
  local query=$1
  local output_file=$2
  local encoded_query
  encoded_query=$(jq --raw-output --null-input --arg query "$query" '$query | @uri')
  "${compose[@]}" exec --no-TTY prometheus \
    wget --quiet --output-document=- "http://127.0.0.1:9090/api/v1/query?query=$encoded_query" \
    >"$output_file"
}

query_prometheus 'up{job="rdps-api"}' "$temporary_dir/api-metrics.json"
if ! jq --exit-status '
  .status == "success" and
  (.data.result | length) == 1 and
  .data.result[0].value[1] == "1"
' "$temporary_dir/api-metrics.json" >/dev/null; then
  echo 'Production smoke check failed: API metrics scrape is absent or down.' >&2
  exit 1
fi

for metric in pg_up redis_up; do
  query_prometheus "$metric" "$temporary_dir/$metric.json"
  if ! jq --exit-status '
    .status == "success" and
    (.data.result | length) > 0 and
    all(.data.result[]; .value[1] == "1")
  ' "$temporary_dir/$metric.json" >/dev/null; then
    echo "Production smoke check failed: $metric is absent or reports a dependency failure." >&2
    exit 1
  fi
done
echo 'Production smoke check passed: API, PostgreSQL, and Redis metrics are healthy.'

query_prometheus 'rdps_backup_last_run_success{job="node-exporter"} == 1 and rdps_backup_last_upload_success{job="node-exporter"} == 1 and rdps_backup_retention_success{job="node-exporter"} == 1 and time() - rdps_backup_last_success_timestamp_seconds{job="node-exporter"} < 1.5 * rdps_backup_expected_interval_seconds{job="node-exporter"}' \
  "$temporary_dir/backup-metrics.json"
if ! jq --exit-status '
  .status == "success" and
  (.data.result | length) == 1 and
  .data.result[0].value[1] == "1"
' "$temporary_dir/backup-metrics.json" >/dev/null; then
  echo 'Production smoke check failed: authenticated backup upload/retention metrics are missing, unsuccessful, or stale.' >&2
  exit 1
fi
echo 'Production smoke check passed: recent off-site backup upload and retention succeeded.'

if ! "${compose[@]}" exec --no-TTY prometheus \
  wget --quiet --output-document=- 'http://127.0.0.1:9090/api/v1/rules' \
  >"$temporary_dir/rules.json" ||
  ! jq --exit-status '
    .status == "success" and
    any(.data.groups[]; .file == "/etc/prometheus/alerts.yml" and any(.rules[]; .name == "RdpsApiUnavailable"))
  ' "$temporary_dir/rules.json" >/dev/null
then
  echo 'Production smoke check failed: the candidate RDPS Prometheus alert rules are not loaded.' >&2
  exit 1
fi
echo 'Production smoke check passed: RDPS alert rules are loaded in Prometheus.'
