# ADR 0033 — Platform operators: roles, step-up and break-glass

- Status: Accepted (founder direction, 2026-10-01: "a Capital Q admin
  dashboard for the platform itself, with the different roles and full
  functionality, monitoring and auditing of Q")
- Amends: `packages/security/src/authorization/resource-scope.ts` ("there is
  deliberately no GLOBAL, PLATFORM or wildcard scope"),
  `docs/escalations/verify-001/README.md` §4 (operator principal),
  `20261031090000_identity_platform_admins.sql` ("rows are written only by
  privileged operators, never by the app").
- Spec: `docs/specs/2026-10/admin.md`.

## Context

The admin console (53b5541c) knew one thing: whether a person is in
`identity.platform_admins`. The founder now wants a real operations console
with several people in different jobs, verification decided by humans for
real users, a trust-and-safety queue, Q monitoring and kill switches. Doc 15
kept platform authority out of the tenant permission model on purpose, and
that stays true.

## Decision

1. **Operators are not a tenant role.** Platform authority lives only in
   `identity.platform_admins` (one `role` per admin: platform_owner,
   operator, trust_and_safety, support, analyst) and the versioned code table
   `ADMIN_PERMISSIONS` in `@capital-q/platform-admin`. Nothing in
   `permissions.*` grants it and no organisation route can assign it. The
   resource-scope model still has no PLATFORM scope: operator checks are a
   separate, explicitly named path used only by `/v1/admin/*`.
2. **The app may write `platform_admins`** — only through `/v1/admin/team`,
   only for a platform_owner with a live step-up, never for oneself, never
   removing or demoting the last platform_owner; every change is appended to
   `platform_ops.admin_role_events`.
3. **Step-up** is a fresh re-authentication verified by the API with the
   Auth server (`amr` timestamp ≤ 120 s), recorded in `platform_ops.step_ups`
   for 15 minutes. Every sensitive console write needs one
   (`STEP_UP_REQUIRED` otherwise).
4. **Content is redacted by default.** Private chats and Q run content are
   readable only under an approved break-glass request (reason ≥ 20 chars,
   approver ≠ requester; SOLO approval only when no other eligible admin
   exists, flagged everywhere), for 30 minutes, every read logged.
5. **OPERATOR_DECISION is implemented**: an admin with
   `verification.decide` and a step-up decides a PENDING claim (VERIFIED, or
   REVOKED with a reason), as a HUMAN decider, in the same append-only row,
   audit and event as the synthetic decider. R43 (synthetic auto-verify on
   staging for synthetic-marked principals) is unchanged.
6. **Account suspension** is an operations record
   (`platform_ops.account_suspensions`) enforced at actor-context resolution
   in api and q-api (`ACCOUNT_SUSPENDED`), separate from Q's own conduct
   pause (`q_runtime.person_standing`).
7. **Kill switches** for Q autonomy and the Q Daily are rows in
   `platform_ops.feature_flags`; off means no new step starts.

## Consequences

- One more privileged path to keep narrow: every `/v1/admin/*` route answers
  404 to non-admins and to admins without the permission, and has an RBAC
  negative test.
- Firewall decisions and Capital Q's own email outcomes are now recorded
  (codes only) so the console can show them.
