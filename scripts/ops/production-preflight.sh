#!/usr/bin/env bash
set -Eeuo pipefail

required=(RDPS_RELEASE_MANIFEST RDPS_IMAGE_TAG RDPS_GHCR_OWNER RDPS_API_IMAGE RDPS_WORKER_IMAGE RDPS_MIGRATE_IMAGE RDPS_WEB_IMAGE RDPS_ALERTMANAGER_IMAGE CLAMAV_IMAGE CLAMAV_IMAGE_REPOSITORY POSTGRES_IMAGE REDIS_IMAGE PROMETHEUS_IMAGE POSTGRES_EXPORTER_IMAGE REDIS_EXPORTER_IMAGE BLACKBOX_EXPORTER_IMAGE NODE_EXPORTER_IMAGE POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD POSTGRES_EXPORTER_USER POSTGRES_EXPORTER_PASSWORD DATABASE_URL RESTIC_REPOSITORY RESTIC_PASSWORD RDPS_BACKUP_METRICS_FILE RDPS_BACKUP_EXPECTED_INTERVAL_SECONDS REDIS_PASSWORD REDIS_URL JWT_ACCESS_SECRET BOOTSTRAP_SECRET GITHUB_WEBHOOK_SECRET DEPLOYMENT_WEBHOOK_SECRET RDPS_WORKER_SHARED_SECRET NOTIFICATION_WORKER_SECRET PUBLIC_BASE_URL WEB_BASE_URL RDPS_ALERT_WEBHOOK_URL RDPS_PRODUCTION_API_HEALTH_URL RDPS_PRODUCTION_WEB_HEALTH_URL RDPS_PRODUCTION_PUBLIC_URL RDPS_PRODUCTION_SITEMAP_URL RDPS_PRODUCTION_ADMIN_URL)
missing=()
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then missing+=("$name"); fi
done
if ((${#missing[@]})); then
  printf 'Missing required production configuration: %s\n' "${missing[*]}" >&2
  exit 64
fi

if [[ "$RESTIC_REPOSITORY" != s3:* ]]; then
  echo 'RESTIC_REPOSITORY must use an S3-compatible Restic repository (s3:...).' >&2
  exit 64
fi
if ((${#RESTIC_PASSWORD} < 20)); then
  echo 'RESTIC_PASSWORD must contain at least 20 characters.' >&2
  exit 64
fi
if [[ "$RDPS_BACKUP_METRICS_FILE" != /var/lib/node_exporter/textfile_collector/rdps-backup.prom ]]; then
  echo 'RDPS_BACKUP_METRICS_FILE must be /var/lib/node_exporter/textfile_collector/rdps-backup.prom.' >&2
  exit 64
fi
if [[ ! "$RDPS_BACKUP_EXPECTED_INTERVAL_SECONDS" =~ ^[1-9][0-9]{0,8}$ ]]; then
  echo 'RDPS_BACKUP_EXPECTED_INTERVAL_SECONDS must be a positive integer in seconds.' >&2
  exit 64
fi

if [[ ! "$RDPS_IMAGE_TAG" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
  echo 'RDPS_IMAGE_TAG must be a unique release tag (letters, digits, dot, underscore, hyphen).' >&2
  exit 64
fi
command -v jq >/dev/null 2>&1 || { echo 'jq is required to verify the immutable GHCR release manifest.' >&2; exit 69; }
[[ -f "$RDPS_RELEASE_MANIFEST" && -r "$RDPS_RELEASE_MANIFEST" ]] || {
  echo 'RDPS_RELEASE_MANIFEST must point to the downloaded rdps-production-images.json release artifact.' >&2
  exit 64
}
if ! jq --exit-status --arg tag "$RDPS_IMAGE_TAG" '
  .release_tag == $tag and
  (.source_commit | type == "string" and test("^[a-f0-9]{40}$")) and
  (.images | type == "object" and (keys | sort) == ["alertmanager", "api", "migrate", "web", "worker"])
' "$RDPS_RELEASE_MANIFEST" >/dev/null; then
  echo 'RDPS_RELEASE_MANIFEST is malformed or does not describe RDPS_IMAGE_TAG and all five production images.' >&2
  exit 64
fi
digest_reference_regex='^([a-z0-9.-]+(:[0-9]+)?/)?[a-z0-9][a-z0-9._-]*(/[a-z0-9][a-z0-9._-]*)+@sha256:[a-f0-9]{64}$'
if [[ ! "$RDPS_GHCR_OWNER" =~ ^[a-z0-9][a-z0-9-]{0,38}$ ]]; then
  echo 'RDPS_GHCR_OWNER must be a lowercase GitHub owner name.' >&2
  exit 64
fi
if [[ ! "$CLAMAV_IMAGE_REPOSITORY" =~ ^[a-z0-9.-]+(/[a-z0-9][a-z0-9._-]*)+$ ]]; then
  echo 'CLAMAV_IMAGE_REPOSITORY must be a lowercase registry/repository path.' >&2
  exit 64
fi
for name in RDPS_API_IMAGE RDPS_WORKER_IMAGE RDPS_MIGRATE_IMAGE RDPS_WEB_IMAGE RDPS_ALERTMANAGER_IMAGE CLAMAV_IMAGE POSTGRES_IMAGE REDIS_IMAGE PROMETHEUS_IMAGE POSTGRES_EXPORTER_IMAGE REDIS_EXPORTER_IMAGE BLACKBOX_EXPORTER_IMAGE NODE_EXPORTER_IMAGE; do
  if [[ ! "${!name}" =~ $digest_reference_regex ]]; then
    printf '%s must be an OCI image reference pinned to a sha256 digest.\n' "$name" >&2
    exit 64
  fi
done
for image in api worker migrate web alertmanager; do
  name="RDPS_${image^^}_IMAGE"
  repository="ghcr.io/$RDPS_GHCR_OWNER/rdps-$image"
  if [[ "${!name%%@*}" != "$repository" ]]; then
    printf '%s must reference %s from RDPS_GHCR_OWNER and the published GHCR manifest.\n' "$name" "$repository" >&2
    exit 64
  fi
  manifest_image=$(jq --raw-output --arg name "$image" '.images[$name] // empty' "$RDPS_RELEASE_MANIFEST")
  if [[ -z "$manifest_image" || "${!name}" != "$manifest_image" ]]; then
    printf '%s does not match the immutable digest recorded for %s in RDPS_RELEASE_MANIFEST.\n' "$name" "$image" >&2
    exit 64
  fi
done
if [[ "${CLAMAV_IMAGE%%@*}" != "$CLAMAV_IMAGE_REPOSITORY" ]]; then
  echo 'CLAMAV_IMAGE must use the explicitly approved CLAMAV_IMAGE_REPOSITORY.' >&2
  exit 64
fi
for name in JWT_ACCESS_SECRET BOOTSTRAP_SECRET GITHUB_WEBHOOK_SECRET DEPLOYMENT_WEBHOOK_SECRET RDPS_WORKER_SHARED_SECRET NOTIFICATION_WORKER_SECRET REDIS_PASSWORD POSTGRES_PASSWORD POSTGRES_EXPORTER_PASSWORD; do
  value=${!name}
  if ((${#value} < 32)); then
    printf '%s must contain at least 32 characters.\n' "$name" >&2
    exit 64
  fi
done

case "$DATABASE_URL" in
  *rdps_dev_only*|*localhost:5432/rdps*|*127.0.0.1:5432/rdps*)
    echo 'DATABASE_URL matches the known development database; production preflight refuses it.' >&2
    exit 64
    ;;
esac
case "$REDIS_URL" in
  *localhost:6379*|*127.0.0.1:6379*)
    echo 'REDIS_URL points to a local development service; production preflight refuses it.' >&2
    exit 64
    ;;
esac
case "$PUBLIC_BASE_URL" in https://*) ;; *) echo 'PUBLIC_BASE_URL must use https.' >&2; exit 64 ;; esac
case "$WEB_BASE_URL" in https://*) ;; *) echo 'WEB_BASE_URL must use https.' >&2; exit 64 ;; esac
case "$RDPS_ALERT_WEBHOOK_URL" in https://*) ;; *) echo 'RDPS_ALERT_WEBHOOK_URL must use https.' >&2; exit 64 ;; esac
for name in RDPS_PRODUCTION_API_HEALTH_URL RDPS_PRODUCTION_WEB_HEALTH_URL RDPS_PRODUCTION_PUBLIC_URL RDPS_PRODUCTION_SITEMAP_URL RDPS_PRODUCTION_ADMIN_URL; do
  value=${!name}
  if [[ "$value" != https://* || "$value" == *[[:space:]]* ]]; then
    printf '%s must be a valid HTTPS URL.\n' "$name" >&2
    exit 64
  fi
done

if [[ -n "${AI_SUMMARY_PROVIDER_URL:-}" || -n "${AI_SUMMARY_MODEL:-}" || -n "${AI_SUMMARY_PROVIDER_API_KEY:-}" ]]; then
  [[ -n "${AI_SUMMARY_PROVIDER_URL:-}" && -n "${AI_SUMMARY_MODEL:-}" ]] || {
    echo 'AI_SUMMARY_PROVIDER_URL and AI_SUMMARY_MODEL must be configured together.' >&2
    exit 64
  }
  case "$AI_SUMMARY_PROVIDER_URL" in https://*) ;; *) echo 'AI_SUMMARY_PROVIDER_URL must use https.' >&2; exit 64 ;; esac
fi
if [[ -n "${AI_SUMMARY_TIMEOUT_MS:-}" && ! "${AI_SUMMARY_TIMEOUT_MS}" =~ ^[0-9]+$ ]]; then
  echo 'AI_SUMMARY_TIMEOUT_MS must be an integer.' >&2
  exit 64
fi

if [[ -n "${DEPLOYMENT_RUNNER_URL:-}" || -n "${DEPLOYMENT_RUNNER_SIGNING_SECRET:-}" ]]; then
  [[ -n "${DEPLOYMENT_RUNNER_URL:-}" && -n "${DEPLOYMENT_RUNNER_SIGNING_SECRET:-}" ]] || {
    echo 'DEPLOYMENT_RUNNER_URL and DEPLOYMENT_RUNNER_SIGNING_SECRET must be configured together.' >&2
    exit 64
  }
  case "$DEPLOYMENT_RUNNER_URL" in https://*) ;; *) echo 'DEPLOYMENT_RUNNER_URL must use https.' >&2; exit 64 ;; esac
  if ((${#DEPLOYMENT_RUNNER_SIGNING_SECRET} < 32)); then
    echo 'DEPLOYMENT_RUNNER_SIGNING_SECRET must contain at least 32 characters.' >&2
    exit 64
  fi
fi

github_app_configured=false
for name in GITHUB_APP_ID GITHUB_APP_SLUG GITHUB_APP_PRIVATE_KEY GITHUB_APP_WEBHOOK_SECRET GITHUB_APP_ADMIN_ORIGIN; do
  if [[ -n "${!name:-}" ]]; then github_app_configured=true; fi
done
if [[ "$github_app_configured" == true ]]; then
  github_app_missing=()
  for name in GITHUB_APP_ID GITHUB_APP_SLUG GITHUB_APP_PRIVATE_KEY GITHUB_APP_WEBHOOK_SECRET GITHUB_APP_ADMIN_ORIGIN; do
    if [[ -z "${!name:-}" ]]; then github_app_missing+=("$name"); fi
  done
  if (("${#github_app_missing[@]}")); then
    printf 'GitHub App configuration must be complete; missing: %s\n' "${github_app_missing[*]}" >&2
    exit 64
  fi
  if [[ ! "$GITHUB_APP_ID" =~ ^[0-9]{1,40}$ || ! "$GITHUB_APP_SLUG" =~ ^[A-Za-z0-9-]{1,100}$ ]]; then
    echo 'GITHUB_APP_ID or GITHUB_APP_SLUG is invalid.' >&2
    exit 64
  fi
  if [[ "$GITHUB_APP_PRIVATE_KEY" != *'PRIVATE KEY-----'* ]]; then
    echo 'GITHUB_APP_PRIVATE_KEY must contain a PEM private key.' >&2
    exit 64
  fi
  if (("${#GITHUB_APP_WEBHOOK_SECRET}" < 32)); then
    echo 'GITHUB_APP_WEBHOOK_SECRET must contain at least 32 characters.' >&2
    exit 64
  fi
  if [[ ! "$GITHUB_APP_ADMIN_ORIGIN" =~ ^https:// ]]; then
    echo 'GITHUB_APP_ADMIN_ORIGIN must use https in production.' >&2
    exit 64
  fi
  if [[ ",$WEB_BASE_URL," != *",$GITHUB_APP_ADMIN_ORIGIN,"* ]]; then
    echo 'GITHUB_APP_ADMIN_ORIGIN must be included in WEB_BASE_URL.' >&2
    exit 64
  fi
fi

oidc_configured=false
for name in OIDC_ISSUER OIDC_CLIENT_ID OIDC_CLIENT_SECRET OIDC_CALLBACK_URL OIDC_STATE_SECRET RDPS_API_PUBLIC_ORIGIN RDPS_OIDC_ADMIN_ORIGIN; do
  if [[ -n "${!name:-}" ]]; then oidc_configured=true; fi
done
if [[ "$oidc_configured" == true ]]; then
  oidc_missing=()
  for name in OIDC_ISSUER OIDC_CLIENT_ID OIDC_CLIENT_SECRET OIDC_CALLBACK_URL OIDC_STATE_SECRET RDPS_API_PUBLIC_ORIGIN RDPS_OIDC_ADMIN_ORIGIN; do
    if [[ -z "${!name:-}" ]]; then oidc_missing+=("$name"); fi
  done
  if (("${#oidc_missing[@]}")); then
    printf 'OIDC configuration must be complete; missing: %s\n' "${oidc_missing[*]}" >&2
    exit 64
  fi
  for name in OIDC_ISSUER OIDC_CALLBACK_URL RDPS_API_PUBLIC_ORIGIN RDPS_OIDC_ADMIN_ORIGIN; do
    value=${!name}
    case "$value" in https://*) ;; *) printf '%s must use https in production.\n' "$name" >&2; exit 64 ;; esac
  done
  if (("${#OIDC_STATE_SECRET}" < 32)); then
    echo 'OIDC_STATE_SECRET must contain at least 32 characters.' >&2
    exit 64
  fi
  if [[ "${OIDC_AUTO_PROVISION:-false}" != false && "${OIDC_AUTO_PROVISION:-false}" != true ]]; then
    echo 'OIDC_AUTO_PROVISION must be exactly true or false.' >&2
    exit 64
  fi
fi

docker compose --file docker-compose.production.yml config --quiet
echo 'Production configuration is complete and Compose validation passed.'
