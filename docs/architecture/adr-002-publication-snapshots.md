# ADR-002: Public delivery reads approved publication snapshots

- **Status:** Accepted
- **Date:** 2026-11-11
- **Source:** [Full product design](../superpowers/specs/2026-11-10-rdps-full-product-design.md)

## Context

Internal release records may contain confidential material. Filtering an internal record in a public controller or frontend makes every new field and query path a potential disclosure. A published version must also remain reproducible after internal content changes.

The product design requires an exact reviewed revision, immutable public snapshots, explicit unpublishing, and public repositories that do not resolve internal content dynamically. The current API exposes separate internal publishing and public delivery controller families; Prisma stores publication and snapshot records.

## Decision

Only an explicit publishing command after approval may materialize public snapshot data. Public delivery reads the public snapshot/publication model through public services and DTOs. It does not serialize an internal release and hide selected fields. Unpublishing revokes the publication's public availability while retaining history and audit evidence. A later publication is a new publication event/revision.

## Consequences

- The review preview and publication command must refer to the same approved revision.
- Snapshot projection is a security boundary and must be tested for field allowlisting and cross-project isolation.
- Search, cache, feeds, sharing metadata, exports and attachments must derive from currently valid public publication state and honor revocation.
- Internal edits after publication do not silently rewrite the already-published snapshot.
- Snapshot schema changes require explicit migration/projection handling; they cannot be handled by exposing new internal fields automatically.

## Revisit when

The product changes its public version-history policy or storage model. Any replacement must preserve explicit approval, reproducibility, public-data allowlisting, revocation semantics and audit history.
