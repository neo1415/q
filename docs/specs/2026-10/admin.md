# ADMIN — Capital Q platform admin + per-user Results

Owner: ADMIN worker (branch `build/admin`). Migration prefix `202611150`.
ADR: 0033 (platform operator roles, step-up, break-glass; amends the
"no platform scope" note in `packages/security/src/authorization/resource-scope.ts`
and `docs/escalations/verify-001/README.md` §4).
Builds on: `/admin` (53b5541c), `identity.platform_admins`
(20261031090000/100000), `packages/platform-admin`, `ai_ops.model_usage`,
`@capital-q/audit`, `evidence.verification_claims` (CQ-VERIFY-001, R43),
`communication.reports/blocks` (R34), `q_runtime.runs/run_events`,
`network.commitments`, `q_runtime.rehearsals`, `q_runtime.errands`.

## 1. Goals (founder's words, 2026-10-01)

1. "A Capital Q admin dashboard for the platform itself, with the different
   roles and full functionality, monitoring and auditing of Q — the whole
   package."
2. "A dashboard for each user to monitor the results of their activities here
   and download reports they can actually use in their real businesses."

Lead's brief adds: roles platform_owner / operator / trust_and_safety /
support / analyst (read-only) with step-up for sensitive actions; accounts and
organisations (search, view, suspend/unsuspend with reason; never read private
chats without a logged break-glass reason + a second person where feasible);
verification/KYB queue (replaces R43 auto-verify for real users; synthetic
auto-verify stays for fictional accounts only); R34 reports/blocks queue; Q
monitoring (runs, refusals, failures, latency p50/p95 per task class and
model, cost per day, live error stream, per-run trace with firewall decisions,
content redacted by default); audit search; feature flags / kill switches for
Q autonomy and the Q Daily; email deliverability panel. Everything audited.

## 2. Research (sources)

- **Stripe Dashboard roles** — fixed roles (Owner, Administrator, Developer,
  Analyst, Support Specialist, View only); support can see most data and do
  narrow actions but not settings; view-only reads everything, changes
  nothing. Fixed, few, named roles beat a permission editor for a small team.
  https://docs.stripe.com/dashboard/teams/roles
- **OWASP ASVS 2.26 / MASWE-0029** — re-authentication or step-up before
  application-specific sensitive operations (role elevation, disabling
  security features, exposing sensitive data), at the point of risk, not at
  login. https://owasp-aasvs4.readthedocs.io/en/latest/requirement-2.26.html ,
  https://mas.owasp.org/MASWE/MASVS-AUTH/MASWE-0029/
- **NIST SP 800-63B-4** — reauthentication windows (AAL2: 12 h, 30 min idle;
  AAL3: 15 min idle). We take the strict end for admin actions: a step-up
  lasts 15 minutes. https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-63B-4.pdf
- **Break-glass practice** — separate requester and approver (two people),
  a stated reason, a short window, immutable logs of request, approval, every
  access and expiry. https://docs.akeyless.io/docs/break-glass-access-best-practices
- **Trust & safety / fintech consoles (pattern)** — queue-first (oldest
  first, age shown), one decision per item with a required reason, evidence
  beside the decision, outcome history on the subject; audit log as a
  filterable table (who, under whose authority, what, on what, outcome, when)
  with a detail drawer, never editable.

## 3. Roles and permissions (least privilege)

Roles are reference data (text with a check constraint), one per admin.
Permissions are a versioned code table `ADMIN_PERMISSIONS v1` in
`@capital-q/platform-admin` (no Postgres/TS enum for permissions):

| Permission           | owner | operator | t&s | support | analyst | step-up |
| -------------------- | ----- | -------- | --- | ------- | ------- | ------- |
| overview.read        | ✓     | ✓        | ✓   | ✓       | ✓       |         |
| ledger.read          | ✓     | ✓        |     |         | ✓       |         |
| accounts.read        | ✓     | ✓        | ✓   | ✓       |         |         |
| accounts.suspend     | ✓     | ✓        | ✓   |         |         | ✓       |
| accounts.reinstate_q | ✓     | ✓        | ✓   | ✓       |         | ✓       |
| verification.read    | ✓     | ✓        | ✓   | ✓       |         |         |
| verification.decide  | ✓     | ✓        | ✓   |         |         | ✓       |
| safety.read          | ✓     | ✓        | ✓   |         |         |         |
| safety.decide        | ✓     |          | ✓   |         |         | ✓       |
| breakglass.request   | ✓     |          | ✓   |         |         | ✓       |
| breakglass.approve   | ✓     |          | ✓   |         |         | ✓       |
| q.monitor.read       | ✓     | ✓        |     |         | ✓       |         |
| q.trace.read         | ✓     | ✓        |     |         |         |         |
| audit.read           | ✓     | ✓        | ✓   |         | ✓       |         |
| flags.read           | ✓     | ✓        | ✓   | ✓       | ✓       |         |
| flags.write          | ✓     | ✓        |     |         |         | ✓       |
| email.read           | ✓     | ✓        |     |         |         |         |
| roles.manage         | ✓     |          |     |         |         | ✓       |

- Not an admin → every `/v1/admin/*` route is the same 404 as a missing path.
- Admin without the permission → 404 as well (the console never reveals what
  exists), and the web hides the section; the server is the authority.
- Step-up: the admin re-enters their password in a dialog; the web server
  action signs in again with a non-persisting Supabase client and sends the
  fresh access token to `POST /v1/admin/step-up`. The API verifies it with the
  Auth server (same user), reads its `amr` (password/otp/totp) timestamp
  (≤ 120 s old), and records `platform_ops.step_ups` (15 min). A sensitive
  route without a live step-up answers `STEP_UP_REQUIRED` (403 problem) and
  the UI opens the dialog and retries once.
- Roles are granted/revoked only by a platform_owner with step-up; the last
  platform_owner cannot be removed or demoted; an admin cannot change their
  own role.

## 4. Platform admin (A) — surfaces

`/admin` becomes a console with a left section list (top tabs on phone):
Overview · Accounts · Organisations · Verification · Safety · Q monitor ·
Audit · Flags · Email · Team. Sections the role lacks are not shown.

- **Overview** — existing figures + attribution ledger/disputes/paused
  (unchanged), queue counts (pending verification, open reports, pending
  break-glass), Q failures last 24 h.
- **Accounts** — search by name/email/handle (prefix, ≥2 chars, 25 rows);
  view: profile, memberships and roles, organisations, verification
  standings, Q standing (paused by Q), suspension history, counts (Q runs,
  relationships, documents). Suspend / Unsuspend with a required reason
  (3–500 chars). Never shows chats.
- **Organisations** — search by name; view: kind (company / investor), tenant,
  members (each linking to Accounts), verification standings, relationships
  count. Suspending an organisation = suspending each member account, one
  audited action per person (no hidden org-wide state).
- **Verification queue** — current PENDING claims, oldest first: claim type,
  subject (person / organisation / domain), requester, company website,
  country, evidence source (if any), age. Approve (VERIFIED) or Reject
  (REVOKED with reason) with a decision basis (required, 3–1000 chars).
  Writes `OPERATOR_DECISION` / `CAPITAL_Q_OPERATOR` / `HUMAN` /
  `decided_by_user_id`, the same append-only row, audit and
  `verification.claim.decided` event as the synthetic decider. R43 is
  unchanged: it already offers only synthetic-marked principals and only on
  staging; real users wait in this queue.
- **Safety** — open R34 reports (reason, note, reporter side, relationship,
  age) and active blocks. Decide a report: NO_ACTION / WARNED /
  ACCOUNT_SUSPENDED / ESCALATED with a note; decisions append to
  `platform_ops.report_reviews` (the report row itself is communication's;
  the effective review status is the latest review). Reading the reported
  conversation requires **break-glass**.
- **Break-glass** — request: target (relationship chat or Q run), reason
  (20–1000 chars). A second admin with `breakglass.approve` approves or
  denies; approver ≠ requester (DB check). Where no other eligible admin
  exists (today: one founder), the requester may self-approve only as an
  explicit `SOLO` approval, flagged in the audit log and on the Overview.
  Access lasts 30 minutes from approval; every read is logged
  (`platform_ops.break_glass_reads`). Messages shown read-only, with a
  banner naming the reason and the expiry.
- **Q monitor** — window (24 h / 7 d / 30 d): runs by status, failures by
  code, refusals (firewall DENIED + POLICY_DENIED runs), model calls,
  failure classes, latency p50/p95 per task class × model, cost per day (USD,
  numeric from `ai_ops.model_usage.cost_usd`), live error stream (latest 50
  failed calls/runs, refreshed every 10 s while the tab is visible). Run
  trace: run metadata (capability, status, timings, versions), stage events
  (type + visible stage; payload keys only), model calls (task class, model,
  attempt, latency, tokens, cost, outcome), firewall decisions (outcome,
  reason, allowed labels, denied labels + reasons). Content (objective text,
  message deltas) redacted unless a break-glass for that run is active.
- **Audit** — one table over `audit.material_actions` (who acted, under whose
  authority, actor type human/q/system) and `platform_ops.admin_actions`
  (every console action, role at the time, step-up id, break-glass id,
  reason). Filters: actor, authority, action prefix, resource type/id,
  outcome, date range; cursor pagination (occurred_at, id); CSV export.
- **Flags / kill switches** — `q.autonomy.errands` ("Let Q handle this"
  errands, ADR 0028), `q.autonomy.delegations` (AUTO standing delegations,
  ADR 0030), `q.daily` (the Q Daily: generation and email). Each: on/off,
  who changed it, when, why (required reason), history. Off = no new step
  starts; work in progress stops at its next step boundary. Errands read the
  flag here; AUTO and DAILY read it through `isFlagEnabled(key)` (lead wires
  on merge — see §10).
- **Email** — sender configured (name/address, provider: Brevo API / SMTP /
  none), sender domain and whether it is a free mailbox; DNS checks for the
  sender domain (SPF includes Brevo, DKIM `brevo1/brevo2/mail._domainkey`,
  DMARC policy) cached 10 min; deliveries in the window by source and outcome
  from `platform_ops.email_deliveries` (recipient domain + hash only, never
  the address or body); latest failures.
- **Team** — admins and roles; grant (by account email), change, revoke.

## 5. Per-user Results (B)

`/results` (nav item "Results", both journeys). Date range: 30 d (default),
90 d, 12 months, all time, or custom from/to. Every figure counts recorded
events; unknown stays "—", never 0 when the source is missing.

Founder (company of the active organisation context):

- Raise progress — target (capital objective), confirmed / soft / remaining
  per currency and "in conversation" (connected without a commitment), from
  `commitments.fundraising` (authorised by the company's relationship
  listing).
- Pipeline by relationship state (count per state, list with investor name,
  state, last activity).
- Investor engagement (evidence only): interests received, connections,
  meetings held, profile opens by investors and pitch watches (distinct
  investor organisations; shown as "fewer than 3" below 3 so an individual
  investor's browsing is never exposed). No impressions, no vanity totals.
- Rehearsals over time — each finished rehearsal: date, person rehearsed,
  ratings per dimension (STRONG / SOLID / NEEDS_WORK), no invented numbers.
- Documents made — Q documents by type and date.

Investor (investor organisation of the active context):

- Deal-flow funnel — seen (distinct companies with an impression), saved,
  interest expressed, connected, met (meeting_held), committed (current
  commitments) — each the count of distinct companies in the range.
- Meetings — held and upcoming.
- Q work done for them — completed Q runs by capability, errands run,
  documents prepared.
- Mandate fit of the pipeline — for each pipeline company, the declared
  overlap (stage in range, sectors/geographies in common, via
  `@capital-q/discovery` explicitFit reasons) or "no declared overlap yet"
  (unknown, not negative). Hard exclusions flagged.

Reports: `GET /v1/results/report?format=csv|pdf&from&to` — CSV (one file,
sections as blocks, formula-injection neutralised) and a branded Capital Q
PDF via `@capital-q/deck-render` `documentToPdf` (sections with headings,
body lines; title "Results report — <org> — <range>"). Downloads through the
web (`/results/report.csv`, `/results/report.pdf`), session server-side.

Q tools (registry group RECORDS, INSTANT, OWN_Q_CONVERSATION):

- `get_my_results` (`results.own.summary`) — "how is my raise going",
  "what does my deal flow look like": the same read model, compact.
- `get_my_results_report` (`results.own.report`) — "download my pipeline
  report": returns the PDF/CSV links for the asked range; Q offers them.
- Navigation: a `Results` item in the sidebar and account menu; Q's tools
  return `/results` and the report links. A `RESULTS` voice/turn-reader
  destination needs a new TURN_READER version and is left to the lead
  (shared prompt; see §11).

## 6. Data model (migration 20261115000000_platform_ops_admin.sql)

Schema `platform_ops` — server-only (RLS on, no policy, no grant to
anon/authenticated). All tables append-only except `feature_flags` (current
value; every change appends to `feature_flag_events`) and
`break_glass_requests` (decided once, by trigger).

- `identity.platform_admins` + `role` (default `platform_owner` for the
  existing founder row), `granted_by`.
- `platform_ops.admin_role_events` (GRANTED/CHANGED/REVOKED history).
- `platform_ops.step_ups` (user, method, verified_at, expires_at ≤ 30 min).
- `platform_ops.admin_actions` (audit of every console action).
- `platform_ops.account_suspensions` (SUSPENDED/UNSUSPENDED with reason;
  current = latest per user).
- `platform_ops.break_glass_requests` + `break_glass_reads`.
- `platform_ops.report_reviews`.
- `platform_ops.feature_flags` (seeded) + `feature_flag_events`.
- `platform_ops.q_firewall_decisions` (codes only; no text).
- `platform_ops.email_deliveries` (source, outcome, error class, recipient
  domain, recipient hash).

## 7. Contracts and routes

All under `/v1/admin` (404 for non-admins; 404 for missing permission;
`STEP_UP_REQUIRED` 403 for sensitive writes without step-up): `me` (role +
permissions), `step-up`, `accounts?q`, `accounts/:id`, `accounts/:id/suspension`
(POST), `organisations?q`, `organisations/:id`, `verification/claims`,
`verification/claims/:id/decision` (POST; replay-safe by state: a decided
request is no longer current, so a repeat decides nothing), `safety/reports`,
`safety/reports/:id/review` (POST), `break-glass` (GET/POST),
`break-glass/:id/decision` (POST), `break-glass/:id/messages`,
`q/monitor?window`, `q/errors`, `q/runs/:id`, `audit?…`, `flags`,
`flags/:key` (POST), `email`, `team`, `team` (POST grant/change),
`team/:userId` (DELETE). Plus existing overview/attribution/disputes/paused/
reinstate (reinstate now step-up). `/v1/results` and `/v1/results/report`.
New problem codes: `STEP_UP_REQUIRED` (403), `ACCOUNT_SUSPENDED` (403).

## 8. Authority, firewall and privacy

- Console actions are human operator actions (commercial/integrity
  authority), never Q's. No Q tool touches the console.
- A suspended account: every API request resolves to `ACCOUNT_SUSPENDED`
  (actor-context decorator in api and q-api); the web shows a plain page.
- Firewall decisions are recorded by a decorator around the firewall port in
  q-api (fire-and-forget; recording never blocks or alters a decision).
- Results: only the actor's own organisation context; investor engagement for
  founders is aggregate with the <3 floor; no founder-private data reaches an
  investor's report (investor reports read only the investor's own records,
  relationships and declared company fields used by explicitFit).
- Admin content redaction by default; break-glass reveals chats and Q run
  content, logged per read.

## 9. States, design, tests

- Loading skeletons per section; empty states that say what fills them
  ("No pending verification requests"); error states with Retry. Tokens only
  (`--cq-*`), light + dark, phone + desktop, 44 px targets, tables become
  stacked rows on phone, no colour-only meaning (status words beside dots).
- Tests: platform-admin unit tests (permission matrix, step-up window, solo
  break-glass rule, last-owner guard), api route tests with RBAC negatives
  for every admin route (non-admin 404, role without permission 404,
  sensitive without step-up 403), results reader/CSV/PDF tests, q-tools
  tests, pgTAP for the migration (RLS on, no client grants, append-only,
  approver ≠ requester, single decision, flags seeded).
- Live checks after deploy: founder admin signs in → /admin sections; step-up
  dialog; verification queue on a fictional pending claim; Q monitor figures
  match `ai_ops.model_usage`; /results for a fictional founder and investor;
  PDF/CSV download.

## 10. Lead-owned integration notes

- AUTO: before starting/continuing a delegation step, call
  `platformOps.isFlagEnabled("q.autonomy.delegations")`.
- DAILY: before generating or emailing, `isFlagEnabled("q.daily")`.
- Email senders composed in q-api/workers are wrapped with
  `recordingEmailSender` so deliveries appear in the Email panel.

## 11. As built (2026-10-01)

- Migration `20261115000000_platform_ops_admin.sql`; pgTAP
  `supabase/tests/database/rls/600_platform_ops_admin.test.sql` (24).
- `@capital-q/platform-admin`: permissions v1, access/step-up, accounts,
  verification queue, safety, break-glass, Q monitor, audit search, kill
  switches (+ reader), email panel and delivery log, team, firewall
  recorder. `@capital-q/verification`: `createDecideByOperator`.
- api: `/v1/admin/*` (31 routes, each with RBAC negatives in
  `apps/api/test/admin.test.ts`), `ACCOUNT_SUSPENDED` at actor resolution
  and identity lookup; `/v1/results`, `/v1/results/report`.
- q-api: firewall decisions recorded; suspended accounts resolve to no
  actor; errands gated by `q.autonomy.errands`; operator notice emails
  logged; Q tools `get_my_results`, `get_my_results_report`.
- workers: reminder emails logged.
- web: `/admin` console sections, step-up dialog, `/results` page and
  downloads; `Results` nav item.
- Not done here (lead): wire `q.autonomy.delegations` (AUTO) and `q.daily`
  (DAILY) to `createFlagReader`; a `RESULTS` turn-reader destination;
  copy `SMTP_SENDER`/`BREVO_API_KEY` presence to the api service so the
  Email panel shows the real sender; step-up needs a password sign-in
  (magic-link-only admins cannot step up yet).
