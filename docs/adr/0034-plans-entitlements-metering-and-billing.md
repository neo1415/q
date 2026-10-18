# ADR 0034: Plans, entitlements, metering and billing

Status: PROPOSED (BILLING, 2026-10-01). Lead to accept on merge. Founder decisions are listed in
`docs/specs/2026-10/billing.md` §10.

## Context

The founder asked for "a payment structure for billing and plans" with the controls built in, for
example "rehearsals might be on a plan; not everybody can access it".

The locked sources leave room for this:

- **PADL #85 (LOCKED)** defines a layered intelligence model:
  - Layer 1 Diagnosis is free.
  - Layer 2 Strategic Intelligence is "Pro".
  - Layer 3 Human Execution is optional.
- **Decision #106** keeps the full InvestIQ diagnosis free and names the value ladder "Intelligence →
  AI Execution → Human Expertise".
- **Neutrality decisions** forbid payment from influencing rankings, and forbid Q from promoting paid
  products.
- **Doc 12 §51.1** foresees allowances and requires that "entitlement checks occur outside the model".
- **Doc 13** reserves a `billing` schema.

No source sets prices. A facilitation fee on capital raised comes from a founder direction
(2026-09-29), not from a locked source.

## Decision

1. **Catalogue as data.**
   - Features, plans and plan limits are versioned reference data in `billing.*`, never enums.
   - A changed plan is a new version.
   - Code refers to feature keys as string constants.
2. **Billing account.** A billing account is the actor's server-resolved organisation, or the person
   when they act without one. Nothing a client sends chooses it.
3. **Launch default.**
   - An account with no assignment in force is on the single launch default plan.
   - Every existing account keeps generous access with no backfill.
   - Ending the launch is a reviewed migration.
4. **Gated features.** Only model-heavy or execution features are gated:
   - rehearsals
   - "Q handles it" delegations (errands, outreach, stand-in)
   - AI images in documents
   - web research
   - Q Daily editions
   - GateQ gateways (a count)

   These are never gated: diagnosis, assessments, Q answers, Discover ranking and feed, save/pass,
   interest, chat, meetings, commitments, verification and safety. A test keeps them out of the
   catalogue.

5. **Enforcement** is deterministic and server-side at each entry point:
   - api: gateway create.
   - q-api: rehearsal start and document images.
   - q-tools: the proposal tools CHECK, and research CONSUMEs.
   - Approval Engine executors: errand, outreach and stand-in CONSUME, keyed by the action's
     idempotency key.

   `billing.consume` is one atomic SQL step: an advisory lock per account and feature, idempotency
   key replay, the limit check, then insert. Work that fails gives its unit back by voiding it, never
   by deleting it.

6. **Refusal shape.**
   - HTTP refusals are `ENTITLEMENT_REQUIRED` (402) with an `entitlement` extension: the caller's own
     plan, counts, reset and `/settings/plan`, plus one plain sentence.
   - Q tools are DENIED with the same sentence, which Q relays.
   - Q never pitches an upgrade unprompted.
   - The UI never hides a gated feature. It shows what is left and the way to the plans.
7. **Payments.**
   - Payments go through a `BillingProvider` port with a Stripe adapter over Stripe's REST API (no SDK
     dependency): hosted Checkout, the hosted Customer Portal, and webhooks.
   - Webhooks are HMAC-SHA256 signed over the raw body, within a 5-minute window, deduplicated on
     event id, and newest-event-wins on the subscription row.
   - Prices are resolved from plan `stripe_lookup_key`.
   - The provider is off unless both secrets are real. Plans, limits and operator assignment work
     without it.
8. **Operator controls** sit in the ADR 0033 console: assign a plan, grant a trial, override or reset
   a limit, accrue the fee ledger, set the fee rate (owner only) and export CSV. Each control uses the
   new permissions `billing.read`, `billing.write`, `billing.fees.read`, `billing.fees.accrue` and
   `billing.fees.rate`. Writes need a step-up, and every change is audited in
   `platform_ops.admin_actions` with its reason.
9. **Facilitation-fee ledger.**
   - The ledger has one entry per commitment the other side CONFIRMED, at the levels the current
     schedule accrues (default INVESTED).
   - The fee is computed with exact `numeric` arithmetic.
   - An entry is RATE_NOT_SET until the founder sets a rate, and is voided when its commitment stops
     being current before invoicing.
   - Capital Q records and exports. It never holds or moves money (doc 10 §14).
   - The ledger reads `network.commitments` as an operator read model, as the attribution ledger
     already does.

## Consequences

- **New package** `@capital-q/billing`; the `billing` schema is server-only (RLS on, no client grants).
- **Shared code touched:**
  - contracts: error code, problem extension, billing DTOs.
  - q-tools: `ENTITLEMENT_REQUIRED` failure code, `entitlements` port, `get_my_plan` tool, capability
    entry.
  - platform-admin: permissions v2.
  - gateq: optional `countActiveForOrganisation`.
- **Q Daily (ADR 0032)** is in another branch. Its issue job must call
  `entitlements.consume(account, "q.daily_editions", "daily:<editionId>:<userId>")` when merged.
- **Requires a PADL amendment and legal advice** before any facilitation fee is invoiced (US
  broker-dealer and UK FCA "arranging deals" questions).
- **Amends "Q has no say over plans".** Q may read and explain the person's own plan, and never
  changes it. Buying happens on Stripe's hosted pages, by a person.
