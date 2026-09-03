# Capital module (`@capital-q/capital`)

**Purpose.** The company's canonical Capital Objective: what it is raising,
how much, in which currency, at which stage, with which instrument where
applicable, by when, for what, whether it is active, and how it ended.
Founder onboarding, Q, InvestIQ, Blueprint, recommendations, Discover, the
fundraising workspace, relationships, meetings and diligence reference this
record; none keeps its own raise fields. A raise target that exists only in
a Q conversation or an onboarding draft is not canonical until it is
promoted here.

**Invariant.** Company ≠ Capital Objective ≠ Readiness ≠ Fundraising
Progress ≠ Investment Outcome ≠ Company Stage ≠ Instrument ≠ Q Inference.
`CapitalObjectiveId` is its own branded identifier. A company survives every
raise; it may pursue many objectives over time and holds at most one ACTIVE
one.

## Schema

`core.capital_objectives`: `id`, `tenant_id`, `company_id`, `objective_type`
(`RAISE`), `status` (ACTIVE | ACHIEVED | CLOSED_BY_FOUNDER | DISCONTINUED |
REPLACED), `target_amount` (`numeric` > 0), `currency_code` (ISO alpha-3),
`target_stage` (bounded code, separate from `core.companies.current_stage_code`),
`instrument_code` (bounded code, ADR 0002), `target_close_date` (`date`),
`use_of_funds_summary` (≤ 2000), `started_at`, `closed_at`,
`created_by_user_id`, `version`, `created_at`, `updated_at`. Checks:
`(status = 'ACTIVE') = (closed_at is null)`, `closed_at >= started_at`; FK
`(company_id, tenant_id)`; UNIQUE `(id, tenant_id)`; partial UNIQUE
`(company_id) WHERE status = 'ACTIVE'`; indexes `(tenant_id, company_id)`,
`(company_id, status)`, `(company_id, created_at desc, id desc)`. No
readiness, quality, fit, confirmed or soft capital, valuation, cap-table or
outcome columns exist, by design.

`core.capital_objective_events`: `id`, `tenant_id`, `capital_objective_id`,
`event_type` (CREATED | RECALIBRATED | CLOSED | REPLACED), `occurred_at`,
`actor_type`, `actor_id`, `payload` (typed object ≤ 8 KiB); FK
`(capital_objective_id, tenant_id)`; indexes
`(capital_objective_id, occurred_at)`,
`(tenant_id, capital_objective_id, occurred_at)`. Append-only.

`core.capital_objective_creation_requests`: server-only idempotency record.

## Lifecycle

ACTIVE means "this is the company's current capital objective", not "the
founder is aggressively fundraising today". Terminal states preserve why the
objective ended; there is no FAILED or COMPLETED. Closing below target as
CLOSED_BY_FOUNDER is a commercial decision and is never relabelled. Server
time sets `started_at` and `closed_at`; browser timestamps are not accepted.
The target close date is a planning date: passing it closes nothing, marks
nobody behind and affects no ranking.

## Recalibration vs replacement

Recalibration (`PATCH`) adjusts the ACTIVE objective in place: same id,
`version + 1`, a RECALIBRATED history row with previous and next canonical
values, audit and event with change categories. Any parameter may change;
no edit, however large, silently creates a new objective. Replacement
(`POST .../replace`) is the explicit command for a genuinely new objective:
the old row becomes REPLACED (server-time `closed_at`, REPLACED history
naming the replacement), a new ACTIVE row with a new id is created with a
CREATED history row naming the replaced objective, all in one transaction.
Terminal objectives refuse PATCH, close and replace with `RESOURCE_CONFLICT`.
There is no delete route.

## Money, stage, instrument, use of funds

Target = exact decimal string + currency code (`CapitalTarget`), persisted as
`numeric` and read back as text; no floating point anywhere. `target_stage`
is the objective's own stage language and never writes the company's stage.
`instrument_code` (SAFE, priced equity, convertible …) is a separate
dimension from both stage and `objective_type`; CQ-TAX-001/002 supply the
vocabularies. `use_of_funds_summary` is bounded founder-provided context: not
evidence, not verified, not a budget, and never emitted.

## History vs audit vs outbox

| Store                           | Answers                                | Contains                                                   |
| ------------------------------- | -------------------------------------- | ---------------------------------------------------------- |
| `core.capital_objective_events` | how did the goal evolve?               | bounded typed previous/next values, reason, replacement id |
| `audit.material_actions`        | who acted under whose authority, when? | ids, changed field names, change kinds, versions, reason   |
| `events.outbox`                 | what should other systems react to?    | ids, version, change kinds, closure reason, replacement id |

None of them is analytics and none is Q memory. Only the canonical row and
its private history carry values.

## Capabilities

| Capability                 | `organisation_admin` | `organisation_member` |
| -------------------------- | -------------------- | --------------------- |
| `capital_objective.create` | yes                  | no                    |
| `capital_objective.view`   | yes                  | yes                   |
| `capital_objective.edit`   | yes                  | no                    |
| `capital_objective.close`  | yes                  | no                    |

Create is authorised on the `company` resource; view, edit and close on the
exact `capital_objective` resource; replace requires close and create. Being
a founder, a company member or a CEO grants nothing; a revoked organisation
membership removes access regardless of company-member rows.

## Routes

`POST /v1/companies/:companyId/capital-objectives` (Idempotency-Key;
RESOURCE_CONFLICT when an ACTIVE objective exists), `GET .../current`, `GET
.../:capitalObjectiveId`, `GET ...` (cursor, latest first, history
included), `PATCH .../:capitalObjectiveId` (`expectedVersion`), `POST
.../:capitalObjectiveId/close` (`reason`, `expectedVersion`), `POST
.../:capitalObjectiveId/replace` (`expectedVersion`, `replacement`).

## Events and audit

`core.capital_objective.created@1 { capitalObjectiveId, companyId, version }`,
`.updated@1 { …, changedFields, changeKinds ⊂ TARGET_AMOUNT | CURRENCY |
TARGET_STAGE | INSTRUMENT | TIMELINE | USE_OF_FUNDS }`, `.closed@1 { …,
closureReason, replacementCapitalObjectiveId? }`; CONFIDENTIAL, REPLAY_SAFE,
through the outbox in the mutation's transaction. Audit
`capital_objective.created / updated / closed / replaced`. No target amount,
timeline or use-of-funds text reaches events, audit or logs.

## RLS

`core.capital_objectives` and `core.capital_objective_events` are
`RLS_REQUIRED`: SELECT for active members of the organisation that owns the
company; no client writes. Other tenants, anonymous callers and revoked
members see nothing.

## Future integration

Q tools, InvestIQ, Blueprint, onboarding (CQ-ONB-002 connects F6) and
recommendations consume `CapitalObjectiveQueryPort.getCurrentForCompany /
getById` -- structured first, before any document retrieval -- receiving the
goal without the use-of-funds narrative. Discover and the Q Card consume a
later disclosure-safe projection (CQ-PERM-001), never this DTO. Matching an
objective against investor mandates is the Recommendation domain's work.

## Deferred

Blueprint, InvestIQ, relationships and pipeline (CQ-NET-001), confirmed and
soft commitments, raise progress, investment outcomes, valuation and term
sheets, cap table, Data Room, Q reasoning, recommendation matching, public
raise disclosure, onboarding wiring, UI.
