# ADR 0015 — An investor may publish their investment focus to the network

## Status

Proposed — 2026-09-25. A product decision for the user; nothing is
implemented. Would amend doc 19 §204.9 only in the sense of adding a new,
investor-authorised, network-visible projection; the rule itself stands.

## Context

A founder asking Q "which investors would likely invest in us?" is asking
for prospects. Capital Q can currently compare a company with an investor
only on the investor's network-visible declared profile: where they are
based, what kind of investor they are, whether they say they are deploying
(`find_prospective_investors`, `prospect-fit.v1`). What an investor actually
backs — stages, sectors, geographies, cheque range — lives only in their
mandate.

The mandate is `investor_private`. Doc 19 §204.9 makes it release-blocking
that a mandate must not shape what a founder sees, and the discovery
package enforces it: founder-facing investor slates are ranked on the
declared profile only (`RANKED_ON_DECLARED_PROFILE_ONLY`), and every
declared-fit feature is confined to `INVESTOR_DISCOVER`. That rule is right:
an investor who declared a mandate for their own feed never agreed to have
it matched against every founder on the network.

So prospect answers today are honest but thin: no sector, stage or cheque
reason can be given, because none may be read.

## Decision (proposed)

Add an explicit, opt-in **public investment focus**: a separate projection an
investor organisation chooses to publish to the network.

1. **Opt-in, per organisation.** Off by default. Turning it on is a
   consequential change to what the investor discloses and goes through the
   Approval Engine like any other profile change (ADR 0011). Only the
   organisation's admins may turn it on.
2. **Projected from the ACTIVE mandate, never a DRAFT.** The projection is
   derived deterministically from the one ACTIVE mandate: stage range,
   taxonomy preferences with `user_selected`/`admin_curated` provenance,
   positive geography constraints, and the cheque range rounded to a band.
   Hard exclusions, notes, raw mandate text, discovery mode, portfolio and
   anything `MANUAL_ONLY` are never projected. An organisation with more than
   one ACTIVE mandate chooses which one is public.
3. **Its own row and visibility.** Stored as its own projection with
   `visibility_scope = network_visible` and its own version, never as a
   relaxed classification of the mandate. The mandate stays
   `investor_private`; the Context Firewall's `INVESTOR_MANDATE` scope stays
   owner-only (`sharedVia: null`).
4. **Revocable, with history.** Turning it off removes the projection from
   every founder-facing read at once. Revisions are appended, not
   overwritten. A mandate edit re-projects only while publication is on.
5. **Read path.** A new firewall scope (actor-wide, network-visible) admits
   the projection; `find_prospective_investors` and the founder-side
   investor slate may then add STAGE, SECTOR, GEOGRAPHY and CHEQUE reasons,
   still labelled "likely fit, not evidence of interest". Unknown is never
   a penalty.

## Consequences

- Founders get prospect answers that say why, in the investor's own
  published terms, without any private mandate being read.
- Investors keep full control: nothing about them is matched against
  founders unless they choose it, and they can stop at any time.
- Requires a migration, an RLS policy with positive, cross-tenant-negative
  and revoked-grant tests, a firewall scope-kind contract change, and an
  investor-facing setting with an honest explanation of what becomes
  visible. None of this is started.

## Alternatives considered

- **Match founders against mandates directly.** Rejected: breaks doc 19
  §204.9 and the investor's reasonable expectation of privacy.
- **Infer focus from the public description with a model.** Rejected for
  ranking: a model reading free text is not a declaration, and would turn
  an investor's prose into a claim they never made.
- **Do nothing.** Viable; prospect answers stay at geography, type and
  deployment reasons plus cited public research.
