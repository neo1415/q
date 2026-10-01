# BILLING — plans, entitlements, metering, payments, facilitation-fee ledger

Owner: BILLING worker (branch `build/billing`). Migrations `202611160*` (`20261116000000` is
already taken by a fix-forward, so this area starts at `20261116010000`). ADR 0034.
Companion audit: `docs/handoff/research/spec-vs-code-2026-10.md` (capability table, revenue points).

## 1. Goal (founder, 2026-10-01, verbatim intent)

> "Go through the entire product specification, the PADL, everything, from top to finish,
> including the points where we make money. Based on the code itself and the tests and results so
> far, get me the parts where we can create a payment structure for billing and plans, and make sure
> those controls are already built in — e.g. rehearsals might be on a plan; not everybody can access
> it."

Done means:

1. A plan system exists and is enforced on the server.
2. Admins can assign plans, grant trials and override limits, and every change is audited.
3. People see what their plan includes and how much they have used.
4. Q explains plan limits plainly.
5. Stripe is ready to switch on.
6. The facilitation-fee ledger is computed from confirmed commitments.

Nobody loses access today.

## 2. What the sources allow (controlling decisions)

| Source                                                                                                      | Says                                                                                                                                                                                                                                                                                                                                         | Consequence for billing                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PADL #85 (LOCKED), layered intelligence model                                                               | Layer 1 Diagnosis is free. Layer 2 Strategic Intelligence (**Pro**: Capital Readiness Blueprint, roadmap, investor-specific recommendations, sequencing) is paid. Layer 3 Human Execution (FDN / approved specialists) is optional. "Q shall never intentionally withhold valuable intelligence simply to encourage consulting engagements." | Diagnosis, assessments, Q answers, Discover, interest, chat and meetings are **never gated**. Paid value is depth, execution volume and model-heavy work.                     |
| Product Spec Decision #106 (LOCKED)                                                                         | The full InvestIQ diagnosis is available without paid advisory. Value ladder: Intelligence → AI Execution → Human Expertise. "Exact pricing … outside the scope."                                                                                                                                                                            | AI execution (delegations, rehearsals, documents with AI images, research volume) is the natural paid layer. No prices in the specs, so prices here are recommendations only. |
| Product Spec Ch. 4, consideration and recommendations                                                       | "Premium platform tiers may increase the volume and frequency of AI recommendations without reducing recommendation quality."                                                                                                                                                                                                                | Volume can be a plan lever. Ranking quality and order never are.                                                                                                              |
| PADL decisions on commercial neutrality (#152/#154 family), FSR "Commercial interests vs Q recommendations" | "Commercial payment cannot secretly manipulate Q's objective rankings." "Q cannot manufacture diagnoses to generate affiliated advisory revenue." Q must not promote paid products.                                                                                                                                                          | **No pay-to-rank.** No plan feature touches ranking, eligibility or assessment. Q mentions an upgrade only when the person hits a limit or asks.                              |
| PADL appeals (Stage 4 Human Escalation)                                                                     | "Future commercial plans may determine access levels, usage limits, or premium entitlements for human escalation."                                                                                                                                                                                                                           | Human review can become a plan feature once the workflow exists. Today it is not built (§9).                                                                                  |
| Doc 12 §51.1                                                                                                | Later plans may have a Q usage allowance, a deep investigation allowance, voice minutes and an external research allowance. "Entitlement checks occur outside the model."                                                                                                                                                                    | Quotas are enforced by deterministic code before model work starts, never by a prompt.                                                                                        |
| Doc 13 schema list                                                                                          | `billing`: future plans and entitlements.                                                                                                                                                                                                                                                                                                    | Use the reserved `billing` schema.                                                                                                                                            |
| Doc 15 abuse controls                                                                                       | "plan entitlement" listed with rate limit and per-run budget against "bot creates many Q deep investigations → model bill".                                                                                                                                                                                                                  | Metering doubles as cost control.                                                                                                                                             |
| Doc 10 §14                                                                                                  | Securities transaction execution, wallets and escrow are out of scope.                                                                                                                                                                                                                                                                       | The fee ledger records and exports. Capital Q never touches investment money.                                                                                                 |
| Founder direction 2026-09-29 (ledger)                                                                       | "we take a commission for facilitation of capital"; the attribution ledger was built (network.commitments, admin attribution).                                                                                                                                                                                                               | Success fees are a **founder direction, not yet in a locked source**: propose a PADL amendment and a legal check (§10).                                                       |

## 3. Research (sources)

- Stripe Billing is the standard. Checkout in `mode=subscription` creates the customer and the
  subscription. The Customer Portal handles card, plan and cancellation changes. Webhooks drive state
  (https://docs.stripe.com/billing/subscriptions/build-subscriptions,
  https://docs.stripe.com/customer-management).
- Webhook signature: the `Stripe-Signature: t=…,v1=…` header carries an HMAC-SHA256 over `"{t}.{raw
body}"` with the endpoint secret. The default tolerance is 5 minutes. Stripe may deliver an event
  more than once and out of order, so consumers dedupe on `event.id`
  (https://docs.stripe.com/webhooks#verify-manually, https://docs.stripe.com/webhooks#handle-duplicate-events).
- Prices carry `lookup_key`, so code maps a plan to a price without hard-coding price ids
  (https://docs.stripe.com/products-prices/manage-prices#lookup-keys).
- Entitlements pattern: the industry splits plan (catalogue), entitlement (what a customer may do)
  and meter (what they did). Stripe's own Entitlements API follows the same split. Here the catalogue
  stays our own reference data, so plans work without Stripe
  (https://docs.stripe.com/billing/entitlements).
- Success fees on capital raising: in the US, transaction-based compensation for introducing investors
  generally requires broker-dealer registration (SEC "Guide to Broker-Dealer Registration"). In the UK,
  arranging deals in investments is a regulated activity (FCA PERG 2.7.7). A legal check is required
  before any fee is invoiced (§10).

## 4. Model (ADR 0034)

Plan → features → limits are **versioned reference data** in `billing.*`, never enums.

- `billing.features`: `key` (dotted text), name, description, `kind` (`ACCESS` | `MONTHLY` |
  `COUNT`), unit. Code refers to keys as string constants, like event names.
- `billing.plans`: `(key, version)` unique; name, audience (`ANY` | `FOUNDER` | `INVESTOR`),
  `status` (`ACTIVE` | `RETIRED`), `is_launch_default` (exactly one ACTIVE row), `self_serve`, and
  `stripe_lookup_key` (nullable). A changed plan is a new version. Existing assignments keep their
  version.
- `billing.plan_features`: `(plan_id, feature_key)` gives `included` and `monthly_limit` / `max_count`
  (null = unlimited).
- `billing.plan_assignments`: append-oriented per billing account. Fields: source (`ADMIN` | `TRIAL`
  | `STRIPE`), `starts_at`, `ends_at` (trial or cancellation), `assigned_by`, `reason`, and
  `superseded_at`. The current row is the newest unsuperseded row in force. When none is in force,
  the account is on the **launch default plan** (no backfill needed, so every existing account is
  covered).
- `billing.limit_overrides`: per account and feature. Holds a limit, an expiry, `granted_by`, a
  reason and `revoked_at`.
- `billing.usage_events`: append-only meter. Fields: account, feature, `period_start` (UTC month),
  quantity, `idempotency_key` (unique per account and feature), actor, source surface, and
  `voided_at` (refund when the metered work failed).
- `billing.consume(...)`: one SQL function that locks the account and feature with an advisory
  transaction lock, replays an idempotent key, checks the limit and inserts. Metering and quota are
  one atomic step, so two concurrent requests cannot both take the last unit.
- `billing.customers`, `billing.subscriptions`, `billing.provider_events` (unique
  `(provider, event_id)`): Stripe state and webhook dedupe.
- `billing.fee_schedules`: versioned reference data. Fields: rate in basis points (null = **not set
  by the founder**), the levels that accrue (default `INVESTED`), the payer side, and
  `effective_from`. `billing.fee_entries` holds one entry per confirmed commitment. Status is
  `ACCRUED`, `RATE_NOT_SET`, `INVOICED` or `VOID`. It records the amount, currency, rate, schedule
  version and computed fee (`numeric`, never float).

**Billing account** = the actor's organisation, or the person when they act without one. RLS
enabled on every table:

- An organisation's active members read their own account's plan, usage and overrides.
- A person reads their personal usage.
- Fee tables, provider events and customers are server-only.
- No client writes anything.

## 5. Features, limits and plans (seeded reference data)

Gated (model-heavy or execution), with the entry points that enforce each feature:

| key                   | kind    | Entry points enforced                                                                                                                                                                          |
| --------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `q.rehearsals`        | MONTHLY | q-api `POST /v1/q/rehearsals` (consume first, void if the start fails)                                                                                                                         |
| `q.delegations`       | MONTHLY | q-tool `relationship.errand.propose` and the work-start tools (check). Approval Engine executor for `ERRAND_START` and the work-start actions (consume, keyed by the action's idempotency key) |
| `documents.ai_images` | MONTHLY | q-api document image generation (consume per image). The document stays; Q uses stock or no picture when the limit is reached                                                                  |
| `q.research`          | MONTHLY | q-tool `research.public_web` (check, then consume keyed by the tool call). Onboarding research is never gated ("Q works first")                                                                |
| `q.daily_editions`    | MONTHLY | DAILY worker issue job (integration point §11; the feature is seeded now)                                                                                                                      |
| `gateq.gateways`      | COUNT   | api `POST /v1/gateq/gateways` (count of the organisation's gateways)                                                                                                                           |

Never gated (PADL #85 Layer 1, #106, neutrality): onboarding, InvestIQ diagnosis, profile, Q
answers, Discover ranking and feed, save/pass, express interest, chat, meetings, commitments,
verification, safety, data export. A test asserts these keys are not in the catalogue.

Seeded plans. Limits are recommendations for the founder to change. Changing one is a new plan
version.

| plan                                   | rehearsals/mo | delegations/mo | AI images/mo | research/mo | Q Daily/mo | gateways |
| -------------------------------------- | ------------- | -------------- | ------------ | ----------- | ---------- | -------- |
| `launch` (default, free during launch) | 30            | 30             | 150          | 300         | 31         | 5        |
| `free`                                 | 1             | 2              | 10           | 20          | 5 (weekly) | 1        |
| `founder_pro`                          | 20            | 20             | 150          | 300         | 31         | 1        |
| `investor_pro`                         | 20            | 40             | 100          | 500         | 31         | 3        |
| `fund`                                 | 60            | 200            | 500          | 2000        | 31         | 10       |

**Recommended prices (founder decision; not in any source):** Founder Pro $49/mo ($490/yr).
Investor Pro $99/seat/mo. Fund $499/mo for up to 10 seats, annual. Free stays Layer 1 complete.
Launch stays free for every account until the founder ends it. Ending it means changing
`is_launch_default` to `free`, a reviewed migration, with notice to users.

## 6. Contracts

- Problem `ENTITLEMENT_REQUIRED` (HTTP 402) with extension `entitlement`: `{ feature, featureName,
reason: NOT_IN_PLAN|LIMIT_REACHED, planKey, planName, limit, used, resetsAt, upgradePath:
"/settings/plan" }`.
- `GET /v1/billing/plan` returns the caller's account: plan, source, ends, and each feature with
  included, limit, used and resets. Any member may call it.
- `GET /v1/billing/plans` returns self-serve plans and what they include.
- `POST /v1/billing/checkout {planKey}` returns `{url}`. It needs `organisation.admin` and an
  Idempotency-Key. It answers 503 `PROVIDER_UNAVAILABLE` when Stripe is not configured, and the UI
  then shows "ask us".
- `POST /v1/billing/portal` returns `{url}` and needs `organisation.admin`.
- `POST /v1/webhooks/stripe` takes the raw body. It verifies the signature and replay window, dedupes
  on event id, and is idempotent.
- Admin (platform admin, `billing.read` / `billing.write` with step-up; every write goes to
  `platform_ops.admin_actions`):
  - `GET /v1/admin/billing/accounts/:organisationId`
  - `POST …/plan {planKey, endsAt?, reason}` (assign or trial)
  - `POST …/overrides {featureKey, limit, expiresAt?, reason}`
  - `GET /v1/admin/billing/fees`
  - `POST /v1/admin/billing/fees/accrue`
  - `POST /v1/admin/billing/fee-rate {rateBps, reason}` (platform_owner only)
  - `GET /v1/admin/billing/fees.csv`
- Q tool `plan.get_mine` (SAFE_READ, core). Capability registry entry "Your plan and usage"
  (SETTINGS, INSTANT). Navigate destination `PLAN`.

## 7. Authority and approval

- Reading one's own plan: INSTANT.
- Buying, upgrading or cancelling: a human in Stripe's hosted pages. Q never buys anything. Q can open
  the plan page.
- Admin plan, trial and override changes are platform-admin writes behind a step-up, audited with a
  reason.
- Fee rate: platform_owner only, step-up, new schedule version, audited. Fee entries are computed by
  deterministic code from CONFIRMED commitments only. A model never computes or writes a fee.

## 8. Privacy and Context Firewall

Plan and usage belong to the account and are never shown to the other side of a relationship. Fee
entries are admin-only and never visible to either party in-app (the commitments themselves are
already relationship-shared).

Entitlement never changes what Q may know or rank. It only decides whether metered work starts. The
denial text names the person's own plan and counts only.

## 9. UX

- **Settings → Plan** (`/settings/plan`):
  - Current plan, with the source shown as "Launch plan, free during launch" or "Trial until 12 Nov".
  - Each feature as a row: included or not, used/limit, and a quiet meter with a text label (never
    colour alone). Reset date.
  - Upgrade: Checkout when Stripe is on, otherwise "Talk to us about upgrading" (mailto). Manage
    billing goes to the Portal when there is a customer.
  - Loading, empty and error states. Light and dark, phone and desktop, 44px targets.
- **Gating never hides a feature.** Rehearsals shows "N of M rehearsals left this month". When the
  limit is reached, the start button stays visible and opens the notice. On a 402, the shared
  `EntitlementNotice` says what the plan includes, when it resets, and offers "See plans".
- **Q.** A tool denial carries `ENTITLEMENT_REQUIRED` and one plain sentence, for example: "Your
  Launch plan includes 30 rehearsals a month and you've used all 30. It resets on 1 November. You can
  see plans in Settings → Plan." Q relays it and offers to open the plan page. Q never pitches an
  upgrade unprompted.
- **Admin → Billing** (`/admin/billing`):
  - Account lookup by organisation id from Organisations: plan, usage, assign plan or trial, override
    a limit, each with a reason (step-up).
  - Fee ledger: accrue, list, CSV, set rate.

## 10. Founder decisions needed

1. Prices (§5 recommendations) and whether Launch ends, and when.
2. Which features are paid (the §5 gated list, or fewer).
3. Facilitation fee: the rate, which levels accrue (default INVESTED only), who pays (company by
   default), and a **legal opinion** (US broker-dealer and UK FCA arranging). Until a rate is set,
   entries are recorded as RATE_NOT_SET. A PADL amendment is needed because no locked source mentions
   a success fee.
4. Stripe account: secret key, webhook secret, products and prices with lookup keys
   `founder_pro_monthly`, `investor_pro_monthly` and `fund_monthly`. The Portal configured.
5. Whether human escalation (appeals) and the Capital Readiness Blueprint become Pro features once
   built.

## 11. Edge cases

- Plan downgrade mid-month: used counts stay. The new limit applies at the next consume.
- Trial expiry: `ends_at` passes and the account falls back to the previous assignment or launch.
  Nothing runs at expiry; resolution is time-based.
- Stripe `past_due`: the plan is kept (Stripe retries). `canceled` or `unpaid` ends the assignment.
  Events out of order: the subscription row keeps the latest `event.created`.
- Replay: the same event id is acknowledged and ignored. A bad signature or a timestamp more than
  5 minutes away gets 401 and changes nothing.
- Concurrency: an advisory lock per account and feature, and idempotency keys per consume.
- A metered start fails: the usage is voided, so the person is not charged a unit.
- Q Daily (DAILY branch, not in this base): the issue job calls
  `entitlements.consume(account, "q.daily_editions", "daily:<editionId>:<userId>")` and skips that
  reader's edition with a note when refused. The lead wires it when merging DAILY.

## 12. Tests

- Unit:
  - Catalogue (never-gated keys absent).
  - Problem and sentence shape.
  - Stripe signature (valid, tampered, stale, replay window, multi-v1).
  - Webhook handling idempotency (fake provider).
  - Fee computation (numeric, rate-not-set).
- Route tests (fastify inject) on every gated entry point:
  - rehearsal start → 402 without quota, and the void on failure.
  - gateway create → 402 at the count limit.
  - errand propose tool → `ENTITLEMENT_REQUIRED` deny.
  - errand executor → FAILED when the quota is gone at execution.
  - research tool → deny.
  - document images → refused.
- Admin routes: 404 for non-admins, step-up, and the audit row written.
- pgTAP:
  - RLS (own org reads, a cross-tenant read is empty, a revoked membership reads nothing).
  - No client writes.
  - `billing.consume` idempotency and limit.
  - Exactly one launch default.
