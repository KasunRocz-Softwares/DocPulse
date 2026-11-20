# Release Documentation & Publishing System

RDPS manages complete internal release records and publishes separately approved client-facing release notes. Its primary security rule is that public pages read approved publication snapshots only.

## Repository layout

- `apps/admin-web` — internal release management portal
- `apps/public-web` — public release pages
- `apps/api` — NestJS modular API
- `apps/worker` — asynchronous jobs and integrations
- `packages/*` — shared UI, contracts, validation, configuration, and auth boundaries
- `database/prisma` — schema, migrations, and seed data
- `docs` — product, architecture, security, and operations documentation

## Requirements

- Node.js 22 or newer
- pnpm 11.25.0 (Corepack can activate the package manager declared in `package.json`)
- Docker with Docker Compose

## Local setup

1. Copy `.env.example` to `.env` and replace development secrets as needed.
2. Install workspace dependencies with `pnpm install`.
3. Start PostgreSQL and Redis with `pnpm infra:up`.
4. Use `pnpm dev`, `pnpm build`, `pnpm lint`, and `pnpm typecheck` from the repository root as applications are added.

The Compose credentials are for local development only. Do not reuse them outside a developer workstation. Production secrets must come from an approved secret manager.

## Run the full development stack in Docker

Run `docker compose up -d --build` from the repository root. Compose starts PostgreSQL, Redis, the NestJS API, the background worker, the internal portal, and the public portal. The development servers run in the containers; rebuild the image after changing source files.

- Admin portal: <http://localhost:5173>
- Public portal: <http://localhost:5174>
- API liveness, readiness, metrics, and Swagger: <http://localhost:13001/api/v1/health>, <http://localhost:13001/api/v1/health/ready>, <http://localhost:13001/metrics>, and <http://localhost:13001/api/v1/api/docs>
- `docker compose logs -f api worker admin-web public-web` follows application logs.
- `docker compose down` stops the stack and keeps the database volumes. `docker compose down -v` also removes local database data.

## Webhook integration development

The API accepts signed GitHub events at `/api/v1/integrations/github/webhook` and signed deployment events at `/api/v1/integrations/deployments/webhook`. Docker Compose injects local-only values for the GitHub/deployment signing secrets and the worker-to-API shared secret. Replace these with dedicated secret-manager values outside local development.

The API persists verified event identifiers and enqueues normalized jobs on the BullMQ `webhooks` queue. The worker consumes that queue and calls the API's worker-authenticated processing endpoint. Failed jobs are copied to `webhooks-dead-letter` after retries; that queue is producer-only and currently has no consumer, so it remains available for inspection/manual replay.

### Run the isolated full publish E2E

Run `pnpm e2e:isolated-publish` to start a fresh, synthetic publish/isolation flow. It uses uniquely labeled PostgreSQL and Redis containers with tmpfs storage and loopback-only ephemeral ports; it does not mount or reset the Docker Dev database or Redis volumes. The runner applies current migrations, bootstraps a per-run admin, exercises the full publish flow, and removes only resources carrying its run-specific ownership labels.

Run `pnpm test:browser` for headless admin/public desktop and mobile smoke checks and axe scans. The suite starts isolated Vite servers on ports 4173/4174 and mocks API responses, so it does not write to Docker Dev data.

Unmatched GitHub references are stored as `IntegrationSuggestion` records. Project administrators can review pending suggestions in the project administration panel, select a release to accept a reference, or dismiss the suggestion. The API applies project-scoped role authorization to list, accept, and dismiss operations; acceptance validates that the release and linked repository belong to the requested project.

Publication snapshots are created transactionally by the publishing workflow from the approved revision, including frozen branding, locale, and public content. Database triggers reject snapshot mutation and deletion. Public pages and API reads use published snapshots only; unpublishing revokes access to the corresponding snapshot.

## Self-host with Docker (published images)

No clone needed. The images are published to GitHub Container Registry by the [Containers workflow](.github/workflows/containers.yml):
`ghcr.io/kasunrocz-softwares/docpulse-api`, `-worker`, `-web` and `-migrate`.

```sh
mkdir docpulse && cd docpulse
curl -fsSLO https://raw.githubusercontent.com/KasunRocz-Softwares/DocPulse/main/deploy/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/KasunRocz-Softwares/DocPulse/main/deploy/env.example
# Fill in POSTGRES_PASSWORD and the six secrets in .env (openssl rand -hex 32 for each)
docker compose up -d
```

Release pages: <http://localhost:8080>. Admin portal: <http://admin.localhost:8080>. Choose **Create its first admin** and enter your `BOOTSTRAP_SECRET`. See [deploy/env.example](deploy/env.example) for domains, email and malware scanning.

## Production build and operations

Production artifacts are deliberately separate from the development Compose stack. The root [CI workflow](.github/workflows/ci.yml) checks installation, formatting, lint, typechecking, tests, the invite-to-publication E2E flow, workspace build, production Compose configuration, and production Docker images. `Dockerfile.production` exposes `api`, `worker`, `web`, and one-shot `migrate` targets; CI builds but does not publish images or deploy. Nginx serves the public app on its default host and the admin app on an `admin.*` host, and proxies `/api/` to the API service. `docker-compose.production.yml` defines a separate production stack with no host-published database, cache, API, or monitoring ports. It uses distinct named volumes and does not change the local development defaults.

Run production commands only after provisioning secret-manager values and validating the external TLS ingress. Production preflight and deployment scripts live in `scripts/ops/`. Production PostgreSQL recovery uses the guarded `scripts/ops/restore-postgres-safe.sh` wrapper.

See the [production deployment runbook](docs/runbooks/production-deployment.md), [backup and restore runbook](docs/runbooks/backup-and-restore.md), [monitoring and alerting runbook](docs/runbooks/monitoring-and-alerting.md), and [production release checklist](docs/runbooks/release-checklist.md) for secret handling, routing, migrations, recovery, and launch gates. A non-deploying production config check is:

```sh
docker compose --file docker-compose.production.yml config --quiet
```

Production secrets must be injected at runtime from an approved secret manager. Do not reuse the development Compose credentials or place production credentials in images, CI, or documentation.

## Product and architecture decisions

- [Full product design](docs/superpowers/specs/2026-11-10-rdps-full-product-design.md)
- [Full product implementation plan](docs/superpowers/plans/2026-11-10-rdps-full-product.md)
- [Architecture overview](docs/architecture/overview.md)
- [ADR-001: Modular monolith](docs/architecture/adr-001-modular-monolith.md)
- [ADR-002: Immutable publication snapshots](docs/architecture/adr-002-publication-snapshots.md)
- [Threat model](docs/security/threat-model.md)
- [Security disclosure policy](docs/security/disclosure-policy.md)
- [Generated API reference](docs/api/reference.md)

Regenerate the API reference from the running API's OpenAPI endpoint with `node scripts/docs/generate-api-reference.mjs`. Use `--check` in CI or before committing to verify that the checked-in reference is current; set `RDPS_OPENAPI_URL` to use a different OpenAPI endpoint.
