# Companies module (`@capital-q/companies`)

**Purpose.** The one canonical Company per represented business. Founder
onboarding, evidence, Q, the capital objective, discovery, GateQ and the Q Card
all reference this record; none creates another company truth.

**Invariant.** Company ≠ Organisation ≠ Person ≠ Capital Objective ≠ Score.
`CompanyId` is its own branded identifier; a company belongs to an
organisation (`organisation_id`) inside a tenant (`tenant_id`), enforced
relationally by `FOREIGN KEY (organisation_id, tenant_id)`.

## Schema (`core.companies`)

`id`, `tenant_id`, `organisation_id`, `canonical_name`, `legal_name`, `slug`
(tenant-unique, stable after creation), `website_url`, `founded_date` (date),
`headquarters_country` (ISO alpha-2), `headquarters_city`, `company_status`
(`active|closed`, default `active`), `marketplace_visibility` (ADR-001 scopes,
default `organisation_private`), `marketplace_readiness_state` (bounded text,
default `not_assessed` = not marketplace eligible), `primary_description`
(≤8000), `short_description` (≤400), `logo_storage_key` (storage key, never a
URL), `current_stage_code` (bounded lower_snake text, no enum; CQ-TAX-001
supplies the vocabulary), `version`, `created_at`, `updated_at`. Indexes:
`(organisation_id)`, `(tenant_id, organisation_id)`,
`(marketplace_visibility, current_stage_code)`. No global uniqueness on name,
legal name or website; no `UNIQUE(organisation_id)`.

`core.company_creation_requests`: server-only idempotency record
(person, organisation, key hash → company).

## Public contracts

Wire (`@capital-q/contracts`): `CreateCompanyRequest`, `UpdateCompanyRequest`
(`expectedVersion`), `CompanyDto` (visibility/readiness read-only). Server
(`@capital-q/companies/contracts`): `CompanyId`, `Company`, `CompanyIdentity`.
Query port for later domains: `CompanyQueryPort.getCanonicalCompany(tenantId, companyId)`.

## Use cases and authority

| Use case        | Context                  | Capability / scope                                                           |
| --------------- | ------------------------ | ---------------------------------------------------------------------------- |
| `createCompany` | active organisation      | `company.create` on `ORGANISATION`; org active via `OrganisationQueryPort`   |
| `getCompany`    | same tenant/organisation | `company.view` on the exact `company` RESOURCE                               |
| `updateCompany` | same tenant/organisation | `company.edit` on the exact `company` RESOURCE; optimistic `expectedVersion` |

Role templates: `organisation_admin` → create, view, edit; `organisation_member`
→ view. Installed by the CQ-COMP-001 migration and mirrored in the seed.

Creation is one transaction: idempotency lock/lookup → bounded slug allocation
(`base`, `base-2` … `base-20`) → row → audit `company.created` →
`core.company.created` → idempotency record. Update: lock → version check →
profile write (`version + 1`) → audit `company.updated` →
`core.company.updated`. Status, visibility, readiness, slug and logo key are not
reachable from PATCH.

## Events

`core.company.created@1 { companyId, organisationId, version }`,
`core.company.updated@1 { companyId, version, changedFields }`; owner
`@capital-q/companies`, INTERNAL, REPLAY_SAFE, aggregate `company`.

## RLS

`core.companies` is `RLS_REQUIRED`: SELECT for authenticated members of the
owning organisation (`private.is_organisation_member`), no client writes.
Anonymous, other tenants and revoked members see nothing. A new company is not
investor-discoverable through this packet.

## Founder / team (CQ-COMP-002)

Three further tables, still inside this context:

- `core.company_members` -- Person ↔ Company relationship: `relationship_type`
  (team_member | advisor | board_member | contractor | other), `business_title`
  (presentation only), `is_founder` (self-asserted representation, never a
  role), `is_current` / `started_at` / `ended_at` (history kept; one current
  row per company + person), `version`. Readable by members of the owning
  organisation; never authorisation: a revoked organisation membership removes
  access while the row remains history.
- `core.founder_profiles` -- one per tenant + person; `primary_company_id`
  is set on first creation and never moved by profile edits;
  `professional_summary` / `background_summary` (≤ 4000, deliberately
  supplied, never Q text); `visibility_scope` defaults to `founder_private` and
  has no write path here. RLS: a person reads only their own profile.
- `core.company_team_facts` -- self-reported `founder_count`,
  `full_time_founder_count`, `team_size` (null = unknown, never zero; cross
  checks when both present), one row per company, versioned. No fake persons
  are created for unregistered cofounders.

Capabilities: `company.team.view`, `company.team.self_edit`,
`company.team.manage`; admin → all three, member → view + self_edit.
Self-edit never changes roles, capabilities or organisation membership.

Routes: `GET/PUT …/team/me` (caller only; PUT is idempotent desired state; a
new period is opened after an ended one), `GET/PATCH …/founder-profile/me`
(current founder relationship required; first PATCH creates without
`expectedVersion`), `GET/PATCH …/team-facts` (view / manage).

Events: `core.company_member.created@1`, `core.company_member.updated@1`,
`core.company_team.updated@1` (INTERNAL); `core.founder_profile.created@1`,
`core.founder_profile.updated@1` (CONFIDENTIAL). Payloads carry identifiers,
versions and changed field names only -- profile text is never on the bus or
in audit metadata. Audit: `company_member.created/updated`,
`founder_profile.created/updated`, `company_team.updated`.

## Visibility & Discovery (CQ-PRE-REC-001 §31-§36)

Who may see the declared profile is an intentional choice by an editor of
the company, never a side effect of finishing onboarding, of a document
being processed or of anything Q read.

- `setCompanyVisibility` (`POST /v1/companies/:id/visibility`) moves
  `marketplace_visibility` between `organisation_private` and
  `network_visible` — the only two choices a founder has. It requires
  `company.edit` on the exact company, locks the row, checks the expected
  version, records `company.visibility_changed` in the audit trail and
  emits `core.company.visibility_changed` (identifiers, version and the
  new visibility only). Public exposure and relationship-specific sharing
  are not profile switches: the first is not a V1 rule, the second is the
  Data Room's grant.
- `projectCompanyForNetwork` is the one projection a viewer across the
  network gets. Q's `company.get` tool serves it to an investor and
  `GET /v1/companies/:id/network-preview` returns it to the founder as
  "what investors will see", so the preview cannot drift from the answer
  and nothing founder-private can appear in either: the projection reads
  only the declared profile fields.
- Marketplace readiness is untouched by visibility and is not assessed by
  anything here. The web surface (`/company/visibility`) says so plainly
  rather than inventing an eligibility.

Invitations and member administration, founder claims/credential evidence,
public founder presentation, business models,
metrics, milestones, taxonomy assignments (CQ-TAX-001), capital objective
(CQ-CAP-001), evidence and verification, marketplace activation
(CQ-PERM-001 / readiness), discovery projection, recommendations, Q. Future
onboarding (CQ-ONB-002) creates and enriches this record; no temporary company
model exists to migrate from.
