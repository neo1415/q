# ADR 0003 — Relationship tenant anchor and cross-organisation access semantics

## Status

Accepted — 2026-09-04. Clarifies Document 13 (network domain) for CQ-NET-001.
Requested by the packet as "ADR-002"; that number was already taken by the
capital-objective instrument decision, so this is ADR 0003. It does not amend
the PADL, the Product Specification or the Final System Review; it resolves a
lower-level database implementation ambiguity.

## Context

A Company ↔ Investor Organisation relationship is inherently
cross-organisational and, under V1 tenancy, may span two tenants: the
company's and the investor organisation's. Document 13 nevertheless defines a
single `network.relationships.tenant_id`, and every tenant-owned table in the
repository carries an explicit tenant anchor with relational coherence.

Two wrong readings must be excluded: that the relationship "belongs" to one
side only, and that the investor side should get its own copy of the
relationship inside its tenant so that single-tenant access rules keep
working. Either would break the governing invariant that one canonical pair
has exactly one relationship and one history.

## Decision

1. A relationship remains one global canonical pair:
   `UNIQUE (company_id, investor_organisation_id)` with no source, tenant or
   capital objective in the key.
2. `network.relationships.tenant_id` is the **company's tenant**, used as the
   V1 storage/home anchor and enforced relationally by
   `FOREIGN KEY (company_id, tenant_id) REFERENCES core.companies (id, tenant_id)`.
   `network.relationship_events.tenant_id` follows the relationship.
3. That `tenant_id` is **not** sufficient by itself to authorise access by
   either party. Authorised access must consider the company party, the
   investor organisation party, the current actor's organisation, and the
   disclosure/relationship rules that apply to the specific event scope.
4. Investor-side access is never implemented by duplicating the relationship
   into the investor's tenant. One pair, one row, one history.
5. CQ-PERM-001 establishes the explicit party and disclosure access
   semantics (including what `relationship_shared` means for each side).
6. Until that layer exists, `network.relationships` and
   `network.relationship_events` are server-internal: RLS enabled, no
   policies, no `anon`/`authenticated` grants, no HTTP API. A single-tenant
   browser policy such as `tenant_id = current actor tenant` is explicitly
   rejected because it would block the investor side forever.
7. Future enterprise tenancy may denormalise party tenant references (for
   example an `investor_tenant_id` column or a party index) if performance
   requires it, without changing `RelationshipId` or the pair invariant.

## Consequences

- Discover, GateQ, search, recommendation and Q origins converge on the same
  `RelationshipId`; `first_discovered_at` is set once.
- Application services reach the company and the investor organisation
  through their public query ports with tenant-agnostic canonical lookups
  that return trusted ownership metadata; callers authorise separately.
- Privileged database access to these tables is infrastructure, not business
  authorisation; the Network application service still requires trusted
  calling contexts when it is exposed later.
