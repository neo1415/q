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

## Deferred

Investment funds, declared mandate (cheque, stage, sector, geography, green
and red flags, hard exclusions, discovery mode -- CQ-INV-002), portfolio
context, GateQ rule sets, observed behaviour, Q inference, company
recommendations, network discoverability and the public investor profile
(CQ-PERM-001), investor onboarding UI (CQ-ONB-003), representative invitation
and administration, organisation affiliation and domain verification.
