# ADR-001: Modular monolith with a separate worker

- **Status:** Accepted for the current product architecture
- **Date:** 2026-11-11
- **Source:** [Full product design](../superpowers/specs/2026-11-10-rdps-full-product-design.md)

## Context

RDPS has coupled identity, project authorization, release authoring, approval, publication, integrations and public delivery. Those operations need clear boundaries and transactional guarantees, while the product is still evolving. Running every domain as an independently deployed service would multiply deployment, authorization and consistency paths. Synchronous web requests also should not own long-running or retryable webhook and projection work.

The current repository is a TypeScript monorepo: `apps/api` hosts domain modules in one NestJS process, `apps/worker` runs asynchronous work, and both use PostgreSQL and Redis through explicit adapters.

## Decision

Keep domain capabilities in a modular NestJS API process, with modules and services owning their domain rules. Run asynchronous and retryable jobs in a separate worker process. Use PostgreSQL as durable state and Redis/BullMQ for queued work. Keep the admin and public web applications as separate clients.

## Consequences

- Domain operations can share transactional persistence and authorization primitives without network calls between every capability.
- Worker capacity and failure/retry behavior can be managed separately from HTTP request capacity.
- Internal and public routes must retain explicit module, DTO, repository and policy boundaries; one process does not imply shared authorization.
- Modules need dependency discipline so the monolith remains modular. Cross-module writes should go through domain services rather than reaching into another module's storage policy.
- A later service extraction is possible at stable boundaries, but is not a reason to add distributed transactions now.

## Revisit when

Independent scaling, isolation, release cadence, or regulatory boundaries cannot be met by the current process split, and measured operational evidence supports extraction.
