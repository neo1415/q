# Organisations module (`@capital-q/organisations`)

**Purpose.** The institutional capacity a Person acts in. A workspace is
created by an authenticated Person, who becomes its first member and
administrator; members list their organisations, select the one they are
acting for, and administer the profile within real capabilities.

**Invariant.** Person ≠ Organisation ≠ Membership ≠ Tenant ≠ Title ≠ Role ≠
Capability. `organisation_type` describes and never grants. A membership
supplies context; capabilities supply authority. There is no first-membership
fallback anywhere.

## Owned state (CQ-DATA-002 tables, operated here)

`identity.tenants`, `identity.organisations` (+ `version`),
`identity.tenant_organisations`, `identity.organisation_memberships`,
`identity.membership_roles`, `identity.user_active_contexts`,
`identity.organisation_creation_requests` (server-only idempotency record).
Not owned: `identity.user_profiles`, `auth.users`, the permission engine.

## Public contracts

HTTP (`@capital-q/contracts`): `CreateOrganisationRequest`,
`UpdateOrganisationRequest` (with `expectedVersion`), `OrganisationDto`,
`OrganisationMembershipSummary`, cursor list response, `Idempotency-Key`.
Strict schemas: authority fields (`tenantId`, `roleId`, `membershipId`,
`capabilities`, `isAdmin`, `verified`, `status`) fail validation.

Query port for later domains: `OrganisationQueryPort.getActiveOrganisationIdentity(tenantId, organisationId)`.
Company and Investor Organisation anchor to an organisation through this;
they never touch organisation rows.

## Application use cases

| Use case               | Scope                       | Authority                                           |
| ---------------------- | --------------------------- | --------------------------------------------------- |
| `createOrganisation`   | Person (no context)         | verified session + Person record; `Idempotency-Key` |
| `listMyOrganisations`  | Person                      | session → UserId → active memberships               |
| `getOrganisation`      | active organisation context | `organisation.view` on `ORGANISATION` scope         |
| `updateOrganisation`   | active organisation context | `organisation.admin`; optimistic `expectedVersion`  |
| `activateOrganisation` | Person                      | active membership in target, validated by the store |

Creation is one transaction: Person → idempotency lock/lookup → tenant →
organisation → tenant link → membership → `organisation_admin` assignment
(looked up by code) → active context → audit → events → idempotency record.
Retry with the same key and request returns the same organisation; a different
request under the same key is `IDEMPOTENCY_CONFLICT`.

Activation persists the membership through the existing
`ActiveOrganisationContextStore`, then re-resolves the ActorContext from rows
so tenant, membership and capabilities are re-evaluated. Future hooks at the
same boundary (not simulated today): Q knowledge scope, active
company/investor, connector availability, data-use policy.

## Events (owner `@capital-q/organisations`, INTERNAL, REPLAY_SAFE, tenant-owned)

- `identity.organisation.created@1` `{ organisationId, organisationType }`
- `identity.organisation.updated@1` `{ organisationId, version, changedFields }`
- `identity.membership.created@1` `{ membershipId, organisationId, userId, membershipStatus }`

All through `OutboxWriter` in the mutating transaction. Reads and context
switches emit no domain event.

## Audit

Material actions `organisation.created` and `organisation.updated`
(`changedFields`, `previousVersion`, `newVersion`). Security event
`organisation_context_changed` on activation (INFO).

## Capabilities and roles

`organisation.view`, `organisation.admin`. Templates: `organisation_admin` →
view + admin; `organisation_member` → view. Reference data is installed by the
CQ-ORG-001 migration (production) and mirrored in the local seed. No further
matrix.

## Security boundaries

Cross-tenant/IDOR: a request for any organisation other than the resolved
active context is `RESOURCE_NOT_FOUND` before authorization. Client-supplied
tenant, role, membership or capability is rejected by the contract. Revoked
memberships neither list nor activate nor resolve. RLS: the idempotency table
is `INTERNAL_SERVER_ONLY`; existing identity policies unchanged.

## Deferred

Invitations and member administration, organisation claiming/verification,
enterprise roles/SSO/SCIM, Company (CQ-COMP-001), Investor Organisation
(CQ-INV-001), Investor Mandate (CQ-INV-002), Capital Objective (CQ-CAP-001),
organisation UI.
