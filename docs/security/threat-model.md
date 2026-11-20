# RDPS threat model

**Status:** Initial implementation-grounded model; review before production launch  
**Reviewed:** 2026-11-11  
**Design source:** [Full product design](../superpowers/specs/2026-11-10-rdps-full-product-design.md)  
**Architecture:** [Overview](../architecture/overview.md)

## Scope and assumptions

This model covers the RDPS admin and public web clients, NestJS API, worker, PostgreSQL, Redis/BullMQ, attachment storage/scanner, and inbound GitHub/deployment events. It assumes browsers, uploaded files, public API callers and integration payloads are untrusted. It assumes production secrets are injected by an approved runtime secret manager as described in [Production deployment](../operations/production-deployment.md).

This is a repository-level threat model, not a penetration-test report or certification. Controls marked **implemented** are visible in source/configuration; they still require deployment and operational verification. A control marked **design requirement** is a product requirement and must not be represented as proven solely because it appears in the design document.

## Assets

| Asset                                             | Confidentiality / integrity concern                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| Internal release drafts, documents and comments   | Disclosure to public users or the wrong project member                    |
| Approved public snapshot and publication state    | Unauthorized publication, mutation, stale cache or failure to revoke      |
| User identities, sessions and project memberships | Account takeover or privilege escalation                                  |
| GitHub/deployment credentials and signing secrets | Forged events or unauthorized source-system access                        |
| Attachments                                       | Malware, private-file disclosure, content spoofing or resource exhaustion |
| Audit history                                     | Tampering, deletion or incomplete attribution                             |
| PostgreSQL, Redis and backups                     | Bulk compromise, persistence tampering, replay or recovery exposure       |
| Availability and integrity of queued jobs         | Duplicate processing, backlog, poison payloads or dropped work            |

## Trust boundaries

1. Browser and internet to trusted ingress/API.
2. Anonymous public routes to authenticated internal routes.
3. One project/tenant to another project/tenant.
4. Webhook sender to RDPS event intake and asynchronous worker.
5. Uploaded bytes to attachment storage and malware scanner.
6. API/worker services to private PostgreSQL and Redis.
7. Production runtime configuration to secret-manager-controlled values.

## Threats and controls

| Threat                                             | Impact                                                           | Current controls/evidence                                                                                                                 | Required validation or follow-up                                                                                                                |
| -------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Internal data exposed through public endpoints     | Confidential drafts, comments or references become public        | Separate `/api/v1/public` controller and public-delivery services; publication/snapshot data model; public DTOs                           | Add/maintain adversarial tests across direct API, search, feeds, cache, exports and attachment routes for unpublished and cross-project IDs     |
| Cross-project authorization bypass                 | A user reads or changes another project's releases               | JWT guard and project-scoped service authorization appear in protected modules                                                            | Run complete role × action × project matrix against every route; verify deny-by-default and persistence query scoping                           |
| Unauthorized or self-approved publication          | Malicious or accidental public release                           | Explicit review and publish commands; service-level role checks; audit records in domain operations                                       | Verify separation-of-duties policy in each project configuration; test revision binding, races, replay and audit completeness                   |
| Stale public cache after unpublish                 | Revoked content remains publicly accessible                      | Public response cache interceptor; unpublish operation; `no-store` on host resolution and attachment download                             | Prove purge/invalidation and CDN behavior in production topology; test direct cache, browser cache, feed and search revocation                  |
| Forged/replayed webhook                            | Unauthorized event processing or duplicate side effects          | Signature validation and event persistence/idempotency in integration modules; webhook runtime smoke                                      | Validate all providers, timestamp/replay windows, raw-body signature correctness, duplicate IDs, queue retry and secret rotation                |
| Malicious attachment or parser/resource exhaustion | Malware execution, stored XSS, disk/memory exhaustion            | Content metadata validation, size/type checks and ClamAV integration; production scanner is private and API fails closed when unavailable | Verify all upload paths, parser limits, scan timeout/failure, public download headers, archive expansion limits and scanner signature freshness |
| Session theft or credential guessing               | Account takeover                                                 | Password hashing/session records, HttpOnly refresh-cookie model, public API rate limiting and API security headers                        | Review cookie flags, CSRF assumptions, login throttling, refresh rotation/revocation and proxy-derived client IP in deployed ingress            |
| Secret leakage via logs/config/docs                | Integration or database compromise                               | Production deployment docs require protected runtime secret injection; avoid secrets in image/build inputs                                | Scan logs, CI artifacts, rendered configs, error responses and backup workflows; rotate any exposed credential                                  |
| Queue poisoning or worker/API shared-secret abuse  | Unauthorized or malformed work; persistent processing disruption | Private service network, BullMQ, event idempotency and a worker shared secret in deployment config                                        | Restrict Redis network/authentication, validate job payload schemas, cap retries, monitor dead letters, rotate shared secret                    |
| Audit tampering or gaps                            | Actions cannot be attributed or investigated                     | Audit records created by sensitive domain operations; database persistence                                                                | Test audit coverage for permission changes, approvals, publication/revocation, integration changes and exports; restrict DB-level mutation      |
| Backup theft or incomplete recovery                | Bulk data disclosure or permanent data loss                      | Backup scripts verify archive checksum/listing; restore runbook requires isolated drills and protected storage                            | Configure encrypted off-site retention, access reviews, monitored restore drills, attachment consistency and approved RPO/RTO                   |
| Denial of service through public reads or uploads  | API/worker/database exhaustion                                   | Public API rate limiting, pagination, payload validation, cache headers, bounded scanner timeout                                          | Load test per-endpoint limits; validate reverse-proxy body/time limits, DB pool and queue capacity under abuse                                  |

## Security invariants

- Public delivery returns only currently valid approved snapshot data.
- Authentication and project authorization are enforced by the server on every internal operation.
- An integration event cannot approve or publish a release by itself.
- Publication is tied to a reviewed revision and an explicit user action.
- Unpublishing revokes public availability while preserving audit history.
- Secrets never enter release-document content, public payloads, generated API docs or logs.
- Attachments are not served until the applicable authorization/publication checks pass and scanning policy succeeds.
- Retryable event processing is idempotent for the source event identity.

## Review cadence and change triggers

Review this model at least before production launch and whenever changing identity/session behavior, public projections, approval rules, webhook providers, attachment storage/scanning, cache/CDN topology, queue trust, tenant model or backup provider. Track each unresolved validation as a release risk until evidence exists.

## Related documents

- [Security disclosure policy](disclosure-policy.md)
- [Production deployment](../operations/production-deployment.md)
- [Backup and restore](../operations/backup-restore.md)
- [API reference](../api/reference.md)
