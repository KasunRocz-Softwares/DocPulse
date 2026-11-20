# Production deployment reference

This repository provides production build targets, static web routing, and an
operational release gate. It does **not** provision infrastructure, publish
images, or deploy them. Run deployment from an approved platform pipeline and
inject secrets from its secret manager at runtime.

## Runtime topology

- `api`: NestJS HTTP API on container port `3001`.
- `worker`: BullMQ worker; run at least one replica and scale independently.
- `clamav`: private ClamD malware scanner used for attachment ingestion. It is
  reachable only from services on the internal `private` network; it has no
  published host port, edge/monitoring attachment, or internet egress.
- `web`: Nginx on port `8080`, serving public web at the default host and the
  admin portal when the request host is `admin.example.com` (replace that
  placeholder in the deployment configuration or a reviewed image build).
- The checked-in production Compose profile provisions PostgreSQL and Redis on
  a private internal network with persistent volumes. This is the supported
  single-host topology described by `docs/runbooks/production-deployment.md`.
  Organizations using managed PostgreSQL/Redis must supply a reviewed Compose
  override and adjust the database-backup procedure; do not combine the
  managed-service topology with the checked-in database containers.
- Nginx routes `/api/` to the private `api:3001` service. TLS termination must
  happen at the trusted ingress. Configure forwarded headers there and
  restrict direct access to ports 3001 and 8080.
- Run the `migrate` target as a one-shot release job before rolling out API
  instances. Do not run migrations concurrently from every API replica.

## Build and run locally

From the repository root, with Docker available:

```sh
docker build -f Dockerfile.production --target api -t rdps-api:local .
docker build -f Dockerfile.production --target worker -t rdps-worker:local .
docker build -f Dockerfile.production --target web -t rdps-web:local .
docker run --rm rdps-web:local nginx -t
```

The API requires runtime configuration below and a reachable database before
it can serve normal requests. The web image alone can be started for static
route checks:

```sh
docker run --rm -p 8080:8080 rdps-web:local
curl --fail http://localhost:8080/healthz
curl --fail http://localhost:8080/
curl --fail -H 'Host: admin.example.com' http://localhost:8080/
```

## Runtime configuration and secrets

Supply values as secret-manager references or protected runtime environment
variables. Never add real values to Compose files, image layers, CI logs,
release documentation, or this repository.

| Variable                         | Runtime                                  | Handling                                                                                                                               |
| -------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                   | API and migration job                    | PostgreSQL connection URI with TLS required by the database platform; least-privilege application and migration roles are recommended. |
| `REDIS_URL`                      | API and worker                           | Private Redis endpoint; require TLS/authentication when supported by the managed service.                                              |
| `JWT_ACCESS_SECRET`              | API                                      | Generate a unique high-entropy value for each environment; rotate under a planned session invalidation procedure.                      |
| `BOOTSTRAP_SECRET`               | API, only while bootstrap is enabled     | High-entropy, one-time operational secret. Remove/disable bootstrap access after initial setup.                                        |
| `WEB_BASE_URL`                   | API                                      | Comma-separated exact trusted web origins for credentialed CORS, e.g. `https://admin.example.com,https://releases.example.com`.        |
| `GITHUB_WEBHOOK_SECRET`          | API when GitHub webhooks are enabled     | Dedicated webhook signing secret.                                                                                                      |
| `DEPLOYMENT_WEBHOOK_SECRET`      | API when deployment webhooks are enabled | Dedicated deployment webhook signing secret.                                                                                           |
| `RDPS_WORKER_SHARED_SECRET`      | API and worker                           | Shared API-to-worker processing credential; use a distinct value per environment.                                                      |
| `RDPS_API_URL`                   | Worker                                   | Private API base URL reachable by worker, with no public ingress requirement.                                                          |
| `CLAMAV_HOST`                    | API in production                        | Private malware-scanner service endpoint; production attachment scanning fails closed without it.                                      |
| `CLAMAV_PORT`                    | API, optional                            | Scanner port; default is `3310`.                                                                                                       |
| `CLAMAV_TIMEOUT_MS`              | API, optional                            | Scanner timeout; default is `5000`.                                                                                                    |
| `CLAMAV_IMAGE`                   | Compose scanner                          | Required approved OCI reference pinned to a sha256 digest; update it only after the ClamAV image/signature review.                     |
| `CLAMAV_MEM_LIMIT`               | Compose scanner, optional                | Container memory limit; defaults to `2g`. Increase only after capacity review and scanner load testing.                                |
| `CLAMAV_CPUS`                    | Compose scanner, optional                | Container CPU quota; defaults to `1.0`. Adjust to the host capacity and upload scan latency target.                                    |
| `API_PORT`                       | API, optional                            | HTTP listen port; default is `3001`.                                                                                                   |
| `AI_SUMMARY_PROVIDER_URL`        | API, optional                            | HTTPS OpenAI-compatible chat-completions endpoint; set together with `AI_SUMMARY_MODEL`.                                               |
| `AI_SUMMARY_MODEL`               | API, optional                            | Provider model identifier; set together with `AI_SUMMARY_PROVIDER_URL`.                                                                |
| `AI_SUMMARY_PROVIDER_API_KEY`    | API, optional, secret                    | Bearer credential for providers that require authentication; inject from the secret manager.                                           |
| `AI_SUMMARY_TIMEOUT_MS`          | API, optional                            | Provider request timeout in milliseconds; defaults to `12000`, capped at `20000`.                                                      |
| `PUBLIC_API_RATE_LIMIT`          | API, optional                            | Maximum anonymous public API requests per client per window; defaults to `120`.                                                        |
| `PUBLIC_API_RATE_WINDOW_SECONDS` | API, optional                            | Fixed-window duration; defaults to `60` seconds.                                                                                       |
| `TRUSTED_PROXY_IPS`              | API, optional                            | Comma-separated exact IP addresses of trusted immediate proxy peers; forwarded client-IP headers are ignored otherwise.                |

The checked-in Compose stack supplies `CLAMAV_HOST=clamav` and
`CLAMAV_PORT=3310` to the API and waits for ClamD's protocol health check before
starting the API. It uses the official versioned image with a preloaded
signature database. The scanner is deliberately attached only to the internal
network, so FreshClam cannot reach external update mirrors. Keep signatures
current by periodically reviewing and deploying an updated ClamAV image tag or
digest; include the image digest and signature database age in release
evidence. The image is configured not to start FreshClam or the unused milter.
The API fails closed if this scanner is unhealthy or unavailable.

### External scanner alternative

For a managed or separately operated scanner, configure the API's
`CLAMAV_HOST` and `CLAMAV_PORT` to the private ClamD-compatible endpoint. In a
Compose deployment, use a reviewed deployment overlay that points the API at
that endpoint, removes the local `clamav` service dependency, and omits the
bundled scanner service. For non-Compose deployments, inject the same settings
through the platform's secret/config manager. Keep the ClamD endpoint on a
private, access-controlled network: the ClamD TCP protocol does not provide
transport encryption or client authentication. If traffic crosses a trust
boundary, use a TLS tunnel or a scanner gateway and connect the API to that
private gateway. Preserve health monitoring and fail-closed behavior for the
external service.

Do not place secrets in build arguments or Docker `ARG` values. CI builds are
credential-free and do not push images. Use short-lived identity federation
for registry access in a separate reviewed publishing workflow when one is
introduced.

## Nginx and browser security

The web image applies a Content Security Policy, `X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and
`Cross-Origin-Opener-Policy`. The policy allows stylesheets from
`https://fonts.googleapis.com` and font files from `https://fonts.gstatic.com`
so the admin UI and each project's chosen public-page fonts can load; no other
third-party origins are permitted for styles or fonts. TLS and HSTS belong at the trusted TLS edge;
enable HSTS there only after every covered host is HTTPS. Keep the admin host
behind the organization's access controls. The static web host and API should
use the same site/origin plan needed by the HttpOnly refresh cookie.

## Release procedure

1. Require the CI workflow to pass on the exact commit being released.
2. Build and scan the three runtime images from that commit; record immutable
   image digests and the source commit in the change record.
3. Verify required secret-manager references and managed database/Redis
   connectivity without printing secret values.
4. Verify a recent coordinated PostgreSQL/attachment Restic snapshot and
   complete a restore drill on an isolated target (see
   [backup and restore](backup-restore.md)).
5. Use the deployment entrypoint to capture a fresh encrypted off-site backup;
   it must succeed before the `migrate` image runs.
6. Run the `migrate` image once and confirm its exit status before API rollout.
7. Roll out API, worker, and web images by immutable digest. Keep API and worker
   on the private application network; expose Nginx through TLS ingress only.
8. Check `/healthz`, `/api/v1/health/ready`, public pages, admin sign-in, queue
   processing, and alerting. Confirm no secrets appear in logs.
9. Record image digests, migration result, backup identifier, smoke-check
   result, and rollback decision in the release record.

## Exact development-only smoke commands

These commands use the local-only values from `docker-compose.yml`; never
replace them with production credentials. From the repository root:

```powershell
docker compose up -d --build
docker compose ps
curl.exe --fail http://localhost:13001/api/v1/health/ready
curl.exe --fail http://localhost:5173/
curl.exe --fail http://localhost:5174/
```

To validate the production web image locally, without deployment or registry
access:

```powershell
docker build -f Dockerfile.production --target web -t rdps-web:local .
docker run --rm rdps-web:local nginx -t
```

To run a local backup from a POSIX shell with PostgreSQL client tools installed,
while the development Compose database is up:

```sh
DATABASE_URL='postgresql://rdps:rdps_dev_only@localhost:5432/rdps?schema=public' \
  bash scripts/operations/backup-postgres.sh .tmp/rdps-backups
bash scripts/operations/verify-postgres-backup.sh .tmp/rdps-backups/rdps-postgres-<UTC timestamp>.dump
```

The restore drill is destructive to its target database. Use only a newly
created disposable local database and follow the explicit confirmation steps
in [backup and restore](backup-restore.md).
