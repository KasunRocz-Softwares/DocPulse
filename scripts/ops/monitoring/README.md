# RDPS production monitoring operations

Prometheus and Blackbox mount their configuration files read-only. Alertmanager's webhook configuration is generated when its container starts. A file update alone does not reliably apply to all three services.

After changing `prometheus.yml`, `alerts.yml`, `blackbox.yml`, or the Alertmanager webhook environment value, apply the configuration from the production deployment directory:

```sh
docker compose -f docker-compose.production.yml up -d --force-recreate prometheus blackbox-exporter alertmanager
```

This recreates the three configuration consumers, preserves their named data volumes, and makes the running processes load the mounted files and current Alertmanager environment. Prometheus also has `--web.enable-lifecycle`; where an authorized HTTP path to port 9090 is available, `POST /-/reload` can reload only Prometheus configuration and rules. Use the Compose recreation command when applying Blackbox or Alertmanager changes.

Check that Prometheus becomes ready and that its scrape targets are healthy:

```sh
docker compose -f docker-compose.production.yml exec -T prometheus wget -qO- http://127.0.0.1:9090/-/ready
docker compose -f docker-compose.production.yml exec -T prometheus wget -qO- http://127.0.0.1:9090/api/v1/targets
docker compose -f docker-compose.production.yml exec -T prometheus wget -qO- http://127.0.0.1:9090/api/v1/rules
docker compose -f docker-compose.production.yml ps prometheus blackbox-exporter alertmanager
```

Inspect the targets response for every configured job and `health: "up"`; inspect the rules response for loaded `rdps-availability` rules. The Prometheus readiness endpoint confirms startup, while target and rule endpoints confirm the loaded monitoring state.
