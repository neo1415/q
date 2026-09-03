# Investors module (`@capital-q/investors`)

**Purpose.** The one canonical Investor Organisation per represented capital
provider -- VC, family office, CVC, syndicate, accelerator, scout,
institution or a solo angel's own investing workspace. Investor onboarding,
the mandate, discovery, recommendations, GateQ, company ↔ investor
relationships, meetings, diligence and Q all reference this record; none
creates another investor truth. Five partners of one fund are one investor
organisation, five persons, five memberships and up to five representative
rows.

**Invariant.** Person ≠ Organisation ≠ Organisation Membership ≠ Investor
Organisation ≠ Investor Representative ≠ Investment Fund ≠ Mandate ≠
Authority. `InvestorOrganisationId` and `InvestorRepresentativeId` are their
own branded identifiers; neither is ever an `OrganisationId`, `UserId` or
`MembershipId`.

## Organisation relationship

`identity.organisations` remains the primary institutional identity (legal
name, workspace name, canonical website, country). `core.investor_organisations`
is that organisation's investing profile, linked by `organisation_id` with
`UNIQUE (organisation_id)` and `FOREIGN KEY (organisation_id, tenant_id)`. An
`organisation_type` of `investment_firm` does not create an investor
organisation; the investor domain establishes it explicitly. Profile fields
default from the organisation at creation and never flow back.

## Schema

`core.investor_organisations`: `id`, `tenant_id`, `organisation_id` (unique),
`investor_type` (bounded text: ANGEL | VC | FAMILY_OFFICE | CVC | SYNDICATE |
ACCELERATOR | SCOUT | INSTITUTIONAL | OTHER), `display_name`, `website_url`,
`hq_country` (ISO alpha-2; headquarters context, not mandate geography),
`public_description` (≤ 4000; organisation-private until CQ-PERM-001, not a
thesis), `verification_state` (bounded text, default `unverified`, owned by
the future verification subsystem, never writable through PATCH),
`deployment_state` (NULL = unknown | ACTIVELY_INVESTING | SELECTIVE | PAUSED |
EXPLORING_ONLY), `version`, `created_at`, `updated_at`. Also
`UNIQUE (id, tenant_id)` and `UNIQUE (id, organisation_id, tenant_id)`.
Indexes: `(tenant_id, deployment_state)`, `(investor_type)`; the unique on
`organisation_id` serves "investor for the active organisation".

`core.investor_representatives`: `id`, `tenant_id`, `investor_organisation_id`,
`organisation_id` (denormalised for relational coherence), `user_id`
(`identity.user_profiles`, never `auth.users`), `membership_id`,
`business_title` (presentation only), `is_current`, `started_at`, `ended_at`,
`version`, timestamps. `FOREIGN KEY (investor_organisation_id, organisation_id,
tenant_id)` → investor organisations and `FOREIGN KEY (membership_id, user_id,
organisation_id, tenant_id)` → `identity.organisation_memberships` (new
additive `UNIQUE (id, user_id, organisation_id, tenant_id)`), so
`Representative.user_id = Membership.user_id`, `Membership.organisation_id =
InvestorOrganisation.organisation_id` and the tenant agree by construction.
Partial `UNIQUE (investor_organisation_id, user_id) WHERE is_current`; history
rows remain. Indexes: `(tenant_id, investor_organisation_id)`,
`(investor_organisation_id, user_id)`, `(membership_id)`.

`core.investor_creation_requests`: server-only idempotency record
(person, organisation, key hash → investor organisation).

`core.investment_funds`: **deferred**. Nothing in the repository depends on a
fund vehicle yet; CQ-INV-002 (or a focused vehicle slice) owns it.

## Deployment state

The organisation's current availability to deploy capital (onboarding I1).
Unknown stays unknown: NULL is never read as paused or active. It is not a
mandate status (a mandate may be ACTIVE while the organisation is SELECTIVE),
not GateQ inbound policy (ACTIVELY_INVESTING does not open GateQ; PAUSED does
not close it) and never a reputation, responsiveness or quality score. Future
recommendation logic may use PAUSED as an availability constraint only.

## Representatives

A representative row records that a Person represents or participates in
the investor organisation in the capacity of a real organisation membership.
It grants nothing: no `investor.edit`, no mandate authority, no Q action
approval. A business title is never evaluated for permission. When the
organisation membership is revoked the ActorContext disappears and the RLS
policy (own row AND active organisation member) stops matching, while the
row remains as history. Only the caller's own representation is reachable
(`/representatives/me`); there is no arbitrary representative management
and no representative directory.

## Capabilities and roles

| Capability                          | `organisation_admin` | `organisation_member` |
| ----------------------------------- | -------------------- | --------------------- |
| `investor.create`                   | yes                  | no                    |
| `investor.view`                     | yes                  | yes                   |
| `investor.edit`                     | yes                  | no                    |
| `investor.representative.self_edit` | yes                  | yes                   |

Installed by the CQ-INV-001 migration and mirrored in the seed. Scope:
`investor.create` on the ORGANISATION; the rest on the exact
`investor_organisation` RESOURCE.

## Use cases and routes

| Route                                      | Use case                         | Rule                                                                  |
| ------------------------------------------ | -------------------------------- | --------------------------------------------------------------------- |
| `POST /v1/investors` (Idempotency-Key)     | `createInvestorOrganisation`     | org active via `OrganisationQueryPort`; one per organisation          |
| `GET /v1/investors/current`                | `getCurrentInvestorOrganisation` | investor of the active organisation, else enumeration-safe 404        |
| `GET /v1/investors/:id`                    | `getInvestorOrganisation`        | same tenant + active organisation, then `investor.view`               |
| `PATCH /v1/investors/:id`                  | `updateInvestorOrganisation`     | `investor.edit`; optimistic `expectedVersion`; no verification field  |
| `GET /v1/investors/:id/representatives/me` | `getMyInvestorRepresentative`    | `investor.view`; caller only                                          |
| `PUT /v1/investors/:id/representatives/me` | `upsertMyInvestorRepresentative` | `investor.representative.self_edit`; user/membership from the context |

Creation is one transaction: idempotency lock/lookup → per-organisation
advisory lock → "already established?" → investor row (defaults from the
organisation) → creator's representative row → audit → events → idempotency
record. A second create under the same organisation answers
`RESOURCE_CONFLICT`; a retry with the same key and payload returns the same
row; the same key with a different payload answers `IDEMPOTENCY_CONFLICT`.

## Events and audit

`core.investor_organisation.created@1 { investorOrganisationId, organisationId,
investorType, version }`, `core.investor_organisation.updated@1
{ investorOrganisationId, version, changedFields }`,
`core.investor_representative.created@1 { investorRepresentativeId,
investorOrganisationId, userId, membershipId }`,
`core.investor_representative.updated@1 { investorRepresentativeId,
investorOrganisationId, version, changedFields }`. Owner
`@capital-q/investors`, INTERNAL, REPLAY_SAFE, through `OutboxWriter` in the
same transaction. Audit: `investor_organisation.created/updated`,
`investor_representative.created/updated` -- identifiers, changed field
names and versions only; `public_description` never reaches events, audit or
logs.

## RLS

`core.investor_organisations` is `RLS_REQUIRED`: SELECT for authenticated
current members of the underlying organisation, no client writes.
`core.investor_representatives` is `RLS_REQUIRED`: a person reads their own
representation only while an active member. `core.investor_creation_requests`
is `INTERNAL_SERVER_ONLY`. Anonymous, other tenants, revoked members and a
representative row without a membership see nothing.

## Q

Future Q and recommendation modules import `InvestorOrganisationQueryPort`
(`getCanonicalInvestorOrganisation(tenantId, investorOrganisationId)`), never
the Postgres repositories. No LLM is involved anywhere in this domain.

## Declared mandate (CQ-INV-002)

**Invariant.** InvestorOrganisation ≠ InvestorMandate ≠ Observed Behaviour ≠
Q Inference ≠ GateQ Rule ≠ Recommendation. A mandate is what the investor
organisation explicitly says it is looking for. Nothing in this package
changes a mandate because someone watched, opened, saved, passed or asked Q;
Q may later _propose_ a change, a human command applies it. GateQ
(OPEN/QUALIFIED/CLOSED) and deployment state live elsewhere. One investor
organisation may hold several mandates (no `UNIQUE(investor_organisation_id)`);
callers name the `mandateId` explicitly.

**Schema.** `core.investor_mandates`: `id`, `tenant_id`,
`investor_organisation_id`, `name`, `status` (DRAFT | ACTIVE | CLOSED),
`effective_from`, `effective_to`, `discovery_mode` (STRICT | BALANCED |
EXPLORATORY | NULL), `min_cheque` / `max_cheque` (`numeric`, ≥ 0, min ≤ max,
currency required when set), `currency_code`, `min_stage_code` /
`max_stage_code` (bounded), `raw_mandate_text` (≤ 8192, investor-private),
`created_by_user_id`, `version`, `created_at`, `updated_at`; FK
`(investor_organisation_id, tenant_id)`; indexes
`(investor_organisation_id, status)`, `(tenant_id, investor_organisation_id)`,
`(investor_organisation_id, created_at desc, id desc)`.
`core.investor_mandate_constraints`: `id`, `tenant_id`, `mandate_id`,
`dimension`, `operator`, `value_jsonb` (typed object ≤ 8 KiB), `importance`,
`is_hard_exclusion`, `created_at`; FK `(mandate_id, tenant_id)`; check
`(importance = 'HARD_EXCLUSION') = is_hard_exclusion`; indexes
`(mandate_id, dimension)`, `(mandate_id, is_hard_exclusion)`. No JSONB GIN
until a query pattern justifies it. `core.investor_mandate_creation_requests`
is the server-only idempotency record.

**Version and history.** One stable row per mandate, monotonic `version`
incremented on every material mutation, lifecycle timestamps set with server
time, append-only audit, version carried in every event. Immutable
row-per-revision lineage (doc 13 "close the previous effective version and
create a new one") is deferred: no lineage pattern exists yet to reuse, and
no `mandate_series_id` or `revision_parent_id` was invented.

**Constraint model.** Constraints are data. Dimension and operator are
closed enums, values are one of three typed shapes (`codes`, `amount`,
`text`), and an Investor-owned registry pins, per dimension: allowed
operators, value schema, allowed importance classes and `automatedUse`.

| Dimension                    | Operators        | Value                                     | Automated use |
| ---------------------------- | ---------------- | ----------------------------------------- | ------------- |
| `stage`                      | EQ NEQ IN NOT_IN | bounded stage codes                       | ELIGIBLE      |
| `geography.country`          | EQ NEQ IN NOT_IN | ISO alpha-2 codes                         | ELIGIBLE      |
| `sector`                     | EQ NEQ IN NOT_IN | declared codes (not taxonomy)             | ELIGIBLE      |
| `business.attribute`         | EQ NEQ IN NOT_IN | approved allowlist                        | ELIGIBLE      |
| `founder.business_attribute` | EQ NEQ IN NOT_IN | approved allowlist                        | ELIGIBLE      |
| `green_flag`                 | EQ IN            | approved allowlist; MUST/STRONG/NICE only | ELIGIBLE      |
| `red_flag`                   | EQ IN            | declared codes; AVOID/HARD_EXCLUSION only | ELIGIBLE      |
| `investment_role`            | EQ IN            | lead, co_invest, follow                   | ELIGIBLE      |
| `cheque.typical`             | EQ (derived)     | exact amount + currency                   | ELIGIBLE      |
| `custom.text`                | EQ               | bounded prose (≤ 1000)                    | MANUAL_ONLY   |

Bounds: 100 constraints per mandate, 50 codes per list. GTE/LTE/BETWEEN are
reserved for a future numeric dimension. `custom.text` is stored for humans
and never becomes an automated rule until a later classification/taxonomy/
policy step and explicit confirmation. Protected or sensitive personal
characteristics cannot be expressed: the allowlist has no such dimension.

**Preference classes.** MUST (strong positive requirement/preference),
STRONG (substantial positive influence), NICE (moderate positive), NEUTRAL
(explicit indifference), AVOID (soft negative; the candidate may still
appear), HARD_EXCLUSION (ineligible in standard discovery). MUST is not
HARD_EXCLUSION; AVOID is never promoted silently. No ranking weight is
defined here; the Recommendation domain owns weighting and eligibility
semantics.

**Discovery modes.** STRICT stays close to the explicit mandate; BALANCED
surfaces justified adjacent opportunities; EXPLORATORY surfaces justified
outside-thesis opportunities that future explanations must justify. No mode
bypasses a hard exclusion and no mode maps to GateQ.

**Cheque.** `min`, `max`, `currency` on the row; `typical` as a derived
`cheque.typical` constraint; validation `min ≤ typical ≤ max` with an
exact BigInt comparator (`compareDecimalStrings`), never floating point.
Unknown stays absent, never zero.

**Taxonomy seam.** Stage and sector codes are bounded declared codes,
geography is explicit ISO countries, regions are not modelled. CQ-TAX-001
supplies vocabularies; CQ-TAX-002 promotes declared codes to
`TaxonomyNodeId` inside `value_jsonb` without touching mandate or investor
identity.

**Capabilities.** `investor.mandate.create` (admin), `investor.mandate.view`
(admin, member), `investor.mandate.edit` (admin). Create is authorised on the
`investor_organisation` resource; view/edit on the exact `investor_mandate`
resource. A representative row or a "Partner" title grants nothing.

**Routes.** `POST /v1/investors/:id/mandates` (Idempotency-Key; creates
DRAFT v1), `GET .../mandates` (cursor, optional `status`), `GET|PATCH
.../mandates/:mandateId` (PATCH with `expectedVersion`; `constraints` replaces
the whole editable set atomically, `chequeRange` replaces the envelope),
`POST .../mandates/:mandateId/activate` (DRAFT → ACTIVE, `effective_from` =
server time), `POST .../mandates/:mandateId/close` (→ CLOSED, `effective_to` =
server time). No delete. A CLOSED mandate refuses edits and transitions
(`RESOURCE_CONFLICT`).

**Events and audit.** `core.investor_mandate.created@1`, `.updated@1`
(`changedFields`, `changeKinds` ⊂ NAME | CHEQUE | STAGE | GEOGRAPHY |
PREFERENCE | HARD_EXCLUSION | DISCOVERY_MODE | RAW_TEXT), `.activated@1`
(`effectiveFrom`), `.closed@1` (`effectiveTo`); CONFIDENTIAL, REPLAY_SAFE,
through the outbox in the mutation's transaction. Audit
`investor_mandate.created/updated/activated/closed` with field names,
change kinds and versions only. Raw text, cheque figures, constraint values
and hard-exclusion contents never reach events, audit or logs; a future
recommendation consumer sees "HARD_EXCLUSION changed" and re-reads the
mandate through `InvestorMandateQueryPort` under its own authority.

**RLS.** Both tables `RLS_REQUIRED`: SELECT for active members of the
organisation behind the investor organisation; no client writes. Other
tenants, anonymous callers and revoked members (even with a current
representative row) see nothing.

**Future integration.** Recommendation, onboarding (CQ-ONB-003: create draft,
save selections, store narrative, activate) and Q consume
`InvestorMandateQueryPort.getMandate` / `listActiveMandates`: typed policy
plus each constraint's `automatedUse`, deterministic for (mandateId,
version), without raw text. Mandates are recommendation inputs, not global
search filters.

## Deferred

Investment funds, portfolio context, GateQ rule sets, observed behaviour and
`analytics.investor_behavior_features`, Q inference and Q mandate
extraction/synthesis, taxonomy mapping, company recommendations and ranking
weights, network discoverability and the founder-facing investor/mandate
projection (CQ-PERM-001), investor onboarding UI (CQ-ONB-003), representative
invitation and administration, organisation affiliation and domain
verification, immutable mandate revision lineage.
