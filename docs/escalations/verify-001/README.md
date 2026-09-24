# CQ-VERIFY-001 escalations (lead-owned files)

Worker V1 does not edit `supabase/**` or `packages/contracts/**`. The exact
content for each lead-owned file is here, ready to land verbatim.

## 1. Migration — `supabase/migrations/20261007090000_verification_claims.sql`

File: `20261007090000_verification_claims.sql` in this directory. Creates
`evidence.verification_claims` (append-only, RLS on, no policy, no browser
grant), its indexes, the immutability trigger, and the three capabilities
(`verification.request`, `verification.view` granted to both organisation
roles; `verification.decide` granted to no role).

## 2. Seed mirror — `supabase/seed.sql`

Add to the `permissions.capabilities` insert:

```sql
  ('verification.request',     'Ask Capital Q to verify a founder''s identity and the organisation, for the active organisation''s company.'),
  ('verification.view',        'Read the verification standings of the active organisation and its members.'),
  ('verification.decide',      'Decide a verification claim on Capital Q''s behalf. Operator only; granted to no organisation role.')
```

Add to the `permissions.role_capabilities` select:

```sql
      ('organisation_admin',  'verification.request'),
      ('organisation_admin',  'verification.view'),
      ('organisation_member', 'verification.request'),
      ('organisation_member', 'verification.view')
```

## 3. Contract — `packages/contracts/src/http/verification.ts`

File: `contracts-http-verification.ts` in this directory (imports are
written for its intended location). Re-export everything from
`packages/contracts/src/http/index.ts`:

```ts
export {
  COMPANY_VERIFICATION_CLAIM_TYPES,
  COMPANY_VERIFICATION_REQUESTS_SEGMENT,
  COMPANY_VERIFICATION_SEGMENT,
  CompanyVerificationDtoSchema,
  RequestCompanyVerificationRequestSchema,
  VERIFICATION_CLAIM_STATUSES,
  VERIFICATION_CLAIM_TYPES,
  VERIFICATION_METHODS,
  VERIFICATION_STANDING_STATUSES,
  VERIFICATION_SUBJECT_TYPES,
  VerificationClaimStatusSchema,
  VerificationClaimTypeSchema,
  VerificationMethodSchema,
  VerificationStandingDtoSchema,
  VerificationStandingStatusSchema,
  VerificationSubjectTypeSchema,
  type CompanyVerificationDto,
  type RequestCompanyVerificationRequest,
  type VerificationClaimStatus,
  type VerificationClaimType,
  type VerificationMethod,
  type VerificationStandingDto,
  type VerificationStandingStatus,
  type VerificationSubjectType,
} from "./verification.js";
```

Until it lands, `packages/verification/src/contracts/` carries the same
schemas locally so the package builds; the package switches to
`@capital-q/contracts` in one import change when the lead's file exists.

## 4. Operator decision — not implementable yet (escalation)

`OPERATOR_DECISION` needs an operator principal. The security package has
no platform scope by design (`packages/security/src/authorization/
resource-scope.ts`: "There is deliberately no GLOBAL, PLATFORM or wildcard
scope. Support and administrative access will arrive as explicit
capabilities through a controlled workflow"). The migration above reserves
the method and the `verification.decide` capability, granted to no role, so
the row shape does not change when the operator arrives. What is needed,
when the lead decides to add it:

- a `platform_operator` role (`permissions.roles`, scope_type
  `platform`), assignable only by migration or a privileged script, never
  through `/v1/organisations`;
- a resolver path that yields an ActorContext for an operator principal
  (`actorType: "HUMAN"`, no organisation, a capability check against a
  `PLATFORM` resource scope) — an ADR, since it amends doc 15 / the
  resource-scope decision;
- the route `POST /v1/operator/verification/claims/:claimId/decision`
  (service-role credential isolated in the api process, never in the
  browser), body `{ status: "VERIFIED" | "REVOKED", decisionBasis,
  revocationReason? }`, Idempotency-Key required, audited as
  `verification.claim.decided` with `method = OPERATOR_DECISION`,
  `decided_by_actor_type = HUMAN`, `decided_by_user_id = operator`.

Until then only `SYNTHETIC_DEMO_ATTESTATION` can decide, and only on a
deployment that attests synthetic (local/test loopback, or hosted staging
naming the synthetic Supabase project), for principals whose auth account
is marked `synthetic: true`.
