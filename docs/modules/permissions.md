# Permissions module (`@capital-q/permissions`)

**Purpose.** The deterministic disclosure layer: one answer to "may this
information be disclosed to this recipient, in this context, at this access
level, under which active grant, until when?" Consumed by API reads now and
by the Q Context Firewall, permission-aware retrieval, Data Room and public
projections later. One implementation for all of them; no model, no cache.

**Invariants.** Authentication ≠ Authorization ≠ Disclosure ≠ Sensitivity ≠
Verification ≠ Data-use policy. Q knows ≠ user may know ≠ user may share ≠
Q may execute. `DisclosureScope` (who may see) and `SensitivityClass`
(how damaging is exposure) are distinct types; neither is inferred from the
other.

## Authorization vs disclosure

Authorization (`@capital-q/security`) answers "may this actor perform this
capability on this resource?". Disclosure answers "may this information be
revealed to this principal?". Holding `company.view` does not make
founder-private Q intelligence readable; being a share recipient grants no
capability. `createProtectedDisclosureGuard` composes the two: authorization
DENY → DENY (disclosure not consulted); disclosure DENY → DENY;
REQUIRES_VERIFICATION / STEP_UP / APPROVAL are preserved, never flattened by
a disclosure ALLOW.

## Canonical scopes (ADR-001) and their semantics

| scope                  | who satisfies it                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `personal_private`     | the owning Person only; a colleague is not enough                                                                     |
| `organisation_private` | active members of the owning organisation                                                                             |
| `founder_private`      | the company-side owning organisation (or owning Person); never an investor counterparty because a relationship exists |
| `investor_private`     | the investor-side owning organisation; never a founder counterparty because a relationship exists                     |
| `relationship_shared`  | the two exact canonical parties of one named relationship, each in its own tenant                                     |
| `specifically_shared`  | the explicit recipient: USER, MEMBERSHIP, ORGANISATION or RELATIONSHIP                                                |
| `network_visible`      | any authenticated human Capital Q context; never anonymous                                                            |
| `public_external`      | anyone, including anonymous; a projection still decides how                                                           |

Scopes are predicates, not a ladder. `public`, `owner_private`, `private`
and `shared` do not exist. Non-human principals (Q, SYSTEM,
CONNECTED_SYSTEM) are denied outright: zero ambient authority. Database
privilege is never permission: the evaluator does not know which role ran
the query.

## Intrinsic scope vs explicit policy

Resolvers read each resource's own classification through the owning
domain's query port: `core.companies.marketplace_visibility`,
`core.founder_profiles.visibility_scope`,
`network.relationship_events.visibility_scope`; investor organisations and
mandates are investor-private, capital objectives founder-private, by
classification. A relationship has **no** intrinsic scope: its existence is
not disclosure. None of these values is copied into the policy table.
`permissions.disclosure_policies` adds deliberate access on top: specific
shares, relationship shares, network/public visibility for resources without
a classification. Unknown scope with no policy = DENY. Access is the union
of the paths that hold, so revoking one share never removes what another
path still grants, and the owner keeps access through the intrinsic path.
Intrinsic private/owner paths grant `view_download`; intrinsic network and
public visibility grant `view` only.

## Access levels

`view` and `view_download`, ordered explicitly (`view_download` satisfies
`view`; `view` never satisfies a download). `edit`, `share`, `approve` are
capabilities. `view` is a platform access policy, not DRM: it does not
prevent screenshots, copying or transcription and nothing claims it does.

## Ownership (ADR 0004)

`owner_organisation_id` and `owner_user_id` (nullable; at least one;
`personal_private` requires the Person) are resolved server-side from the
canonical resource. A bilateral resource is administered by each canonical
party against its own organisation and tenant. No command carries an owner.

## Policy lifecycle

Active = `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now)`
with the injected clock. No in-place edit of scope, recipient, access or
expiry: change = revoke + new policy. Revocation is a timestamp; nothing is
deleted; expired ≠ revoked in history. Same `DisclosurePolicyId` + same
canonical policy is idempotent; same id + different policy is
`DisclosurePolicyConflictError`. A semantically identical active grant is
returned as `EXISTING`; the database backstop is an exclusion constraint
over `tstzrange(created_at, expires_at)` where `revoked_at IS NULL`, so an
expired-but-unrevoked row never blocks a replacement. Grant-to-owner is
`REDUNDANT` (no row).

## Authority to share and inspect

`disclosure.manage` (grant / revoke) and `disclosure.inspect` ("who can see
this?"), mapped to `organisation_admin`, evaluated on the exact owning
resource scope. Founder status, business titles (CEO, Partner), being able
to view, and being a recipient grant nothing. No generic ACL UI or
`/v1/disclosure` API exists; product workflows expose domain-safe commands.

## Events, audit, side effects

`permissions.disclosure.granted@1` / `permissions.disclosure.revoked@1`
(CONFIDENTIAL, identifiers only) through the outbox, and audit
`disclosure.granted` / `disclosure.revoked` (references only), in the same
transaction as the policy row. Granting sends nothing: no email, link,
notification or model call. Sharing never copies or moves the resource.

## Raw table

`permissions.disclosure_policies` is `INTERNAL_SERVER_ONLY`: RLS enabled,
no policies, no `anon` / `authenticated` / `service_role` grant. The ACL
reveals private relationships and sharing patterns.

## Q and the Context Firewall

This module is the deterministic predicate the Context Firewall will apply
**before** any model sees context (filter first; output checks are a second
layer). Not implemented here: Q delegation envelopes, sensitivity
inheritance, combination risk, data-use policy, verification gating,
recommendation feature filtering, Data Room, signed URLs, caching.
Founder-private sources must never become investor-facing recommendation
features without a legitimate disclosure / data-use path; CQ-REC packets
reuse this contract.
