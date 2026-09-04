# Investor onboarding (`@capital-q/investor-onboarding`, CQ-ONB-003)

The Investor journey I0–I12 running on the onboarding runtime
(`docs/modules/onboarding.md`). The package owns **Investor Definition v1**
as declarative reference data and the **integration layer** that maps its
semantic write targets and step contexts onto the canonical domains through
their public services (Organisation, Investor, Taxonomy). It owns no journey
state (the runtime does) and no business truth. Zero model calls, zero
provider SDKs, zero ranking, zero GateQ evaluation.

```
Declared Mandate ≠ Observed Behaviour ≠ Q Inference ≠ GateQ Rules
deployment state (investor) ≠ mandate status (DRAFT | ACTIVE | CLOSED)
AVOID (soft, can still appear) ≠ HARD_EXCLUSION (never in standard discovery)
onboarding answer ≠ canonical mandate constraint
```

## Definition v1

`src/definition/investor-v1.ts` is the manifest; the production migration
`supabase/migrations/20260905120000_investor_onboarding_v1.sql` is rendered
from it by the runtime's `renderOnboardingDefinitionMigration` and
drift-guarded by `test/definition.test.ts`. Publishing the same manifest again
is an idempotent no-op; a change to the journey is v2. Ids are UUIDv5 over
journey + version. Phases `I0`…`I12`; 35 steps; runtime subject type
`INVESTOR_ORGANISATION`, unbound start allowed.

| Step                                                                          | Type                              | Writes to / context                                       |
| ----------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------- |
| `I0.investor_type`                                                            | single_select (canonical types)   | — (consumed by bootstrap)                                 |
| `I0.organisation_name`                                                        | short_text                        | `investor.bootstrap`                                      |
| `I0.business_title`                                                           | short_text (optional)             | `investor.representative`                                 |
| `I1.deployment_status`                                                        | single_select                     | `investor.deployment_status`, `investor.mandate.ensure`   |
| `I1.mandate_context`                                                          | reference_select INVESTOR_MANDATE | `investor.mandate.select` (context `investor.mandates`)   |
| `I2.stages`, `I2.currency`, `I2.cheque_min/typical/max`, `I2.investment_role` | multi/single_select, range        | `investor.mandate.stage_cheque`                           |
| `I3.geography`, `I3.sectors`, `I3.sectors_avoid` (+ strength steps)           | reference_select TAXONOMY_NODE    | `investor.mandate.taxonomy`                               |
| `I4.business_models`, `I4.customer_types`                                     | reference_select TAXONOMY_NODE    | `investor.mandate.taxonomy`                               |
| `I4.capital_intensity`, `I4.regulatory_appetite`                              | single_select                     | `investor.mandate.business_attributes`                    |
| `I4.revenue_state`                                                            | single_select                     | — (DEFERRED: onboarding-only until revenue policy exists) |
| `I5.founder_preferences` (+ strength)                                         | multi_select (allowlist)          | `investor.mandate.founder_preferences`                    |
| `I6.green_flags` (+ strength), `I6.custom_criteria`                           | multi_select, long_text           | `investor.mandate.green_flags` (custom → `custom.text`)   |
| `I7.avoid`, `I7.hard_exclusions`                                              | multi_select                      | `investor.mandate.exclusions`                             |
| `I7.sector_exclusions`                                                        | reference_select TAXONOMY_NODE    | `investor.mandate.taxonomy` (HARD_EXCLUSION)              |
| `I8.portfolio`                                                                | long_text (≤ 5 lines)             | `investor.portfolio`                                      |
| `I9.discovery_mode`                                                           | single_select                     | `investor.mandate.discovery_mode`                         |
| `I10.inbound_preference`                                                      | single_select                     | — (onboarding-only; `InvestorInboundPreference` seam)     |
| `I11.additional_context`                                                      | long_text                         | `investor.mandate.raw_text`                               |
| `I11.review`                                                                  | confirmation                      | `investor.mandate.confirm` (context `investor.review`)    |
| `I12.handoff`                                                                 | confirmation                      | — (context `investor.handoff`)                            |

Field matrix: TAXONOMY (geography, sectors, business models, customer types,
sector exclusions) uses the same `TaxonomyNodeId` namespace as company
classification and lands in `taxonomy.mandate_preferences` with an explicit
strength. MANDATE CONSTRAINT (stage, cheque, investment role, business
attributes, founder attributes, green/red flags, custom text) lands in the
mandate's constraint set through `MANDATE_CONSTRAINT_REGISTRY`. DEFERRED
(revenue expectations, inbound preference) stays a typed onboarding answer
shown in the review as "onboarding-only". Nothing is collapsed into a single
"sector" label.

## Integration layer

`createInvestorOnboardingIntegration({ outbox, audit, securityEvents? })`
returns the `writeTargets` and `stepContextProviders` the API composition
root merges with the Founder ones. Handlers run inside the runtime's
transaction on a savepoint-backed `TransactionManager`; every canonical
write goes through the owning service's public contract with its own
authorization, versioning, audit and events.

- **`investor.bootstrap` (I0.organisation_name)** — with no organisation
  context: `organisations.createOrganisation` from the verified principal
  (type mapped from the investor type; a solo angel's workspace is
  "Personal Investing"), then `investors.createInvestorOrganisation`, then a
  representative row for the acting person, then the session binds one-way
  to the investor organisation. With an existing context: the existing
  investor organisation is reused (one per organisation) or created. Never
  a self-join by typing a fund's name; never a first-membership fallback;
  retry-safe (a repeated I0 renames the same organisation).
- **`investor.representative`** — upserts the caller's business title.
  Descriptive only; grants nothing.
- **`investor.deployment_status`** — `deploymentState` on the investor
  organisation (ACTIVELY_INVESTING | SELECTIVE | PAUSED | EXPLORING_ONLY),
  distinct from mandate status.
- **`investor.mandate.ensure`** — creates "Primary mandate" as DRAFT when the
  investor has no open mandate. Nothing is activated here.
- **`investor.mandate.select`** — the chosen mandate is stored as a typed
  `RESOURCE_REFERENCE` response (never arbitrary JSON) and validated: it must
  belong to the bound investor and must not be CLOSED. With one draft the
  context suggests it; with several the choice is explicit, never implicit.
- **`investor.mandate.*`** — each handler reads the mandate fresh, replaces
  only its own constraint dimensions and updates with `expectedVersion`;
  cheques are exact `DecimalString`s with min ≤ typical ≤ max enforced;
  stages use canonical codes; taxonomy preferences are replaced atomically
  with explicit strengths (MUST/STRONG/NICE/AVOID/HARD_EXCLUSION); a node
  that is both a preference and an exclusion, an unknown node, a protected
  founder trait, or an AVOID/HARD_EXCLUSION overlap is refused (422) and the
  step rolls back.
- **`investor.portfolio` (I8)** — `core.investor_portfolio_references`
  (ADR 0007): investor-owned names, 1–5 per submission, source USER_ENTERED,
  soft-removed on resubmission. No Company rows, no lookup, no linking.
- **`investor.mandate.confirm` (I11)** — activates the DRAFT with
  `expectedVersion` under `investor.mandate.edit`. An already ACTIVE mandate
  stays active; a declined confirmation writes nothing.

Step contexts (`investor.mandates`, `investor.review`, `investor.handoff`)
are deterministic projections read back through the services under the
investor's context: labels, values and strengths only. The review is
"Here's the mandate you've defined"; the handoff reports the mandate status
and version and `recommendation: "NOT_AVAILABLE"`. Free text is reported
only as recorded, never as content. No score, no inference, no "Q
understood".

## Web

`apps/web/src/features/investor-onboarding` on the shared onboarding kit
(`apps/web/src/features/onboarding-kit`): one generic `OnboardingClient` over
a `RuntimePort`, one pure mapper (`models/journey.ts`) grouping the 35 runtime
steps into sixteen screens under four semantic sections (Context / Mandate /
Preferences / Review), typed composite responses, and a development fixture
that speaks the same session-view contract. Route: `/onboarding/investor`
(route group `(onboarding)`, session required, no organisation required).
The single `CQ_FOUNDER_ONBOARDING_ADAPTER` setting governs both journeys;
`api` uses the real runtime through server actions, `fixture` only on
non-production builds, `none` renders the unavailable surface. There is no
fallback from `api` to `fixture`.

Screen rules the components enforce: exact-string cheque ordering (no
floats); "Suggested categories" from the investor's words, confirmed by the
investor; every positive preference carries a visible strength; "I'd rather
not see" (AVOID) and "Never show me" (HARD_EXCLUSION) are separate lists
that cannot overlap; the review lists hard exclusions apart from soft
preferences; the handoff says recommendations are not available and links to
Discover's honest empty state.

## Security and privacy

Handlers re-resolve the actor from the verified principal on the transaction
executor; the session row is scope, never authority. Titles grant no
capability. Investor-private data (mandate, preferences, portfolio, free
text) is never emitted in outbox payloads, audit rows or logs (identifiers,
step keys and versions only; the integration test asserts the privacy marker
never leaks). Cross-user and cross-tenant access is enumeration-safe. The
portfolio table is RLS-guarded (member select only; writes through the
privileged server role inside the use case).

## Tests

- `packages/investor-onboarding/test/definition.test.ts` — manifest,
  mappings, migration drift.
- `packages/investor-onboarding/test/investor-onboarding.integration.test.ts`
  — I0→I12 against local PostgreSQL through the runtime with the real
  domains; retry and resume; existing organisation and spoofed context;
  titles grant nothing; ambiguous and foreign mandates refused; inverted
  cheques and protected traits refused; cross-user isolation and stale
  versions.
- `supabase/tests/database/rls/250_investor_onboarding.test.sql`.
- `apps/web/test/investor-onboarding-journey.test.ts` — mapper and client
  over the fixture runtime, including the I11/I12 copy regression.
- `tests/e2e/investor-onboarding.{desktop,mobile}.spec.ts` — the real journey
  in a browser against the API and the local database, including refresh,
  recalibration from the review (version increments), activation and a
  stale-tab conflict.

## Deferred

Recommendation and slates (CQ-DISC), GateQ evaluation and inbound
qualification (CQ-GATE-001 consumes `InvestorInboundPreference`), revenue
threshold policy, Q-generated suggestions and any model call, portfolio
enrichment, Evidence (CQ-EVD-001).
