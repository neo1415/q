# ADR 0038: INVESTOR_IDENTITY, a separate identity claim for investors' people

- Status: Accepted (founder decision, 2026-10-02)
- Amends: `20261007090000_verification_claims.sql`, `packages/contracts/src/http/verification.ts`

## Context

The single verification flow ("Verify you and <organisation>") verifies the
person as well as the organisation, on the founder side and the investor
side. The claim vocabulary had only `FOUNDER_IDENTITY` for a person, so an
investor's person was being recorded as a "founder identity". That
mislabels the person and could let an investor-side claim count towards a
company's founder readiness. The founder's decision: "of course we
differentiate founders and investors."

## Decision

1. Add the claim type `INVESTOR_IDENTITY` (subject `PERSON`) for a person
   acting for an investor organisation. `FOUNDER_IDENTITY` stays for
   founders. `personClaimTypeFor(kind)` in `@capital-q/verification` is the
   one place that picks between them.
2. `claim_type` is a checked text column, not a Postgres enum, and the
   contract keeps its `as const` list with a Zod schema, not a TypeScript
   `enum`. This change widens the check additively. Moving claim types into
   a reference table would rewrite a release-sensitive table for no
   behavioural gain, so it stays out of scope.
3. Fix forward and keep the history. `verification_claims` is append-only,
   so existing investor-side `FOUNDER_IDENTITY` rows are never changed.
   Every revision is re-created under `INVESTOR_IDENTITY` with its status,
   decision, decider and timestamps; the decision's `decides_claim_id`
   points at the moved request. Each move is recorded in
   `evidence.verification_claim_reclassifications` (server-only and
   append-only). The function `private.reclassify_investor_identity_claims()`
   is idempotent. It refuses to run while an open identity submission still
   points at a claim that would move.
4. Company readiness keeps reading only `FOUNDER_IDENTITY`. An investor's
   identity never counts towards a company's readiness, and the reverse is
   also true.

## ADR-001 alignment

`verification_claims` remains a separate workflow. It is not folded into the
`truth_class`, `evidence_status` or `lifecycle_status` axes. The new value
is a claim type, not a truth or evidence state.

## Consequences

- The admin queue labels the two types differently ("Founder identity" and
  "Investor identity"). It still pairs a person's claim with their
  organisation's claim for one "Verify both" action. Each claim is decided
  and recorded separately.
- The original investor-side `FOUNDER_IDENTITY` rows remain as historical
  rows that nothing reads for an investor organisation.
