# Enterprise admin, facilitation ledger, plans and billing: audit and design

- Status: **PROPOSED** (2026-11-18). Audit and design only; no feature code. Needs the owner's decisions in §15 before slices L3, B2, B3 and C2 start.
- Builds on: ADR 0033 (operator roles, step-up, break-glass), ADR 0034 (plans, entitlements, metering, billing), ADR 0036 (plan values), ADR 0060 (raise shared with the network), ADR 0080 (ClamAV required), `docs/specs/2026-10/admin.md`, `docs/specs/2026-10/billing.md`, launch-readiness 7–9 (commit 52b7cef61, `docs/ai-handoff/OPS-ALERTS.md`).
- Binding: root `CLAUDE.md` invariants. These include tenant isolation and RLS, and the four separate kinds of record: domain event, job, audit and analytics. Money is `numeric` plus an ISO currency. There is one canonical relationship row. Humans keep commercial authority. No PII in logs, analytics or model prompts.
- Out of scope here: the legal analysis of success fees. A separate document covers it. This design only flags where the legal answer gates a slice.

## 0. The owner's requirements (verbatim intent, all kept)

1. **A proper enterprise super-admin.** It lives inside the owner's investor organisation (Zino Aviation) for now, and moves to its own subdomain later. It covers:
   - documents sent, and security: ClamAV scans, blocked files, access;
   - spend: tokens and cost per person, plus our own total, per provider (one shared pool today, divided into pools later);
   - subscriptions, tiers and billing cycles per person or organisation;
   - Tavus/video usage and meetings;
   - money: amounts facilitated, the fee owed per party (a percentage), and who is earning or bringing the most;
   - analytics on what works and what doesn't;
   - a CRM for our own email outreach;
   - compliance records.

   _"Every single thing that is being done and used in Capital Q, it should be able to find."_

2. **A facilitation ledger.**
   - Rounds are obvious in the UI.
   - A commitment moves soft → hard → sent → received.
   - Q asks the parties to confirm, with notes on clauses and changes.
   - Misreporting is hard: evidence, confirmation from both sides, documents, and possibly confirmation from a payment provider.
   - A dashboard shows money facilitated and fees owed.
3. **Plans and tiers** across text, voice, visuals and tables, meetings and video. Entitlements are enforced and tied to the existing per-person limits and caps.
4. **Investor reminders.** Q remembers what an investor said they'd do and offers email reminders.
5. **Collecting money.** A subscription billing provider behind an adapter, and invoicing for facilitation fees. Success fees are flagged as possibly needing a licence.

## 1. Audit: what exists (code on `fix/resume-asking-cv9ru3` @ ea6050095; production read-only, schema and counts only, 2026-11-18)

### 1.1 The admin console

**What is built**

- **Route and pages:** `/admin` (`apps/web/app/(app)/admin/*`) has 17 sections on one flat left list:
  - Overview, Accounts, Organisations and Queue (verification and reviews);
  - Safety (with break-glass) and Q monitor (with run traces);
  - Audit (with CSV), Kill switches, Analytics privacy and Claims;
  - Brand, Etiquette, Billing (with a fees CSV), Email and Team.
- **API:** `apps/api/src/http/admin.ts` (about 40 routes) and `admin-billing.ts` (8 routes). Logic lives in `packages/platform-admin` (18 modules) and `packages/billing`.
- **Authorisation is sound and is kept:**
  - The role comes only from `identity.platform_admins`; the permission comes from a versioned code table (`permissions.ts`, v5, 5 roles).
  - Every write needs a 15-minute step-up (`platform_ops.step_ups`) and is audited in `platform_ops.admin_actions`.
  - Content needs break-glass, and each read is logged in `platform_ops.break_glass_reads`.
  - A person who is not an admin gets a 404.
  - Production has 1 admin (`platform_owner`), 34 admin actions and 0 break-glass reads.

**Why the owner finds it "not usable, just a bunch of stuff"**

- **No hierarchy.** It is 17 peers with no grouping and no "today" view. The Overview is a stack of tables (attribution, disputes, paused, queues).
- **No spend view.** There is none per person or per organisation. The Q monitor shows cost per day by task class and model only.
- **No documents or security view.** Scan status, blocked files and document access are invisible to the console.
- **No video or meetings view.** `billing.video_usage_ledger` (50 rows) and `communication.meetings` (19) are not shown.
- **Money is a raw table.** It is the attribution table plus a fee CSV: no totals by round, side or origin, and no "who brings the most".
- **No search across everything.** Search covers accounts and organisations only.
- **Admin reads are not audited.** Only writes and break-glass reads are.
- **No business analytics, CRM or compliance pages.** "Analytics" is only the privacy settings.

### 1.2 Spend and usage

**Model calls (`ai_ops.model_usage`)**

- 50,702 rows; 368 distinct people; 1,360 rows with no person (system work).
- Each row has the provider, model, task class, tokens (input, cached and output), latency, `cost_usd numeric`, `cost_basis` (`PRICE_SNAPSHOT` / `ESTIMATED` / `UNPRICED`) and `purpose`.
- Total recorded: about USD 133.92 across 4 model providers.
- `UNPRICED` rows exist, so the total is understated. The console must show the unpriced count.

**Providers outside the model gateway are not in any ledger**

- Text-to-speech, speech-to-text, web research, meeting bots and email are not recorded per person.
- `CQ_SPEECH_DAILY_LINES` and `CQ_RESEARCH_DAILY_CALLS` are **in-memory counters** (`apps/q-api/src/voice/synthesis.ts`, `packages/q-research/src/providers/breaker.ts`). They reset when a service restarts and attribute to no one.
- Only video has a persisted, priced ledger: `billing.video_usage_ledger` holds 50 rows across MEETING, GATEQ and REHEARSAL, test and real, with `est_cost_usd`.

**Caps (52b7cef61)**

- A model spend cap per day (`CQ_MODEL_DAILY_SPEND_CAP_USD`, default 50) for the whole service: one implicit shared pool.
- Per-person Q runs: 20 a minute and 300 a day.
- Voice starts: 20 per 10 minutes.
- All are environment variables, not data, and are invisible in the console.

**Plan meter**

- `billing.usage_events` has 833 rows, 832 live: research 582, delegations 174, rehearsals 69, AI images 8.
- `billing.credit_entries` exists.

### 1.3 Plans, subscriptions and billing (ADR 0034, as built)

**Catalogue**

- 11 features in reference data, of kinds ACCESS, MONTHLY, COUNT and VALUE.
- 5 plans: `launch` (the default for everyone), `free`, `founder_pro`, `investor_pro` and `fund`. The last three are self-serve and have a Stripe lookup key.
- `NEVER_GATED_CAPABILITIES` (code and a test) forbid gating:
  - onboarding, diagnosis, assessment and Q answers;
  - Discover ranking and feed, save/pass, interest and chat;
  - meetings, commitments, verification, safety and data export.

**Stripe**

- A `BillingProvider` port with a Stripe REST adapter (no SDK): Checkout, the Portal, and HMAC-verified webhooks (`billing.provider_events`, newest event wins).
- In production: 0 customers, 0 subscriptions and 0 plan assignments. Stripe is not switched on.
- **Gap:** `billing.subscriptions` has no billing interval, current period, seats or trial end. There is no invoice mirror.

**Admin billing**

- Assign a plan, override or reset a limit, accrue fees, set the fee rate (owner only), and export a fees CSV.

### 1.4 Rounds, commitments and the fee ledger

**Rounds**

- `core.capital_rounds` holds 436 rows (352 OPEN, 84 PLANNED), with the event log `core.capital_round_events`.
- Each round has a target (`numeric` plus currency), instrument, terms, `reported_raised_amount` and `is_current`.
- Founder UI exists in `apps/web/src/features/capital/*`: the round card, capital book, commitment ladder and raise bar.

**Commitments (`network.commitments`)**

- Levels: SOFT, FIRM and INVESTED.
- Statuses: STATED, CONFIRMED, DETECTED, ADOPTED, DISPUTED, SUPERSEDED, WITHDRAWN, TRANSFER_SENT and RECEIVED.
- Fields: `stated_by_side`, `confirmed_by_user_id`, `transfer_sent_*` with a free-text `transfer_reference`, and `received_*`. Each step is a `commitment_*` relationship event and a notice to the other side.
- Production has 7 commitments in total, and **0 of 7 carry a `round_id`**. Round attribution is not reaching real data; slice L1 checks the default-attach path.
- **Gaps:**
  - one amount per commitment, so there are no tranches;
  - no evidence document for a transfer;
  - no reconciliation of the amount sent against the amount received;
  - no record of amendments or clauses;
  - no corroboration grade;
  - the investor can mark "sent" with nothing behind it.

**Fee ledger**

- `billing.fee_schedules` v1: rate NULL, accrues at INVESTED, payer COMPANY.
- `billing.fee_entries` has 0 rows. It is deterministic, `numeric` and voidable.
- One payer side per schedule, so there is no fee per party.

**Deals**

- `network.deal_terms`, `deal_closes` and `deal_close_checklist` exist. Signed-document references live on `deal_terms`.

### 1.5 Documents and security

- `evidence.document_versions` holds 2,245 versions. `malware_scan_status` is CLEAN for 2,245 and BLOCKED for 0; one has `processing_status` FAILED. There are 2,248 upload requests.
- ClamAV is required (ADR 0080, `CQ_MALWARE_POLICY=REQUIRE_CLEAN`).
- Access traces exist in `network.diligence_document_views`, the data room tables and `platform_ops.break_glass_reads`.
- **None of this is in the console.**

### 1.6 Email, CRM, reminders and analytics

**Email**

- `platform_ops.email_deliveries` has 1,618 rows, keyed by source and storing only the recipient's domain and a hash. Sources:
  - `workers.daily` 902, `workers.notices` 613, `workers.meetings` 36, `q_api.meeting_invite` 34;
  - `workers.reminders` 21, `api.team_invitation` 6, `api.gateq_answer` 5, `q_api.operator_notice` 1.
- Transport is Brevo or SMTP. The Email admin page shows the sender and SPF, DKIM and DMARC checks.
- `integrations.email_messages` has 0 rows.

**CRM: none**

- No contacts, consent, suppression list, campaigns or unsubscribe (no `List-Unsubscribe` anywhere in the code).

**Reminders**

- `communication.reminders` has 93 rows, from the person (PERSON) or from a meeting (MEETING), in the app or by email.
- Q tools exist: `propose_reminder`, `dismiss_reminder` and onboarding reminders.
- Meeting notes already extract `followUps` and commitment signals (`packages/q-core/src/prompts/schemas/meeting-notes.ts`).
- **Gap:** what an investor _said they would do_ is not kept as a durable, confirmable item linked to a reminder.

**Analytics**

- `analytics.engagement_events` has 303 rows (PROFILE_VIEW 189, VIDEO_WATCH 114). `analytics.platform_settings` and `viewing_privacy_settings` exist.
- There is no product-event stream, no funnels and no third-party tracker. Business metrics can mostly be **derived** from domain tables.

### 1.7 Compliance

**What exists, scattered:**

- verification claims and human or KYB reviews;
- account suspensions and deletions;
- the audit tables `audit.material_actions` and `platform_ops.admin_actions`;
- break-glass and Q firewall decisions;
- malware status.

**Gaps:**

- no register of compliance artefacts (legal opinions, data processing agreements, sub-processors, incidents, DSARs, retention runs);
- no single page.

## 2. Principles for this design

1. **Reuse, don't rebuild.** ADR 0033 access, the step-up, break-glass, the billing package, the Stripe adapter, the rounds and commitment ladder, and reminders all stay. Every new piece extends them.
2. **Admin is a person's role, never an organisation's.** "Inside Zino Aviation" is only _where the door is_ (§4). Membership of Zino Aviation grants nothing.
3. **Read models, not parallel truth.**
   - The console reads domain tables through `packages/platform-admin` read models.
   - It never writes a commitment, a round or a relationship.
   - Party-confirmed facts stay the parties' (commercial authority).
4. **Four kinds of record stay separate:**
   - A commitment marked as sent is a _domain event_.
   - Accruing fees is a _job_.
   - An admin overriding a limit is _audit_.
   - "Plan page viewed" is _analytics_.
5. **Content is not metadata.**
   - The console shows counts, sizes, statuses, amounts and parties.
   - Document bodies, chats, Q conversations and Q memory still need break-glass (decision 37 holds).
6. **Unknown stays unknown.** A missing confirmation is UNCONFIRMED, never "not sent". An unpriced call is UNPRICED, never USD 0.

## 3. Information architecture

The 17 flat sections are regrouped into **8 areas** with a left rail (top tabs on a phone). Each area has a landing dashboard: tiles, with a trend where meaningful, linking to filtered tables. Current pages move under an area unchanged. Each area shows only to roles holding its read permission.

| Area                   | Pages                                                                                            | What each shows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Today** (home)       | Today                                                                                            | Waiting on you: verification, reviews, claims, reports, break-glass, ledger disputes, unreconciled transfers. Alerts (OPS_CHECK findings, caps near limit). Spend today against cap per pool. Money this month (facilitated and fees). New sign-ups and active people (7 days). Scan health (blocked or failed in 24 h).                                                                                                                                                                                                                                                         |
| **Find**               | Global search                                                                                    | One box over people, organisations, companies, rounds, relationships, commitments, documents (metadata), meetings, plans, invoices, campaigns and contacts. Returns typed results with deep links. Logged as an admin read (§5.3).                                                                                                                                                                                                                                                                                                                                               |
| **People & orgs**      | Accounts · Organisations · Person 360 · Organisation 360                                         | The existing search and views, plus a **360** page per person or organisation. It shows: plan and subscription, usage and spend (by provider), relationships count, rounds (companies), commitments and fees, documents (metadata), meetings and video minutes, emails sent to them (domain/hash only), consents, suspensions, and admin actions about them. Never chats or Q memory.                                                                                                                                                                                            |
| **Money**              | Facilitation dashboard · Rounds · Commitments ledger · Reconciliation · Fees · Invoices          | The dashboard is in §6.6. **Rounds:** every round with target, confirmed, sent, received, `reported_raised_amount`, and a variance flag. **Commitments ledger:** filter by stage, corroboration grade, round, origin, currency and age. **Reconciliation:** the queue of discrepancies (§6.4). **Fees:** entries by status, payer side and organisation, with exports. **Invoices:** fee invoices (§9.3) and the subscription invoice mirror.                                                                                                                                    |
| **Usage & spend**      | Spend · Pools & caps · Models · Voice · Video & meetings · Research · Email volume               | **Spend:** our total and per provider, per person and per organisation, and per day, week or month; the unpriced count is shown separately. **Pools & caps:** each pool's members and caps against today's spend, with the per-person limits (§7.3). **Models:** the current Q monitor's cost view. **Voice:** speech lines and seconds, live voice minutes. **Video & meetings:** Tavus sessions and minutes (test or real), meetings by status, meeting bot minutes, and cost. **Research:** calls per credential and per person. **Email:** deliveries by source and outcome. |
| **Plans & billing**    | Plans catalogue · Subscriptions · Assignments & overrides · Entitlement refusals                 | **Catalogue:** plans by version, features and modalities (§7). **Subscriptions:** per account (person or organisation) with tier, status, interval, current period, seats, trial end, next invoice and provider state. **Assignments & overrides:** the existing controls. **Entitlement refusals:** where people hit limits (demand signal).                                                                                                                                                                                                                                    |
| **Trust & compliance** | Queue · Safety · Documents & scanning · Access log · Audit · Compliance register · Kill switches | The existing pages, plus the new ones. **Documents & scanning:** uploads per day, scan status (CLEAN, BLOCKED, ERROR, pending), blocked files (hash, size, MIME type, uploader organisation, signature name, never the body), scanner health and signature age, processing failures. **Access log:** document views and downloads, data-room grants, break-glass reads, and admin reads (§5.3). **Compliance register:** §11.                                                                                                                                                    |
| **Growth**             | Business analytics · Product analytics · CRM contacts · Campaigns · Suppression                  | §10 and §12.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| _(settings)_           | Team · Brand · Etiquette · Email sender · Analytics privacy                                      | Unchanged, moved to a settings menu.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**Design rules**

- Follow docs 17–18 and the ADR 0017 amendments: semantic tokens, tables with cursor pagination (never offset), and every figure with its unit and currency.
- Mixed currencies are never summed. Totals are shown per currency. A converted "≈ USD" figure appears only with its rate source and date (§6.6).
- Charts follow the dataviz rules.
- Light mode is first-class and touch targets are at least 44 px.

## 4. Where it lives: "inside Zino Aviation", later a subdomain

**Now**

- In the app shell's account or organisation switcher, a person with an `identity.platform_admins` row sees a **"Capital Q admin"** entry. It shows while acting as Zino Aviation, and under any other context as well.
- The entry is computed on the server from `getAdminMe`. Holding the Zino Aviation organisation context neither grants it nor is required for it.
- The route stays `/admin/*`.

**Separation, required because Zino Aviation is also a real investor on the platform** (flagged, §15 Q1)

- Admin pages never feed the owner's investor workspace. That means no Q memory, no Discover features, and no ranking signals from admin reads (Context Firewall).
- Q on admin pages, if added later, runs under a separate `ADMIN` scope with no access to the admin's investor context, and vice versa.
- The money dashboard shows deal amounts across the network to someone who also invests. This is disclosed on the Team page and recorded in the compliance register. Founder-private figures (cash, burn, runway) are never in the console without break-glass.

**Later, a subdomain (`admin.<domain>`)**

- The same Next.js app with host-based routing, so there is no second codebase.
- A separate cookie scope with `__Host-` prefixed cookies, and a shorter session.
- Optionally an IP allowlist at Railway.
- No change to the API or the data model. Slice S8 does this.

## 5. Authorisation and audit

### 5.1 Roles

The "super-admin" is the existing `platform_owner` role. No client flag, header or organisation membership confers any admin right. Every request resolves the role from `identity.platform_admins` and the permission from the code table.

### 5.2 New permissions (`ADMIN_PERMISSIONS_VERSION` 6)

| Permission                                                            | Roles                             | Step-up |
| --------------------------------------------------------------------- | --------------------------------- | ------- |
| `search.read`                                                         | all                               | no      |
| `spend.read`                                                          | owner, operator, analyst          | no      |
| `spend.pools.write` (pool membership and caps)                        | owner                             | yes     |
| `documents.read` (metadata only)                                      | owner, operator, trust_and_safety | no      |
| `money.read` (dashboard, rounds, ledger)                              | owner, operator, analyst          | no      |
| `money.reconcile` (mark a discrepancy reviewed, add an operator note) | owner, operator                   | yes     |
| `plans.write` (new plan version)                                      | owner                             | yes     |
| `billing.invoices.issue` (facilitation invoice)                       | owner                             | yes     |
| `analytics.read`                                                      | owner, operator, analyst          | no      |
| `crm.read`                                                            | owner, operator                   | no      |
| `crm.write` (contacts, drafts)                                        | owner, operator                   | yes     |
| `crm.send` (approve and send a campaign)                              | owner                             | yes     |
| `compliance.read`                                                     | owner, operator, trust_and_safety | no      |
| `compliance.write`                                                    | owner, trust_and_safety           | yes     |

**Analyst role.** An analyst sees aggregates and pseudonymous identifiers (a per-console HMAC of the user id), never names or emails. The 360 pages require `accounts.read`.

**`money.reconcile` never changes a party's fact.** It records an operator review: a note and an outcome (`OPERATOR_REVIEWED`, `REFERRED_TO_PARTIES`, `FLAGGED_SUSPECTED_MISREPORT`).

### 5.3 Audit of admin access (new)

`platform_ops.admin_reads` (migration `20261231598100_platform_ops_admin_reads.sql`) records every console read that returns person-level or organisation-level data:

- columns: actor, role, permission used, surface, resource type and id (nullable for list views), a hash of the filter, row count and `occurred_at`;
- append-only: inserts only, with no update or delete grant even for the service role (enforced by a trigger);
- RLS on, no client grants, retained for 2 years;
- shown in Access log and on each person's 360 ("who looked at this account").

Writes stay in `platform_ops.admin_actions`. Domain changes stay in `audit.material_actions`.

### 5.4 Data access path

- All admin tables and new ledgers are server-only: RLS enabled, `revoke all` from `anon` and `authenticated`.
- The API reads them through `packages/platform-admin` functions that take an `AdminGrant`. The type can only be produced by `authorize()`.
- pgTAP tests cover each table:
  - an anonymous or authenticated client is denied;
  - an ordinary member of the owner's organisation is denied;
  - a revoked admin is denied on the next request.

## 6. The facilitation ledger

### 6.1 Rounds made obvious (founder and investor UI)

- **Founder:** the capital page leads with a **round switcher**: each round's name, instrument, target, and progress through stages (soft, hard, sent, received). Rounds are never mixed in one bar. A new commitment defaults to the current round. When the company has more than one OPEN round, Q asks which one.
- **Investor:** the relationship page shows the round their commitment counts toward.
- **Fix:** 0 of 7 production commitments carry `round_id`. Slice L1 finds why the default attach is not reaching rows. No backfill: past rows stay unattributed (unknown stays unknown) until a party picks a round.

### 6.2 The stages (owner's words mapped to existing columns, no rename)

| Owner's word | Data                                                                      | Who acts                                           |
| ------------ | ------------------------------------------------------------------------- | -------------------------------------------------- |
| Soft         | `level = SOFT`, status STATED, then CONFIRMED                             | Either side states it; the **other** side confirms |
| Hard         | `level = FIRM`, status CONFIRMED (signed terms optional via `deal_terms`) | The other side confirms                            |
| Sent         | status TRANSFER_SENT plus one or more `commitment_transfers` of kind SENT | Investor side                                      |
| Received     | status RECEIVED plus one or more `commitment_transfers` of kind RECEIVED  | Company side                                       |

The existing `INVESTED` level stays for history. The fee basis moves to RECEIVED (§6.5).

### 6.3 New data

**`network.commitment_transfers`** (migration `20261231598300_network_commitment_transfers.sql`)

- Append-only tranches; one commitment may arrive in several.
- Columns:
  - `id`, `tenant_id`, `commitment_id`, `relationship_id`;
  - `kind` (SENT or RECEIVED), `side`, `actor_user_id`;
  - `amount numeric`, `currency_code`, `value_date`;
  - `reference` (free text, at most 120 characters), `evidence_document_id` (nullable; it must be a CLEAN `evidence.document_versions` row, enforced by a trigger);
  - `provider_confirmation_id` (nullable, §6.4 level 4);
  - `idempotency_key`, `created_at`.
- No update; a correction is a new row with `corrects_transfer_id`.
- RLS: readable by the two parties to the relationship, which is the same policy shape as `network.commitments`.

**`network.commitment_amendments`** (same migration)

- Clauses and changes: `commitment_id`, `proposed_by_side`, `kind` (AMOUNT, CURRENCY, INSTRUMENT, CLAUSE, NOTE), `before` and `after` as typed jsonb validated by Zod, `note`, `document_id`, `acknowledged_by_user_id` and `acknowledged_at`.
- An amendment to the amount or instrument takes effect on the commitment only when the **other** side acknowledges it. Until then, both values coexist and the lifecycle is DISPUTED.
- Notes are relationship-shared, so both parties see them.

**`network.commitment_corroboration`** (a view, not a table)

- Computes `evidence_status` per commitment on the ADR-001 axis:
  - `SELF_REPORTED`: one side only;
  - `MULTI_SOURCE_SUPPORTED`: both sides confirmed;
  - `DOCUMENT_SUPPORTED`: both sides, plus a CLEAN evidence document on the RECEIVED transfer or a signed `deal_terms`;
  - `EXTERNALLY_VERIFIED`: a payment-provider or bank confirmation matches.
- It also derives `lifecycle_status` (CURRENT, DISPUTED or CONTRADICTORY), the sums sent and received, and the variance.
- It is deterministic SQL, with no model.

**Domain events, written through the outbox:** `commitment.transfer_recorded`, `commitment.amendment_proposed`, `commitment.amendment_acknowledged` and `commitment.reconciliation_flagged`. Each also becomes a `relationship_events` row, so the relationship projection stays the single history.

### 6.4 Anti-misreporting

**Threats**

- An investor claims to have sent money that was never sent.
- A company under-reports what it received, to shrink a fee.
- Both sides collude so that nothing appears received and no fee is due.
- The amounts are inflated to look good.

**Layers (each one raises the grade; none is required to record)**

1. **Two sides, two people.**
   - The investor's side records SENT. Only the company's side can record RECEIVED.
   - The confirming user must belong to the other party (the existing `partyOf` check; DB check: `actor ≠ stated_by`).
   - Neither side can confirm its own statement.
2. **Matching.**
   - Received and sent are compared by amount, currency, reference and date.
   - A mismatch over 0.5% or across currencies is CONTRADICTORY. Both values are kept, never "picking the favourable number".
   - It goes to Reconciliation and Q asks both sides (§6.7).
3. **Documents.**
   - Either side may attach a transfer confirmation: a bank advice, a SWIFT MT103 or UETR, a wire receipt or a signed closing statement.
   - Each is ClamAV-scanned (CLEAN only) and stored as relationship-shared evidence.
   - Q may _read_ the reference and amount and propose them as `USER_CLAIM`. A person confirms (the Write Gate). Q never upgrades the grade by itself.
4. **External confirmation (optional, later).**
   - Capital Q never holds or moves investment money (doc 10 §14).
   - Through a new `TransferVerificationProvider` port, the company may consent to a read-only bank feed (open banking: TrueLayer in the UK and EU, Plaid in the US, Mono in Nigeria). A credit matching amount, currency and a reference window marks the transfer `EXTERNALLY_VERIFIED`.
   - Alternatively, an escrow or closing platform's signed webhook can do the same.
   - It stays off until the owner chooses (§15 Q6).
5. **Signals that should not exist** (admin Reconciliation only, never shown to the other party):
   - `reported_raised_amount` on the round is greater than the sum RECEIVED in the round;
   - `deal_closes` is recorded but no RECEIVED exists;
   - FIRM commitments are older than 60 days with no SENT;
   - SENT is older than 14 days with no RECEIVED or dispute;
   - the company announces the round closed (round status CLOSED) while a FIRM commitment is still open.

   Each produces a flag with a reason code. An operator reviews it (`money.reconcile`), adds a note, and may refer it to the parties. **It never changes the parties' facts** and never infers that money was or wasn't sent.

6. **Contract.** The facilitation terms (accepted in-product, versioned, and recorded in the compliance register) give Capital Q a right to request closing evidence. A reconciliation referral cites that clause.

### 6.5 Fee ledger v2

Migration `20261231598400_billing_fee_schedule_v2.sql` makes these changes:

- **Per-party rates.** `billing.fee_schedules` gains `company_rate_bps`, `investor_rate_bps` and `basis` (RECEIVED by default). `payer_side` and `rate_bps` remain for v1 rows.
- **Negotiated rates.** A new `billing.fee_rate_overrides` table: an organisation, a side, a rate, the effective dates, who set it and why. It is append-only and owner-only.
- **Entries.** `billing.fee_entries` gains `side`, `transfer_id` (the RECEIVED tranche that accrued it), `evidence_status_at_accrual` and `invoice_id`. There is one entry per side per received tranche.
- **Accrual** stays a deterministic job: exact `numeric`, `round(amount × bps / 10000, 2)`, never a float.
  - It accrues only when the commitment is CONFIRMED by the other side **and** a RECEIVED tranche exists.
  - An entry below `MULTI_SOURCE_SUPPORTED` is held as `PENDING_CORROBORATION`, recorded but not invoiceable.
  - A correction that reduces a tranche adds a reversing entry; nothing is silently overwritten.
- **Status:** `RATE_NOT_SET`, `PENDING_CORROBORATION`, `ACCRUED`, `INVOICED`, `PAID`, `VOID` or `WRITTEN_OFF`.

### 6.6 Money dashboard (Admin → Money)

**Tiles**, per currency, for the selected period:

- capital confirmed (hard), sent and received;
- the share of received money that is `MULTI_SOURCE_SUPPORTED` or better;
- fees accrued, invoiced and paid, per payer side;
- open reconciliation flags.

**Leaderboards**, which follow the analytics privacy settings for names:

- investor organisations by capital received;
- companies by capital received;
- rounds by progress toward target;
- origins (Discover, GateQ, Search, Recommended, Q, Direct) by capital received and conversion;
- fee revenue by organisation.

**Currency handling**

- Figures are per currency by default.
- An optional "≈ USD" column uses a stored `billing.fx_rates` reference row (date, pair, rate, source) and is labelled as an estimate. It is never used for fees.

### 6.7 How Q asks (Prepare → Recommend → Human approval → Execute)

**Triggers**

- the meeting-notes commitment signals (already extracted, status DETECTED);
- a chat turn the turn-reader marks as a money statement;
- a stage gap from §6.4.5;
- a party's own words to Q.

**What Q says, to that person only, in the relationship or Q chat:**

- "You told Ada you'd commit $250,000 to the Seed. Shall I record that as a soft commitment?"
- "Your $250,000 commitment to Northwind is confirmed. Has the transfer been sent? You can add the bank reference or the confirmation."
- To the company: "Ridgeline says $250,000 was sent on 12 Nov, reference ending 4471. Has it arrived?"

**The action**

- Q prepares a typed `app-actions` action: `commitment.record`, `commitment.confirm`, `commitment.mark_sent`, `commitment.mark_received` or `commitment.propose_amendment`.
- The person approves the exact payload (amount, currency, round, reference, clause note).
- Changing the payload requires re-approval. Each action has an idempotency key.
- Q never marks anything sent or received by itself, and never on the other party's behalf.

**Notes on clauses and changes:** when the person mentions a clause ("pro-rata dropped", "now $200k, side letter on board seat"), Q drafts a `commitment_amendments` row, and the other side acknowledges it.

**Founder-private data:** it never enters the investor's prompt. Q's context for these turns holds only relationship-shared data.

## 7. Plans and entitlements

### 7.1 The conflict to flag first (§15 Q2)

The owner asks for tiers on **text** and **meetings**. PADL #85 and Decision #106, encoded in `NEVER_GATED_CAPABILITIES`, forbid gating Q answers, meetings and commitments. Not redesigning, this design proposes:

- **Text (Q answers) and meetings stay available on every plan.**
- Plans set **fair-use allowances** for them as plan VALUES (ADR 0036 style), never as access gates. The free floor is no lower than today's safety limits (300 Q runs a day, 20 a minute).
- The model-heavy _extras_ inside those modalities are gated features: research, rehearsals, Q's meeting assistant minutes, the video avatar and live voice.
- Lowering the free floor below today, or gating answers or meetings outright, needs a PADL amendment.

### 7.2 Modalities and features (reference data, new rows; no enums)

Migration `20261231598500_billing_modalities_and_cycles.sql`.

| Modality         | Feature key                                                              | Kind              | Meter source                                               |
| ---------------- | ------------------------------------------------------------------------ | ----------------- | ---------------------------------------------------------- |
| Text             | `q.text.daily_runs`                                                      | VALUE (fair use)  | `q_runtime.runs` (already counted for the 300/day limit)   |
| Text             | `q.research` (exists)                                                    | MONTHLY           | `billing.usage_events`                                     |
| Voice            | `q.voice.speech_lines_daily`                                             | VALUE             | new persisted meter (§8)                                   |
| Voice            | `q.voice.live_minutes`                                                   | MONTHLY (minutes) | new persisted meter                                        |
| Visuals & tables | `documents.ai_images` (exists)                                           | MONTHLY           | `billing.usage_events`                                     |
| Visuals & tables | `q.visuals.charts_tables`                                                | MONTHLY           | `billing.usage_events` (Q-generated chart/table artefacts) |
| Meetings         | `meetings.q_assistant_minutes`                                           | MONTHLY (minutes) | meeting bot minutes (new meter)                            |
| Meetings         | `meetings.concurrent` (from `video_allowance_config.meeting_concurrent`) | VALUE             | existing config                                            |
| Video            | `video.avatar_minutes`                                                   | MONTHLY (minutes) | `billing.video_usage_ledger` SETTLED minutes               |
| Video            | `q.rehearsals` (exists)                                                  | MONTHLY           | `billing.usage_events`                                     |

Plan rows carry their limits per feature (`billing.plan_features.limit_value`). Changing one creates a new plan version (`plans.write`, step-up, audited).

### 7.3 One check, four layers

The order is fixed:

1. kill switch (`platform_ops.feature_flags`);
2. **platform safety cap** (env, from 52b7cef61: per-person Q runs per minute and per day, voice starts, service-wide speech and research caps);
3. **plan entitlement** (`billing.consume` or `check`);
4. **pool spend cap** (§8.2).

- The effective limit is `min(plan value, safety cap)`. A plan can never lift a person above the safety cap. Raising a safety cap stays an operator environment change.
- Refusals keep their existing shapes and wording:
  - `RATE_LIMITED` 429 for safety;
  - `ENTITLEMENT_REQUIRED` 402 for plan;
  - degraded paths for pool caps.
- The console's Entitlement refusals page counts each refusal by layer.

### 7.4 Subscriptions per person or organisation

The same migration adds columns to `billing.subscriptions`:

- `billing_interval` (MONTH, YEAR);
- `current_period_start` and `current_period_end`;
- `seats`, `trial_end` and `organisation_id` or `user_id`;
- `latest_invoice_id`.

It also adds `billing.invoices`, a mirror of provider invoices from webhooks: id, account key, amount due and paid (`numeric`), currency, status, hosted URL, period and `created`.

The billing account rule is unchanged: the server-resolved organisation, or the person alone.

## 8. Spend: one ledger for every provider, pools later

### 8.1 The ledger

Migration `20261231598200_ai_ops_service_usage.sql` adds `ai_ops.service_usage`, append-only.

- **Columns:**
  - `tenant_id`, `user_id` (nullable for system work), `organisation_id`, `account_key`;
  - `provider_id` (`ai_ops.providers`, adding rows for speech, transcription, research, meeting bot, video and email vendors);
  - `service_class` (reference data: `SPEECH`, `TRANSCRIPTION`, `RESEARCH`, `MEETING_BOT`, `VIDEO_AVATAR`, `EMAIL`);
  - `units numeric` and `unit` (chars, seconds, calls, minutes, messages);
  - `cost_amount numeric`, `cost_currency` (USD today) and `cost_basis` (`PRICE_SNAPSHOT`, `ESTIMATED` or `UNPRICED`);
  - `correlation_id` and `occurred_at`.
- **Prices** come from a new `ai_ops.service_prices` table (versioned).
- **Writers:** the speech synthesis and transcription adapters, the research breaker, the meeting-assistant service, the Tavus reservation settle (which also keeps writing `video_usage_ledger`) and the email transport. Each writes one row per billable call, after the call, outside any transaction (fire-and-forget through the outbox job, idempotent on the correlation id).
- **Caps move to the database.** The in-memory speech and research counters are replaced by counts over this ledger, so caps survive restarts and become attributable. The environment variables keep the limit values.
- **The Spend page** unions `ai_ops.model_usage` and `ai_ops.service_usage`. It shows our total per provider and per person or organisation, and UNPRICED rows separately.

### 8.2 Pools

The same migration adds:

- `ai_ops.spend_pools`: key, name, `daily_cap_amount numeric`, `monthly_cap_amount numeric`, currency, `is_default`;
- `ai_ops.spend_pool_members`: account key, pool id, from and to dates, append-only.

**Today** there is one default pool, `shared`, whose cap equals `CQ_MODEL_DAILY_SPEND_CAP_USD`, so behaviour is unchanged.

**Later** the owner moves accounts into pools, for example per plan or per enterprise customer (`spend.pools.write`). The gateway's daily cap check reads the actor's pool. The OPS_CHECK `MODEL_SPEND_NEAR_CAP` finding becomes per pool.

## 9. Collecting money

### 9.1 Subscription provider

| Option                                          | Fit                                                                                                                                                      | Verdict                                                                                            |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Stripe Billing** (adapter already built)      | Checkout, Portal, proration, trials, seats, Stripe Tax, invoices, bank transfers, many currencies. No SDK needed: the REST adapter exists and is tested. | **Recommended.** Turning it on needs only the owner's account, keys and prices (billing.md §10.4). |
| Paddle (merchant of record)                     | Handles global sales tax and VAT as the seller of record. Weaker for B2B invoicing of facilitation fees, and less control.                               | An alternative if the owner wants no tax registration work; it would need a second adapter.        |
| Chargebee or Recurly                            | A subscription layer on top of a gateway.                                                                                                                | Overkill at this stage.                                                                            |
| Paystack (local cards and transfers in Nigeria) | NGN collection, if Nigerian customers must pay in naira.                                                                                                 | Add as a second `BillingProvider` adapter only if the owner needs NGN (§15 Q5).                    |

The port is unchanged: `createCheckout`, `createPortal` and `verifyWebhook`. Slice B2 adds `listInvoices` mapping for the mirror and handles the `invoice.*` and `customer.subscription.*` webhook types.

### 9.2 The flow

1. A person chooses a plan on `/settings/plan`.
2. Stripe's hosted Checkout takes the payment; Capital Q never sees a card.
3. A webhook updates `billing.subscriptions`, `billing.invoices` and `billing.plan_assignments` (source PROVIDER).
4. Entitlements follow.
5. Dunning is Stripe's Smart Retries. On `past_due`, the account keeps access for a grace period (default 7 days), then falls back to the launch or free plan. It is never locked out of never-gated capabilities.

### 9.3 Facilitation-fee invoicing (slice B3, **blocked on legal**)

**Process**

1. ACCRUED fee entries for an organisation and period are batched into a **draft** `billing.fee_invoices` row: lines are fee entries, amounts are `numeric` per currency, and the row has a `payload_hash`.
2. The owner reviews it and approves the exact payload (`billing.invoices.issue`, step-up). A changed payload requires re-approval. It carries an idempotency key.
3. A job creates a Stripe invoice (`collection_method=send_invoice`, bank transfer, net 30) and records the provider id.
4. Payment webhooks mark entries PAID.

**Alternative:** export to accounting (Xero or QuickBooks CSV) instead of Stripe.

**Guardrails**

- A feature flag `billing.fee_invoicing` stays **off** until a legal sign-off is recorded in the compliance register (§11).
- An entry below `MULTI_SOURCE_SUPPORTED` cannot be invoiced.

### 9.4 Licence flag

A fee that depends on capital raised can be transaction-based compensation:

- in the US, a possible broker-dealer registration issue (Exchange Act §15(a));
- in the UK, possibly "arranging deals in investments" (RAO art. 25) and the financial promotion rules;
- in Nigeria, possibly capital market operator registration;
- elsewhere, EU MiFID-equivalent questions.

Options the separate legal document should weigh:

- a licence or exemption;
- an appointed-representative arrangement;
- moving to flat platform or subscription fees that do not depend on the raise.

**Until then, the ledger records and computes only. Nothing is invoiced.**

## 10. Analytics

**Rule:** derive first.

- Business metrics come from domain tables. Examples: sign-ups from `identity.user_profiles`; activation from onboarding completion; interest, meetings and commitments from `network.*` and `communication.*`; revenue from `billing.*`.
- Analytics events cover only behaviour that no domain table records.

### 10.1 New `analytics.product_events`

Migration `20261231598700_analytics_product_events.sql`.

- **Columns:** `id`, `event_name` (it must exist in `analytics.event_definitions`, which holds the name, version, a JSON-schema reference, the owner and whether it is enabled), `event_version`, `occurred_at`, `recorded_at`, `tenant_id`, `actor_key` (an HMAC of the user id with a key held server-side; never an email or name), `organisation_type`, `surface`, `properties jsonb` (Zod-validated per event on the server, an allow-list of keys, with no free text), `client_event_id` (for dedupe) and `session_id`.
- **Rules:**
  - Retained for 13 months.
  - RLS on, no client read, recorded only through an API endpoint that validates the event.
  - First-party only, with no third-party trackers.
  - The analytics privacy settings are honoured.

**First events**

- `app.page_viewed {route_key}`
- `q.turn_started {modality: text|voice|video}`
- `q.modality_switched {from,to}`
- `q.answer_rated {thumb}` (from the existing thumbs feature)
- `entitlement.refusal_shown {feature_key, layer}`
- `plan.page_viewed`
- `checkout.started {plan_key}` (the outcome comes from webhooks)
- `onboarding.step_viewed` and `onboarding.step_skipped {step_key}`
- `discover.filter_used {filter_key}`
- `capital.round_switcher_used`
- `reminder.offer_shown` and `reminder.offer_accepted`
- `admin.area_viewed {area}`, kept separate from `admin_reads`, which is audit

### 10.2 Business analytics page

- **Funnels**, per side:
  - founder: signed up → onboarded → first Q answer → profile live → first interest → first meeting → first commitment → first RECEIVED;
  - investor: signed up → mandate captured → first feed → first interest → meeting → commitment.
- Retention by weekly cohort.
- Feature adoption by modality.
- Entitlement refusals compared with upgrades.
- Q answer thumbs by capability.
- Cost per active person, from §8.
- "What works / what doesn't": a ranked list of steps with the largest drop-off and of features with high use but poor ratings. It is deterministic, with no model.

## 11. Compliance register

Migration `20261231598800_platform_ops_compliance_register.sql`.

### 11.1 Tables

**`platform_ops.compliance_records`**

- Columns: `record_type` (reference data: `LEGAL_OPINION`, `LICENCE`, `DPA`, `SUBPROCESSOR`, `DPIA`, `POLICY_VERSION`, `INCIDENT`, `DSAR`, `RETENTION_RUN`, `FACILITATION_TERMS_VERSION`, `CONFLICT_DISCLOSURE`), title, status, owner, effective and review-due dates, an evidence document (ClamAV CLEAN) and a note.
- It is revisioned: `compliance_record_revisions` is append-only.
- Permissions: `compliance.write` to write, `compliance.read` to read.

### 11.2 The page

Alongside the register, the page shows read-only roll-ups of existing records:

- verification and KYB decisions, suspensions, account deletions and data exports;
- consent and suppression counts (§12);
- break-glass requests and reads;
- admin actions, admin reads (§5.3), malware blocks and Q firewall denials.

It also shows items due for review.

## 12. CRM and our own email outreach

### 12.1 Schema `outreach`

The schema is server-only, with RLS on and no client grants. Migrations are `20261231598900_outreach_contacts_consent.sql` and `20261231599000_outreach_campaigns.sql`.

- **`outreach.contacts`:**
  - `id`, `email` (stored for sending, restricted to the sender job and `crm.read`), `email_hash`, name, organisation name, role;
  - `source` (`PLATFORM_USER`, `IMPORTED_LIST`, `MANUAL`, `INBOUND`), `user_id` when they are a platform user, `country_code` and `created_by`.
  - An imported list must record its provenance.
- **`outreach.consents`:** append-only. Fields: the contact, `purpose` (`MARKETING`, `PRODUCT_NEWS`, `EVENTS`), `lawful_basis` (`CONSENT`, `LEGITIMATE_INTEREST_B2B`, `EXISTING_CUSTOMER_SOFT_OPT_IN`), the wording version shown, `captured_via` and `captured_at`, and `withdrawn_at`. The current state is the latest row.
- **`outreach.suppressions`:** global, keyed by `email_hash`. Reasons: `UNSUBSCRIBED`, `HARD_BOUNCE`, `COMPLAINT`, `MANUAL` or `DO_NOT_CONTACT`. It applies to every campaign forever, and a re-import never clears it.
- **`outreach.campaigns`:** name, segment definition (a typed filter, never SQL), subject and body versions, `payload_hash`, status (DRAFT, APPROVED, SCHEDULED, SENDING, SENT or CANCELLED), `approved_by` and `approved_at`.
- **`outreach.sends`:** campaign, contact, idempotency key, status, provider message id, opened and clicked flags (if tracking is enabled; off by default) and `unsubscribed_at`.

### 12.2 Rules

**Separation from transactional email**

- Transactional email stays in `platform_ops.email_deliveries` and the existing sources.
- Marketing goes from a **separate sender subdomain**, so complaints cannot harm sign-in and notice delivery.

**Unsubscribe**

- Every message carries `List-Unsubscribe` (https plus mailto) and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058, as the Gmail and Yahoo bulk-sender rules require).
- It also carries a visible unsubscribe link backed by an HMAC-signed token, with no sign-in needed.
- Unsubscribing takes effect immediately, well within the 2-day expectation.
- Messages also include a postal address and identify the sender.

**Platform users**

- Their marketing preference lives in `communication.notification_settings`, as a new `marketing_email` key that is off by default. Marketing email is never mixed with product notices.

**Who may be emailed**

- The segment builder excludes anyone without a valid basis for the purpose and anyone suppressed. This is a server check, not a UI filter.
- UK PECR and EU ePrivacy: emailing individuals (consumers and sole traders) needs consent or the soft opt-in for existing customers. Corporate addresses may use legitimate interest with an opt-out.

**Sending**

- Q may draft copy through the Model Gateway on a request from an admin.
- A human with `crm.send` approves the exact payload (step-up). A changed payload requires re-approval.
- A worker job sends in batches through the existing Brevo transport with idempotency keys.
- Bounces and complaints flow back by webhook into suppressions.

**PII**

- Email addresses never appear in logs, analytics or model prompts. Q drafts from the campaign brief, not the contact list.

## 13. Investor reminders: "Q remembers what you said you'd do"

Migration `20261231599100_communication_undertakings.sql`.

### 13.1 The table: `communication.undertakings`

- **Columns:**
  - `id`, `tenant_id`, `owner_user_id` (who said it), `relationship_id` (nullable) and `meeting_id` (nullable);
  - `source` (`MEETING_NOTES`, `RELATIONSHIP_CHAT`, `Q_CONVERSATION` or `PERSON`), `source_ref` and `quote` (at most 280 characters, from the person's own words);
  - `what`, `due_on` (nullable; an unknown due date stays null);
  - `truth_class` (`USER_CLAIM` when they told Q directly, `Q_INFERENCE` when detected) and `status` (`DETECTED`, `CONFIRMED`, `DONE`, `DROPPED` or `EXPIRED`);
  - `reminder_id` (pointing to `communication.reminders`), `idempotency_key`, `created_at` and `updated_at`.
- **Visibility:** `personal_private` to the owner.
  - An undertaking the investor made to a founder is **never** shown to that founder, nor used in ranking or the founder's view.
  - The founder may have their own, separate undertakings.
  - RLS: the owner only.

### 13.2 How it is filled

The sources are:

- the meeting-notes `followUps`, attributed to a speaker;
- the turn-reader on the investor's own relationship chat turns;
- the person telling Q.

Detection writes `DETECTED` through the Write Gate. Q then asks: "In Tuesday's call you said you'd send Ada the term sheet by Friday. Shall I keep that and email you a reminder Thursday morning?"

### 13.3 What happens on approval

- The undertaking becomes `CONFIRMED`.
- The existing `propose_reminder` action, with channel `EMAIL`, is approved in the same step.
- The existing reminders worker sends it.

### 13.4 Limits

- Q never emails the founder on the investor's behalf from this flow.
- Q never nags more than once per undertaking unless asked.
- After the date passes, Q asks once: "Did that get done?" The answer becomes `DONE` or `DROPPED`.

### 13.5 Where it shows

- the investor's "Waiting on you" list (the existing tool);
- the relationship page (their side only);
- the Admin view, as counts only.

## 14. Implementation slices (in order; each one independently shippable)

Every slice follows the release lane in START-HERE: targeted tests, root `tsc`, eslint and prettier, then `ci-local` PASS, then a migration applied before code, then `deploy-promote`. Each slice also includes pgTAP for new tables (positive, cross-tenant negative, revoked grant) and a permissions-version bump with its test.

1. **S1: Console shell and audited reads.**
   - Regroup into 8 areas; add the Today home and the "Capital Q admin" entry in the switcher (§4).
   - Add `platform_ops.admin_reads` (`…598100`) and permissions v6 (read permissions only).
   - Done: the owner reaches the console from Zino Aviation's shell; an ordinary Zino member gets a 404; every person-level read writes one audit row.
2. **S2: Documents and scanning, and the access log.**
   - Read models over `evidence.document_versions`, upload requests, diligence views, data-room grants and break-glass reads. No migration.
   - Shows metadata only, and blocked files with signature names.
3. **S3: Spend ledger and pools.**
   - Add `ai_ops.service_usage`, `service_prices`, `spend_pools` and `spend_pool_members` (`…598200`), with writers in speech, transcription, research, meeting bot, video and email.
   - Move the speech and research caps to database counts.
   - Add the Spend, Pools & caps, and per-person pages.
   - The single `shared` pool keeps behaviour unchanged.
4. **S4: Video and meetings.**
   - Pages over `video_usage_ledger` (test and real separated), meetings and meeting-bot minutes. Reads S3 for cost.
5. **L1: Rounds made obvious, and the round-attach fix.**
   - Founder round switcher, investor round label, and Q asking which round. Find and fix the 0/7 `round_id` gap. No backfill.
6. **L2: Transfers, amendments and corroboration.**
   - Add `network.commitment_transfers` and `commitment_amendments` (`…598300`) and the corroboration view.
   - Add the actions `commitment.mark_sent`, `mark_received` and `propose_amendment` with evidence documents.
   - Q confirmation prompts (§6.7), then the Reconciliation queue with signals and `money.reconcile`.
7. **L3: Fee ledger v2 and the Money dashboard.**
   - Fee schedule v2 with per-party rates, rate overrides and accrual on RECEIVED (`…598400`).
   - The dashboard and leaderboards, and the optional `billing.fx_rates`.
   - Needs the owner's rate and payer choice (§15 Q3), but it ships with `RATE_NOT_SET`.
8. **P1: Plan modalities and the four-layer check.**
   - Feature rows, subscription cycle columns and the invoices mirror (`…598500`).
   - Enforcement order per §7.3.
   - The Plans catalogue, Subscriptions and Entitlement refusals pages.
   - Depends on S3 for the voice and meeting meters.
9. **R1: Investor undertakings and reminders** (`…599100`). Detection, confirmation and the email reminder through the existing tools.
10. **A1: Analytics events and business analytics** (`…598700`). The event registry, the endpoint, the first events, the funnels and the "what works" page.
11. **K1: Compliance register** (`…598800`) with its roll-ups.
12. **C1: CRM contacts, consent, suppression and one-click unsubscribe** (`…598900`). No sending yet; imports and segments only.
13. **C2: Campaigns and sending** (`…599000`). Needs the marketing sender subdomain and its DNS (owner).
14. **B2: Stripe switched on.** The owner's keys and prices, plus invoice and subscription webhook types, the mirror, and dunning and grace periods. Code is ready after P1; it ships when the owner supplies the account.
15. **B3: Facilitation-fee invoicing** (`billing.fee_invoices`, `…599200`). Stays behind the off flag until the legal sign-off is in K1.
16. **S8: Admin subdomain.** Host routing, `__Host-` cookies and an optional IP allowlist.

**Migration names.** These are placeholders after the current tail (`20261231597000`). Re-check `ls supabase/migrations | tail` before creating one, and keep the strict ordering.

## 15. Open decisions for the owner

1. **Conflict of interest.** The platform owner also invests through Zino Aviation, and the money dashboard shows deal amounts across the network. Is the proposed separation and disclosure (§4) acceptable, or should money views be limited to aggregates for the owner and kept in full for a non-investing operator?
2. **Text and meetings tiers against PADL #85 and Decision #106.** Is the proposal right: fair-use allowances only, with model-heavy extras gated? Or does the owner want a PADL amendment to gate them?
3. **Fee terms.** The rate per side, what it is charged on (received money is proposed), negotiated overrides, and the corroboration needed before invoicing (`MULTI_SOURCE_SUPPORTED` is proposed).
4. **Legal.** A success-fee licence opinion and its jurisdictions. Until then nothing is invoiced.
5. **Provider.** Stripe (recommended). Is Paystack needed for NGN? Which billing country and entity? Is Stripe Tax wanted?
6. **External transfer verification.** Open-banking consent for companies (by region) or escrow partners: now, later or never?
7. **Analyst pseudonymity.** Should analysts see names, or pseudonymous ids only (proposed)?
8. **CRM.** Which lists may be imported (provenance)? The marketing sender subdomain? Is open and click tracking off (proposed)?
9. **Prices** for plans and modality allowances. billing.md §10.1 is still open.
