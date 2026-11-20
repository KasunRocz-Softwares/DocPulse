#!/bin/sh
set -eu

case "${RDPS_ALERT_WEBHOOK_URL:-}" in
  https://*) ;;
  *) echo 'RDPS_ALERT_WEBHOOK_URL must be an HTTPS URL.' >&2; exit 64 ;;
esac
if ! printf '%s\n' "$RDPS_ALERT_WEBHOOK_URL" | grep -Eq '^https://[A-Za-z0-9._~:/?&=%+@-]+$'; then
  echo 'RDPS_ALERT_WEBHOOK_URL contains characters unsafe for the generated config.' >&2
  exit 64
fi

umask 077
cat > /tmp/alertmanager.yml <<EOF
global:
  resolve_timeout: 5m
route:
  receiver: rdps-operations
  group_by: [alertname, job]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
receivers:
  - name: rdps-operations
    webhook_configs:
      - url: "$RDPS_ALERT_WEBHOOK_URL"
        send_resolved: true
EOF
exec "$@"
