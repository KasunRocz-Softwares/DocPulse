# Governed deployment runner

The deployment trigger flow stores the authorized request and then enqueues one BullMQ job in `deployment-triggers`. The request ID is the BullMQ job ID. Idempotent API replays return the existing request and do not enqueue again after the dispatch marker is saved. If the first enqueue fails or the API stops before it records that marker, a replay retries the enqueue with the same BullMQ job ID. The worker retries transient dispatch errors five times with exponential backoff and stores exhausted jobs in `deployment-triggers-dead-letter`.

## Worker configuration

Development Compose runs a local deployment runner and a stateful sandbox target on the private Docker network. Both services are development-only. The production runner remains an external HTTPS integration using the signed dispatch and status contract below.

The local runner reports `RUNNING` before signing a `POST /deploy` to the sandbox target. Development Compose sets `DEPLOYMENT_TARGET_URL` to `http://sandbox-target:3081` and gives the runner and target the same `DEPLOYMENT_TARGET_SIGNING_SECRET`. The runner uses the configured origin for both target requests and does not follow redirects. It forwards the project, release, environment, request and idempotency identifiers. The target persists its active release mapping in the `rdps_dev_sandbox_target` volume and enforces idempotency. Before returning `202`, the runner fsyncs the accepted dispatch journal in the `rdps_dev_deployment_runner` volume. It resumes incomplete jobs from that journal after restart. Replayed requests receive the existing acceptance and do not schedule a second execution.

Each target call has a two-second timeout. The runner retries network errors, non-success responses, malformed health JSON, and mismatched state until a five-second overall health deadline. It reports `SUCCEEDED` only when healthy state confirms the requested release for the requested project and environment. Failed apply or verification reports `FAILED` with `LOCAL_TARGET_APPLY_FAILED` or `LOCAL_TARGET_VERIFY_FAILED` and a generic summary.

The runner retries signed status callbacks with capped exponential backoff and persists its phase before advancing. A failed `RUNNING` callback delays target application. A terminal callback failure remains journaled and is retried during operation and after restart. Keep the named runner state volume when recreating the development runner. To recover a lost or corrupted journal, inspect the RDPS request and sandbox target health, then use the governed request/status workflow to reconcile before issuing a new trigger. Do not remove either state volume as routine cleanup.

Cleartext runner target and RDPS callback URLs are accepted only for localhost, IPv4 loopback, IPv6 loopback, and the Compose service names `api` and `sandbox-target`. Other destinations require HTTPS.

Set these environment secrets on the API and worker services:

| Variable                           | Required by             | Purpose                                                                                                                                                                                |
| ---------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEPLOYMENT_RUNNER_URL`            | worker                  | Fixed HTTPS dispatch endpoint. Plain HTTP, embedded credentials, and redirects are rejected. This value is operator configuration; it is never accepted from a request or job payload. |
| `DEPLOYMENT_RUNNER_SIGNING_SECRET` | API, worker, and runner | Shared HMAC-SHA256 key. Use at least 32 random characters and provision it through the deployment secret manager.                                                                      |
| `RDPS_API_URL`                     | worker                  | RDPS API base URL used for the fixed worker callback route. Production should use HTTPS; private container-network HTTP is allowed for development.                                    |
| `RDPS_WORKER_SHARED_SECRET`        | API and worker          | Existing authenticated worker callback secret. Provision the same high-entropy value to both services.                                                                                 |
| `REDIS_URL`                        | API and worker          | BullMQ connection.                                                                                                                                                                     |

Do not put any secret in a deployment trigger reason, runner response, or status summary. The signing key and callback secret are only read from process environment and are never persisted in the deployment request record.

## Runner request contract

RDPS sends a JSON `POST` to the configured endpoint. It follows no redirects and times out after 10 seconds. The request body contains only:

```json
{
  "requestId": "<uuid>",
  "projectId": "<uuid>",
  "releaseId": "<uuid>",
  "environmentId": "<uuid>",
  "idempotencyKey": "<caller-provided-safe-key>",
  "reason": "<optional-approved-reason-or-null>"
}
```

Headers:

- `Idempotency-Key`: the same key in the body. The runner must deduplicate this key (or `requestId`) because network retries can deliver the same request more than once.
- `X-RDPS-Timestamp`: Unix time in milliseconds.
- `X-RDPS-Signature`: `sha256=` followed by the lowercase hex HMAC-SHA256 of the exact UTF-8 string `${timestamp}.${rawRequestBody}`.
- `Content-Type: application/json`.

The runner must verify the signature with constant-time comparison, reject timestamps outside a short configured replay window (five minutes is recommended), and enforce idempotency before starting work. It should return any 2xx status once the request is durably accepted. RDPS ignores the response body and reads at most 8 KiB; keep it small. Non-2xx responses, redirects, timeout, signature/configuration errors, and oversized responses are retried. Logs contain only safe error names/codes and request IDs, never request headers, secrets, or response bodies.

## Status callbacks

After a 2xx runner response, the worker calls:

```http
POST {RDPS_API_URL}/api/v1/internal/deployment-orchestration/worker/requests/{requestId}/status
X-RDPS-Worker-Secret: {RDPS_WORKER_SHARED_SECRET}
Content-Type: application/json
```

```json
{
  "status": "ACCEPTED",
  "resultCode": "RUNNER_ACCEPTED",
  "resultSummary": "Deployment runner accepted the request"
}
```

After the final dispatch attempt fails, the worker reports `FAILED` with a constrained diagnostic code and a generic summary, and adds a dead-letter record. If the runner accepted the request but the RDPS callback remained unavailable, the worker dead-letters the job without falsely marking the deployment failed; the request remains `REQUESTED` for reconciliation. The worker callback is authenticated with the shared worker secret, updates only requests still in `REQUESTED`, and is safe to retry. It will not overwrite a status already advanced by an administrator.

### Runner execution updates

The runner reports accepted, running, succeeded, failed, or cancelled execution state to:

```http
POST {RDPS_API_URL}/api/v1/internal/deployment-orchestration/runner/requests/{requestId}/status
X-RDPS-Timestamp: <Unix milliseconds>
X-RDPS-Signature: sha256=<lowercase HMAC-SHA256 hex>
Content-Type: application/json
```

Sign the exact request bytes with the same `${timestamp}.${rawRequestBody}` HMAC input used for dispatch. RDPS accepts timestamps within five minutes and validates the signature in constant time. The body uses the same status and constrained result fields as the runner status API. Retry with a fresh timestamp after network failure or timestamp expiry; duplicate callbacks for the current state are idempotent. Status transitions remain enforced and audited by RDPS. Deployment execution never publishes or changes the release.

## Operations

- Alert on failed jobs in `deployment-triggers-dead-letter` and on `deployment_trigger.failure_callback_failed` logs.
- Resolve the underlying runner or callback issue, then use the existing governed request/status workflow to decide whether to issue a new trigger request. Do not replay dead-letter jobs blindly unless the runner honors the idempotency contract.
- Rotate the signing and callback secrets in the secret manager and runner configuration together. Do not log either value during rotation.
- Confirm the runner is reachable over HTTPS from the worker network and that its certificate chain is trusted before enabling environment deployment-trigger policy.

## Sandbox runner verification

| Command                                                                                                                                             | Output                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node --test scripts/dev-runner/server.test.mjs` before implementation                                                                              | `tests 6`, `pass 0`, `fail 6`. The simulated runner skipped the target and returned `SUCCEEDED` in failure scenarios.                                                           |
| `node --test scripts/dev-runner/server.test.mjs` after implementation                                                                               | `tests 6`, `pass 6`, `fail 0`.                                                                                                                                                  |
| `node --test scripts/dev-runner/*.test.mjs`                                                                                                         | `tests 18`, `pass 18`, `fail 0`.                                                                                                                                                |
| `pnpm test`                                                                                                                                         | Initial run failed with `jq: command not found`. With jq 1.8.1 on the process PATH, Turbo reported `13 successful, 13 total` and Node reported `tests 67`, `pass 67`, `fail 0`. |
| `pnpm format:check`                                                                                                                                 | Exit 1. Prettier flagged only `docs/superpowers/plans/2026-11-12-rdps-sandbox-deployment.md`.                                                                                   |
| `pnpm exec prettier --check scripts/dev-runner/server.mjs scripts/dev-runner/server.test.mjs docker-compose.yml docs/runbooks/deployment-runner.md` | `All matched files use Prettier code style!`                                                                                                                                    |
| `docker compose -f docker-compose.yml config --quiet`                                                                                               | Exit 0 with no output.                                                                                                                                                          |

## Task 2 fix round 1 verification

| Phase                                               | Command                                                                                                                                             | Result                                                                                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| RED, callback retries disabled temporarily          | `node --test --test-name-pattern='retries a rejected RUNNING' scripts/dev-runner/server.test.mjs`                                                   | Failed as expected. The callback attempt assertion observed `1 !== 2`, showing that a rejected `RUNNING` acknowledgement was not retried. |
| RED, restart recovery disabled temporarily          | `node --test --test-name-pattern='recovers an accepted dispatch' scripts/dev-runner/server.test.mjs`                                                | Failed as expected. The accepted job did not resume after restart and the test timed out at 15,000 ms.                                    |
| RED, transient health retry disabled temporarily    | `node --test --test-name-pattern='retries transient health network' scripts/dev-runner/server.test.mjs`                                             | Failed as expected. A transient probe produced `FAILED` where the test expected `SUCCEEDED`.                                              |
| RED, cleartext host validation disabled temporarily | `node --test --test-name-pattern='external target cleartext                                                                                         | external callback cleartext' scripts/dev-runner/server.test.mjs`                                                                          | Both rejection tests failed as expected because the runner accepted the external HTTP destinations. |
| GREEN                                               | `node --test scripts/dev-runner/server.test.mjs`                                                                                                    | `tests 15`, `pass 15`, `fail 0`.                                                                                                          |
| GREEN                                               | `node --test scripts/dev-runner/*.test.mjs`                                                                                                         | `tests 27`, `pass 27`, `fail 0`.                                                                                                          |
| GREEN                                               | `pnpm test` with temporary jq 1.8.1 on PATH                                                                                                         | Exit 0. Node reported `tests 76`, `pass 76`, `fail 0`.                                                                                    |
| Formatting                                          | `pnpm format:check`                                                                                                                                 | Exit 1 because Prettier flags only the out-of-scope sandbox deployment plan file.                                                         |
| Formatting                                          | `pnpm exec prettier --check scripts/dev-runner/server.mjs scripts/dev-runner/server.test.mjs docker-compose.yml docs/runbooks/deployment-runner.md` | `All matched files use Prettier code style!`                                                                                              |
| Compose                                             | `docker compose -f docker-compose.yml config --quiet`                                                                                               | Exit 0 with no output.                                                                                                                    |

Changed files:

- `scripts/dev-runner/server.mjs`
- `scripts/dev-runner/server.test.mjs`
- `docker-compose.yml`
- `docs/runbooks/deployment-runner.md`

### Task 2 fix round 2

| Phase      | Command                                                                                       | Result                                                                                                                                                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RED        | `node --test --test-name-pattern='journal failure' scripts/dev-runner/server.test.mjs`        | Failed as expected with `ENOENT` for `accepted-dispatches.json`. The first request was rejected after the injected write failure, but the buggy in-memory entry caused the same-key retry to return `202` without a journal record. |
| GREEN      | `node --test --test-name-pattern='journal failure' scripts/dev-runner/server.test.mjs`        | `tests 1`, `pass 1`, `fail 0`. Retry is durably journaled and the deployment runs once to `SUCCEEDED`.                                                                                                                              |
| GREEN      | `node --test scripts/dev-runner/server.test.mjs`                                              | `tests 16`, `pass 16`, `fail 0`.                                                                                                                                                                                                    |
| GREEN      | `node --test scripts/dev-runner/*.test.mjs`                                                   | `tests 28`, `pass 28`, `fail 0`.                                                                                                                                                                                                    |
| Formatting | `pnpm exec prettier --check scripts/dev-runner/server.mjs scripts/dev-runner/server.test.mjs` | `All matched files use Prettier code style!`                                                                                                                                                                                        |
| Compose    | `docker compose -f docker-compose.yml config --quiet`                                         | Exit 0 with no output.                                                                                                                                                                                                              |

The dispatch now persists a candidate journal snapshot before publishing a newly accepted job in memory. URL rejection tests register cleanup for their temporary state directories.
