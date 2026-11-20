#!/bin/sh
set -eu

node /opt/rdps/public-web/server.mjs &
metadata_pid=$!
trap 'kill "$metadata_pid" 2>/dev/null || true' EXIT INT TERM

nginx -g 'daemon off;' &
nginx_pid=$!
wait "$nginx_pid"
