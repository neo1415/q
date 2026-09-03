# ADR 0004 — Disclosure policy ownership and party-side sharing authority

**Status:** Accepted (CQ-PERM-001)
**Amends:** Document 13 §26.1 (`permissions.disclosure_policies`), Document 15 §12 (authorization scope), ADR 0003.

## Context

Document 13 sketches `permissions.disclosure_policies` with `owner_organisation_id` only,
while ADR-001 makes `personal_private` a canonical scope that means "the owning Person
only". A person-owned resource (a founder profile, a private note) has no organisation
that can stand in for its owner without faking a personal organisation, which PADL #145
forbids (Person ≠ Organisation ≠ Membership).

A second gap: a canonical relationship (CQ-NET-001) is bilateral state with no single
owning organisation, stored under the company tenant as an anchor (ADR 0003). The
capability authorization evaluator (CQ-SEC-002) denies any request whose actor tenant
differs from the resource tenant, so an investor-side administrator could never hold
`disclosure.manage` over a relationship scoped to the company tenant.

## Decision

1. `permissions.disclosure_policies` carries **both** `owner_organisation_id` (nullable) and
   `owner_user_id` (nullable), with `CHECK (owner_user_id IS NOT NULL OR
owner_organisation_id IS NOT NULL)` and `CHECK (scope_type <> 'personal_private' OR
owner_user_id IS NOT NULL)`. Person ownership is a Person. No personal organisation is
   ever created to represent it.
2. Owner columns are **derived server-side** from the canonical resource through the
   owning domain's query port. No command, route or client carries an owner identity.
3. **Party-side authority.** For a resource with an owning organisation, `disclosure.manage`
   and `disclosure.inspect` are evaluated on the exact `RESOURCE` scope in the owner's
   tenant and organisation. For a bilateral resource (a relationship, or a relationship
   event whose scope names no side), a canonical party evaluates the same capability on
   the `RESOURCE` scope in **its own tenant and organisation**; the policy it creates
   records that organisation as `owner_organisation_id`. A non-party receives a scope no
   authority covers. This is the party/disclosure access model ADR 0003 deferred to
   CQ-PERM-001; the relationship's storage tenant remains an anchor, not a rule.
4. The evaluator never compares an actor's tenant with a policy's tenant. Recipients may
   live in another tenant; that is the normal case for a relationship.

## Consequences

- One policy table serves person-owned, organisation-owned and bilateral resources
  without a second ownership model.
- Both exact relationship parties can share into and inspect a relationship; unrelated
  organisations, including other investors with their own relationship to the same
  company, cannot.
- A future multi-organisation tenant changes nothing here: authority is always evaluated
  against an explicit organisation, never against tenant co-membership.
