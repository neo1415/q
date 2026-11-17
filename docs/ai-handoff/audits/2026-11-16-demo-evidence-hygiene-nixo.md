# Demo evidence hygiene and the Nixo–Savanna relationship (16 Nov 2026)

Directive: [`../directives/2026-11-16-demo-evidence-data-room-seeding.md`](../directives/2026-11-16-demo-evidence-data-room-seeding.md) (Phase 3 rules; Phases 4–5 for Nixo). Defects come from [`2026-11-16-demo-evidence-inventory.md`](2026-11-16-demo-evidence-inventory.md). Authority: decisions 99 and 100.

**Method.**

- Every write went through the product's own HTTP API, made by the owning account. No SQL writes were made; SQL was used read-only, through the management API, to resolve accounts and check results.
- Fictional accounts signed in with the seed password. Each one was re-checked for `app_metadata.fictional_demo = synthetic = true`.
- Nixo's founder signed in through the one-time admin sign-in link that decision 99 allows. No password was read or changed, and no email was sent.
- Nothing was hard-deleted. Withdrawal uses the documents page's soft archive, which `hygiene.mjs restore <id>` undoes.
- No emails, passwords or keys appear in logs or in this file.

Scripts:

- `scripts/seed/evidence/hygiene.mjs` (new): modes `plan`, `apply`, `investor-check` and `restore <id>`.
- `scripts/seed/evidence/relationships.mjs`: adds the `nixo` pair.
- Reports go to `scripts/seed/evidence/out/` (gitignored).

## 1. Hygiene

Marker check before any write: every current member of Tensorgate, Halyard Security, MedTrail, Mizan, Maji Loop, Ajopot and Watchly carries both markers (0 unmarked, null-safe count). Ledgerline, Baridi and Nixo were not written.

### Withdrawn documents (`POST /v1/documents/:id/archive {archived:true}`, as the founder)

| Company          | Document | Title                                 | Why                                                                                           | Before → after                       |
| ---------------- | -------- | ------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------ |
| Tensorgate       | b938175b | Certificate of Incorporation          | Imitation certificate: "This is to certify … Issued by the Delaware Division of Corporations" | ACTIVE (data room PUBLIC) → ARCHIVED |
| Halyard Security | 6986f460 | Certificate of Incorporation          | Imitation certificate: "Companies House (Scotland)"                                           | ACTIVE (PUBLIC) → ARCHIVED           |
| MedTrail         | 0e5b27c6 | Certificate of Incorporation          | Imitation certificate: "Corporate Affairs Commission (CAC), Nigeria"                          | ACTIVE (PUBLIC) → ARCHIVED           |
| MedTrail         | fe90f381 | FIRS Tax Clearance Certificate (2026) | Imitation tax certificate: "This is to certify … Certified true copy"                         | ACTIVE (ON_REQUEST) → ARCHIVED       |
| Mizan            | 36821319 | Certificate of Incorporation          | Imitation certificate: "Commercial Registry, Cairo (via GAFI)"                                | ACTIVE (PUBLIC) → ARCHIVED           |
| Mizan            | da6ceaed | Tax card and tax status certificate   | Imitation certificate: "Egyptian Tax Authority … Certified true copy"                         | ACTIVE (ON_REQUEST) → ARCHIVED       |
| Maji Loop        | 20cb4981 | Maji Loop deck QA 14 Nov              | QA leftover: "(fictional company for testing)"                                                | ACTIVE → ARCHIVED                    |
| Maji Loop        | fa3a911e | Maji Loop deck QA 14 Nov b            | QA leftover                                                                                   | ACTIVE → ARCHIVED                    |
| Maji Loop        | 79f4fc66 | note                                  | QA leftover: "Capital Q demo note. Revenue: 4,800 USD …"                                      | ACTIVE → ARCHIVED                    |
| Ajopot           | 6bbd1352 | acceptance-note                       | QA leftover: "Prepared for the live Capital Q founder acceptance run"                         | ACTIVE → ARCHIVED                    |
| Ajopot           | 1facf3e3 | acceptance-note                       | QA leftover (duplicate)                                                                       | ACTIVE → ARCHIVED                    |

- None of the 11 had a live disclosure policy or GateQ link.
- The document summaries, which describe filings without imitating a certificate, were kept. These are HMRC/SEIS, "Tax filings and Delaware good standing", DSPT, the KYB/KYC packs and NAFDAC.
- Investor check (Savanna, `hygiene.mjs investor-check`): every withdrawn document is absent from its company's data room (HTTP 200, not listed), and `open` answers 404.
- The data-room entry rows stay in the database; the product hides archived documents.

### Renamed: "(fictional)" removed (`PATCH /v1/documents/:id`, all HTTP 200)

| Company   | Before → after                                                                                                                                                                                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Maji Loop | "Maji Loop investor deck (fictional)" → "Maji Loop investor deck"; "… product brief (fictional)" → "… product brief"; "… financial summary, founder claim (fictional)" → "… financial summary, founder claim"; "… company overview (fictional)" → "… company overview" |
| Ajopot    | The same four: investor deck, product brief, financial summary (founder claim) and company overview                                                                                                                                                                    |
| Watchly   | "Watchly investor deck (fictional)", "… product brief (fictional)", "… customer and pipeline summary (fictional)", "… management accounts summary, H1 2026 (fictional)", "… company overview (fictional)": each lost the suffix                                        |

Tensorgate, Halyard, MedTrail and Mizan had no such titles.

### Company legal names (`PATCH /v1/companies/:id`, all HTTP 200)

| Company   | Before                                 | After                      |
| --------- | -------------------------------------- | -------------------------- |
| Maji Loop | Maji Loop Water Ltd (fictional)        | Maji Loop Water Ltd        |
| Ajopot    | Ajopot Digital Savings Ltd (fictional) | Ajopot Digital Savings Ltd |
| Watchly   | Watchly Limited (fictional)            | Watchly Limited            |

Tensorgate, Halyard, MedTrail and Mizan were already clean.

Idempotency: a second `plan` reports every withdrawal as already withdrawn and finds 0 renames and 0 legal-name changes.

Text inside the files themselves (for example "Ajopot acceptance note (fictional)" in the dev-world `.txt` content) cannot be edited through the product, so it is unchanged.

### For the lead (not touched, out of scope)

1. **Imitation certificates on other tavus-20 companies.** 24 active documents (25 on a recount; 21 withdrawn in §4) have certificate text ("This is to certify that"):
   - Akshar, Clearwater Assurance, Cosecha Labs, Drishti Health, Hui and Rand Treasury: 1 each.
   - Ferrolith, Orphéa Genomics, Portside, Prumo, Railhead Robotics, Shiftwell and Termly: 2 each.
   - Silo Credit: 1.
   - Ledgerline (b216ac68, 1d69a69b) and Baridi (dd08b4e0, 3fbcb6c9): read-only by instruction.

   The same `hygiene.mjs` pattern applies once the companies are approved.

2. **"(fictional)" elsewhere on the platform.** It remains in 1,752 active document titles, 409 company legal names and 31 investor display names, including "Savanna Seed Partners (fictional)" and "Thames Arc Capital (fictional)".
   - The seed sources still write it: `apps/q-api/src/dev/fictional-world/companies.ts` (22 occurrences) and `scripts/seed/fictional-bulk/{world,seed}.mjs`.
   - A re-seed would bring it back on these companies.
3. **Maji Loop claim readings.** The 2 completed claim readings came from the withdrawn QA decks. The org-private DOCUMENT_SUPPORTED claims that came from them are unchanged; archiving does not retract claims.
4. **Script bug fixed.** The member marker checks in `relationships.mjs` and `hygiene.mjs` counted an unmarked account (null metadata) as marked, because `not (null)` is null.
   - Both now use `not coalesce(…, false)`.
   - The Halyard and Tensorgate pairs were re-checked with the fixed filter: 0 unmarked members.
   - The investor-side check was already null-safe.

## 2. Nixo ↔ Savanna Seed Partners (decision 99)

Run: `relationships.mjs seed nixo`, then `verify nixo`. Relationship 9c43e508:

| Step                                                                               | Result                                                                    |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Before                                                                             | no relationship row                                                       |
| Savanna expresses interest (`express-interest`)                                    | 201                                                                       |
| Nixo's founder accepts (`incoming-interest`, then `interests/:id/accept`)          | 201                                                                       |
| Savanna records that diligence started (`meeting-outcome DILIGENCE`)               | 201 → IN_DILIGENCE                                                        |
| Request "Customer contract summary" (about contracted $1.08m against billed $864k) | 201; founder fulfils it with `nx-customer-contracts` (201): **FULFILLED** |
| Request "Business bank statements, Aug to Oct 2026"                                | 201: **OPEN** (pending)                                                   |
| Founder data-room grants (view, watermarked, 90 days, filed SHARED_ONLY)           | 9 × 200                                                                   |

Shared with Savanna: the 10 documents the manifest plans to share (`plannedShareWith`):

- `nx-pitch-deck`, `nx-management-accounts`, `nx-revenue-breakdown`, `nx-customer-contracts` (through the request, no expiry), `nx-cohorts-retention`, `nx-customer-concentration`, `nx-cap-table`, `nx-raise-terms`, `nx-projections-2027` and `nx-kpi-pack`.
- Each has one `relationship_shared/view` policy.
- Savanna sees each one listed in the data room, and `open` and the diligence download both answer 200.

Kept private (no policy, not listed, 404 for Savanna): `nx-bank-statement`, which the pending request asks for, so the founder can share it live in scenario D. Also `nx-monthly-actuals`, `nx-invoice-register` and `nx-team-hiring-plan`.

**Negative test (Thames Arc Capital):**

- Nixo's data room answers 200 with none of the 14 documents listed.
- `open` answers 404 and `GET /v1/documents/:id` answers 404 for all 14.
- No other recipient has a policy.
- Verify summary: `IN_DILIGENCE; requests FULFILLED/OPEN; planned shared 10/10; leaks 0`.

## 3. Cost

- Reserved 0.30 USD (ledger id 9a8b314c). Recorded actual: **0.0068 USD**.
- `ai_ops.model_usage` since the reservation (19:01 UTC), across the touched tenants and the two investors: 12 STRUCTURED_EXTRACTION system calls in Nixo's tenant at 19:09:06–19:09:37 UTC, just after the share step.
- Hygiene made no model calls.

## 4. Pass 2 (17 Nov 2026, 03:04–03:20 UTC)

Same method as §1: every write went through the product API as the company's own seeded fictional founder, after the marker check (every current member carries `fictional_demo = synthetic = true`; 0 unmarked on all 14 companies). Read-only SQL through the management API. No email, password or key was printed or written to disk.

### 4.1 Remaining imitation certificates withdrawn

Found read-only: ACTIVE documents whose current version's page text contains "This is to certify that". There were 25, not 24 as §1 said. Each reads "Certified copy … This is to certify that … Certified true copy (specimen)".

- 21 were withdrawn on 14 companies, with `hygiene.mjs apply pass2` (`POST /v1/documents/:id/archive {archived:true}`, each HTTP 2xx).
- Before the writes, none had a live disclosure policy, a GateQ disclosure or application link, or a diligence fulfilment.
- Titles and legal names on these companies were **not** changed: the pass-2 targets are `withdrawOnly`.

| Company              | Document | Title                                                      | Imitates                                                          | Before → after                 |
| -------------------- | -------- | ---------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------ |
| Akshar               | 1a56de97 | Certificate of Incorporation                               | Registrar of Companies, Bengaluru (Ministry of Corporate Affairs) | ACTIVE (PUBLIC) → ARCHIVED     |
| Clearwater Assurance | 03741cbc | Certificate of Incorporation                               | Companies House  England and Wales)                              | ACTIVE (PUBLIC) → ARCHIVED     |
| Cosecha Labs         | 60d01b12 | Certificate of Incorporation                               | Registro Público de Comercio, Guadalajara (Jalisco)               | ACTIVE (PUBLIC) → ARCHIVED     |
| Drishti Health       | 6e07a3e6 | Certificate of Incorporation                               | Registrar of Companies, Pune (Ministry of Corporate Affairs)      | ACTIVE (PUBLIC) → ARCHIVED     |
| Ferrolith            | afabbe8c | Certificate of Incorporation                               | Commercial register, Amtsgericht München                          | ACTIVE (PUBLIC) → ARCHIVED     |
| Ferrolith            | 05e9e258 | Tax clearance certificate (Unbedenklichkeitsbescheinigung) | Tax compliance certificate, Finanzamt München                     | ACTIVE (ON_REQUEST) → ARCHIVED |
| Hui                  | b2059fbe | Certificate of Incorporation                               | Business Registration Office, Ho Chi Minh City                    | ACTIVE (PUBLIC) → ARCHIVED     |
| Orphéa Genomics      | 9eb88054 | Attestation de régularité fiscale and URSSAF certificate   | Tax compliance and URSSAF certificates                            | ACTIVE (ON_REQUEST) → ARCHIVED |
| Orphéa Genomics      | 79202d1c | Certificate of Incorporation                               | Registre du Commerce et des Sociétés  RCS) de Paris              | ACTIVE (PUBLIC) → ARCHIVED     |
| Portside             | fed9cb4e | Certificate of Incorporation                               | Corporate Affairs Commission (CAC), Nigeria                       | ACTIVE (PUBLIC) → ARCHIVED     |
| Portside             | 01c81d0d | FIRS Tax Clearance Certificate (2026)                      | FIRS tax clearance certificate                                    | ACTIVE (ON_REQUEST) → ARCHIVED |
| Prumo                | 4f661872 | Federal tax clearance (CND) and FGTS certificate           | Certidão Negativa de Débitos and FGTS certificate                 | ACTIVE (ON_REQUEST) → ARCHIVED |
| Prumo                | e7e7ea38 | Certificate of Incorporation                               | Junta Comercial do Estado de São Paulo  JUCESP)                  | ACTIVE (PUBLIC) → ARCHIVED     |
| Railhead Robotics    | b26c27c5 | Certificate of Incorporation                               | Delaware Division of Corporations                                 | ACTIVE (PUBLIC) → ARCHIVED     |
| Railhead Robotics    | ed4cc963 | Tax filings and certificates of good standing              | Delaware and Washington certificates of good standing             | ACTIVE (ON_REQUEST) → ARCHIVED |
| Rand Treasury        | 12f37cf5 | Certificate of Incorporation                               | Companies and Intellectual Property Commission (CIPC)             | ACTIVE (PUBLIC) → ARCHIVED     |
| Shiftwell            | 6cdcf26b | Certificate of Incorporation                               | Delaware Division of Corporations                                 | ACTIVE (PUBLIC) → ARCHIVED     |
| Shiftwell            | 16f916e8 | Tax filings and certificates of good standing              | Delaware certificate of good standing                             | ACTIVE (ON_REQUEST) → ARCHIVED |
| Silo Credit          | 24dd8f38 | FIRS Tax Clearance Certificate (2026)                      | FIRS tax clearance certificate                                    | ACTIVE (ON_REQUEST) → ARCHIVED |
| Termly               | a4c02e54 | FIRS Tax Clearance Certificate (2026)                      | FIRS tax clearance certificate                                    | ACTIVE (ON_REQUEST) → ARCHIVED |
| Termly               | 732217a3 | Certificate of Incorporation                               | Corporate Affairs Commission (CAC), Nigeria                       | ACTIVE (PUBLIC) → ARCHIVED     |

- Restorable one at a time: `hygiene.mjs restore <id>`.
- Idempotency: a second `plan pass2` reports all 21 as `already-withdrawn`.
- Investor check (Savanna, `investor-check pass2`): every data room answers 200 with none of the 21 listed, and `open` answers 404 for all 21. SQL: 21/21 ARCHIVED.

**For the lead (not touched, by instruction):** Ledgerline `b216ac68` (Certificate of Incorporation, "Corporate Affairs Commission (CAC), Nigeria") and `1d69a69b` (FIRS Tax Clearance Certificate (2026)). Baridi `dd08b4e0` (Certificate of Incorporation, "Business Registration Service (BRS), Kenya") and `3fbcb6c9` (KRA Tax Compliance Certificate). All 4 are still ACTIVE.

### 4.2 Maji Loop claims from the archived "deck QA 14 Nov" decks

Read-only trace, in this order:

- **Document to source.** `evidence.sources` rows with `metadata.via = document_claims`: `c1cbeb09` for "deck QA 14 Nov" (version `3faa90d1`), and `10009a2b` for "deck QA 14 Nov b" (version `21c9f0be`).
- **Source to evidence item.** Only `10009a2b` produced one: "MRR of USD 42,000 as at 31 October 2026".
- **Evidence item to claims.** It links to 2 claims:

| Claim                                  | What it says                                                                                                                  | Axes                                                                     | Link to the QA deck    | Other evidence                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------- | --------------------------------------------- |
| `23cad797-7c66-4293-8648-b3109b4ed509` | "MRR of USD 42,000 for October 2026, as stated in its own document 'Maji Loop deck QA 14 Nov b' and confirmed by the founder" | USER_CLAIM · DOCUMENT_SUPPORTED · CURRENT, `organisation_private`, rev 1 | SUPPORTS (only source) | none                                          |
| `1c56393d-a3e2-44f2-a7f2-037fa883fafc` | "MRR of USD 120,000 for October 2026, as the founder told Q (self-reported)"                                                  | USER_CLAIM · SELF_REPORTED · CURRENT, `organisation_private`             | CONTRADICTS            | a conversation: "we hit $120k MRR in October" |

Claim cards (`q_runtime.actions`, `app.company.figure.record`):

- EXECUTED: 42,000 for October, from deck b. This is the approval that created `23cad797`.
- REJECTED: 37,500 for September, from deck b.
- EXPIRED: 2 cards from the first deck.
- No card or onboarding suggestion from these decks is pending, so there is nothing to dismiss.

**No supported withdraw route exists, so nothing was changed.**

- The evidence package has `reviseClaim`, which creates a revision with history, but no HTTP route, app action or Q tool calls it.
- The only figure action is `app.company.figure.record`.
- Lead action:
  - `23cad797` should become SUPERSEDED or withdrawn, with history, once a route exists.
  - `1c56393d` is backed by the founder's own words, not by a document, so it stays. Its CONTRADICTS link now points at an archived document.
- Both claims are `organisation_private`, so investors do not see them.

### 4.3 Watchly onboarding suggestions (read, left PENDING)

Watchly's founder onboarding session (COMPLETED) has 3 PENDING suggestions, created at 02:32 UTC from "Management accounts, Apr 2026 to Oct 2026" (document `23e7b1b0`). They were read by deterministic code, with no model.

| Suggestion | Field           | Value   | Fixture (`watchly.json`, October 2026) | Confirmed answer (15 Oct) |
| ---------- | --------------- | ------- | -------------------------------------- | ------------------------- |
| `35ea2425` | monthly revenue | 8,500   | revenue 8,500 ✔                        | none                      |
| `cc01f46b` | monthly burn    | 173,500 | net burn 173,500 ✔                     | 175,000 (September)       |
| `5b2c90ad` | runway (months) | 18.0    | runway 18.0 (3,126,500 / 173,500) ✔    | 20 (the deck's figure)    |

- All 3 are correct figures for October from the synthetic accounts, and none duplicates a confirmed figure.
- Burn and runway are newer than the confirmed September answers. Runway also corrects the deck's 20, which is the pack's deliberate discrepancy.
- Accepting a suggestion supersedes the earlier response, which keeps history. This is the product working, so the 3 are left for the founder to confirm.

### 4.4 Cost

- Reserved 0.10 USD (ledger `fce042e9`). Recorded actual: **0.00 USD**.
- `ai_ops.model_usage` since 03:04 UTC, across the 16 touched tenants: 0 rows.
