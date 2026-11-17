# Demo evidence and data-room seeding: final report (17 Nov 2026)

Phase 9 output (items 1–11) of the owner directive [`../directives/2026-11-16-demo-evidence-data-room-seeding.md`](../directives/2026-11-16-demo-evidence-data-room-seeding.md). Authority: decisions 99, 100 and 101 (`../DECISIONS.md`), [ADR 0078](../../adr/0078-shared-means-readable.md) (shared means readable) and [ADR 0079](../../adr/0079-founder-reads-own-documents.md) (a founder's Q reads their own documents).

**How this report was built.** Every result below comes from evidence already recorded, with its source named. Nothing was re-run for this report except read-only SQL on 17 Nov 2026 (marked **SQL 17 Nov**), done to confirm current counts. Sources:

- [INV] [`2026-11-16-demo-evidence-inventory.md`](2026-11-16-demo-evidence-inventory.md)
- [UPL] [`2026-11-16-demo-evidence-upload.md`](2026-11-16-demo-evidence-upload.md)
- [REL] [`2026-11-16-demo-evidence-relationships.md`](2026-11-16-demo-evidence-relationships.md)
- [HYG] [`2026-11-16-demo-evidence-hygiene-nixo.md`](2026-11-16-demo-evidence-hygiene-nixo.md)
- [LIVE] [`2026-11-16-demo-evidence-live-scenarios.md`](2026-11-16-demo-evidence-live-scenarios.md)
- [LOG] the `HANDOFF-LOG.md` entry of 16 Nov, 19:20 Lagos
- [LEDGER] `BASELINE-LEDGER-2026-11-12.md` (transaction pooler trial, 16 Nov)
- the manifests and fixtures in `scripts/seed/evidence/`
- `git log 2fdc90b1c..HEAD`

**Naming.** "Halia" in the directive is **Halyard Security** (decision 99). Every company and investor named here is a seeded fictional account, except Nixo. Nixo's founder account belongs to the owner, who authorised seeding it (decision 99).

## 1. Inventory and gaps, before → after

| Measure                                                       | Before (16 Nov, [INV])                              | After                                                                                                           |
| ------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Nixo documents                                                | 0                                                   | 14, including a generated deck ([UPL] Nixo)                                                                     |
| Tensorgate / Halyard active documents                         | 12 each; only the deck was a real document          | 24 each: 13 reconciled synthetic documents added, imitation certificate withdrawn (**SQL 17 Nov**)              |
| MedTrail, Mizan, Ajopot, Watchly, Maji Loop                   | deck, thin summaries or `.txt` financials           | 5–7 synthetic documents added to each: 31 in total ([UPL] compact packs)                                        |
| Embeddings                                                    | 0 rows; semantic retrieval empty                    | 2,607 rows; **0 HIGHLY_CONFIDENTIAL and 0 RESTRICTED chunks embedded** (763 HC chunks held out, **SQL 17 Nov**) |
| Shares from the showcase three to fictional investors         | none                                                | 27 live grants: Halyard 9, Tensorgate 8, Nixo 10 (**SQL 17 Nov**)                                               |
| Relationships between the showcase three and investors        | Savanna↔Tensorgate and Atlas↔Nixo, both DISCOVERED  | Halyard↔Thames Arc, Tensorgate↔Savanna and Nixo↔Savanna, all IN_DILIGENCE                                       |
| An investor's Q reads shared financials                       | no: HIGHLY_CONFIDENTIAL held back from every reader | yes, for the investor holding the grant only (ADR 0078, `4f43012a6`)                                            |
| A founder's Q reads their own financials                      | no                                                  | yes, for current members of the company (ADR 0079, `b156a9cd1`)                                                 |
| GateQ founder correction with history kept                    | MISSING                                             | done on Halyard `0490be41`, which was then submitted ([REL] §5, §8)                                             |
| Imitation official certificates                               | 31 active documents, on 20 companies                | 27 withdrawn by soft archive (6 in pass 1, 21 in pass 2); 4 left for the owner ([HYG] §1, §4.1)                 |
| QA leftovers (Maji Loop, Ajopot)                              | 5 active                                            | 5 archived ([HYG] §1)                                                                                           |
| "(fictional)" in active document titles / investor names      | 1,752 / 31 ([HYG] §1)                               | 2 / 10 (**SQL 17 Nov**)                                                                                         |
| Companies with "(fictional)" in their canonical or legal name | 409 legal names ([HYG] §1)                          | 48 (**SQL 17 Nov**); see §11                                                                                    |

**Gaps in [INV] §7, and where each now stands**

- **Burn and runway from accounts; reconciling deck against accounts.** Answered, with citations (§7, scenarios A–C).
- **Revenue trend, customer concentration, ownership and raise terms.** The documents now exist and are shared for the showcase three (§3). No dedicated live scenario asked about each of these.
- **History of an unanswered diligence request.** Seeded: each relationship has a FULFILLED request and an OPEN one (§2).
- **Nixo facts beyond the public web.** Nixo now has 14 documents, 10 of them shared with Savanna.
- **Still open.** Investor-side chunk retrieval stays `organisation_private` by design (ADR 0041 §3). Reads go through the grant-checked document tools. No document-backed claims are linked to the new documents (§5).

## 2. Company and investor seed matrix

| Company          | Investor              | Relationship (`id`)               |                  Live grants | Diligence requests                                                                      | GateQ                                            | Evidence pack                           |
| ---------------- | --------------------- | --------------------------------- | ---------------------------: | --------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------- |
| Halyard Security | Thames Arc Capital    | IN_DILIGENCE (`d8909e27`)         |                            9 | cap table FULFILLED (`7f46988f`); bank statement OPEN, then FULFILLED live (`838e62bc`) | `0490be41` corrected, SUBMITTED 16 Nov 15:44 UTC | 13 documents (`hs-*`)                   |
| Tensorgate       | Savanna Seed Partners | IN_DILIGENCE (`06367f56`)         |                            8 | customer contracts FULFILLED; bank statements OPEN                                      | existing Savanna applications ([INV] §6)         | 13 documents (`tg-*`)                   |
| Nixo             | Savanna Seed Partners | IN_DILIGENCE (`9c43e508`)         |                           10 | customer contracts FULFILLED; bank statements OPEN                                      | existing Atlas Health application ([INV] §6)     | 14 documents (`nx-*`, including a deck) |
| Ajopot           | Savanna Seed Partners | IN_DILIGENCE (`3fa64633`)         | 6 (1 existing + 5 on 17 Nov) | existing: 3 fulfilled, 1 pending; 17 Nov: cap table FULFILLED, bank statements OPEN     | —                                                | 6 documents                             |
| Watchly          | Savanna Seed Partners | IN_DILIGENCE (`3b5b294f`, 17 Nov) |                            5 | customer summary FULFILLED; bank statements OPEN                                        | —                                                | 6 documents                             |
| Maji Loop        | Savanna Seed Partners | IN_DILIGENCE (`fc01d0fc`, 17 Nov) |                            6 | contract summary FULFILLED; bank statements OPEN                                        | existing QUALIFIED ×2                            | 6 documents                             |
| MedTrail, Mizan  | none planned          | —                                 |                            0 | —                                                                                       | Mizan: an existing Zino Aviation application     | 7 and 6 documents, private              |

Relationship states and grant counts: **SQL 17 Nov**. The steps that created them: [REL] §1–3 and [HYG] §2.

**Investor mandates** ([REL] §6). These were **declared** changes only, made by each investor's representative through `PATCH /v1/investors/:id/mandates/:id`.

- Savanna: version 25 → 26, raw text 168 → 516 characters.
- Thames Arc: version 19 → 20, raw text 107 → 453 characters.
- Each gained its decision process and diligence needs, plus 2 `custom.text` constraints.
- Observed behaviour and Q inference were not written; they stay separate.
- Thames Arc's sector does not fit Halyard. That gap was kept, because it is scenario E's case of mandate fit apart from business quality.

## 3. Generated-document inventory

Source: `scripts/seed/evidence/manifests/*.json`. Every document:

- is marked "SYNTHETIC DEMO DOCUMENT", with a watermark and footer;
- uses fictitious banks only;
- has its default visibility set to `organisation_private` (data-room level PRIVATE until the founder shares it).

Sensitivity follows `defaultDocumentSensitivity`: MANAGEMENT_ACCOUNTS, FINANCIAL and FINANCIAL_MODEL are HIGHLY_CONFIDENTIAL (HC), and every other type is CONFIDENTIAL (C).

| Company    |   Docs | Types                                                                                                        |      HC / C | Issued     | Shared now, and with whom (SQL 17 Nov)                                                                                                                                                           |
| ---------- | -----: | ------------------------------------------------------------------------------------------------------------ | ----------: | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Halyard    |     13 | management accounts ×2, financial ×3, customer ×2, commercial, corporate ×2, financial model, operational ×2 |       6 / 7 | 2026-11-13 | Thames Arc, 9 grants: management accounts, cohorts, concentration, cap table (via request), raise terms, projections, KPI pack, bank statement (via request, scenario D), team plan (scenario D) |
| Tensorgate |     13 | the same mix                                                                                                 |       6 / 7 | 2026-11-12 | Savanna, 8 grants: management accounts, revenue breakdown, customer contracts (via request), concentration, cap table, raise terms, projections, KPI pack                                        |
| Nixo       |     14 | the same mix plus a pitch deck                                                                               |       6 / 8 | 2026-11-16 | Savanna, 10 grants: deck, management accounts, revenue breakdown, customer contracts (via request), cohorts, concentration, cap table, raise terms, projections, KPI pack                        |
| MedTrail   |      7 | management accounts, financial ×2, customer, corporate ×2, operational                                       |       3 / 4 | 2026-11-14 | none (no investor planned)                                                                                                                                                                       |
| Mizan      |      6 | management accounts, financial, customer, corporate ×2, operational                                          |       2 / 4 | 2026-11-14 | none (no investor planned)                                                                                                                                                                       |
| Ajopot     |      6 | management accounts, financial ×2, corporate ×2, operational                                                 |       3 / 3 | 2026-11-14 | 5 shared with Savanna (17 Nov); `aj-payout-ledger` private                                                                                                                                       |
| Watchly    |      6 | management accounts, financial, customer, corporate ×2, operational                                          |       2 / 4 | 2026-11-14 | 5 shared with Savanna (17 Nov); `wl-invoice-register` private                                                                                                                                    |
| Maji Loop  |      6 | management accounts, financial, commercial, corporate ×2, operational                                        |       2 / 4 | 2026-11-14 | 6 shared with Savanna (17 Nov)                                                                                                                                                                   |
| **Total**  | **71** |                                                                                                              | **26 / 45** |            | **43 grants** (27 + 16 on 17 Nov)                                                                                                                                                                |

Documents kept private on purpose:

- **Halyard:** monthly actuals, revenue breakdown, invoice register and customer contracts.
- **Tensorgate:** monthly actuals, invoice register, bank statement, cohorts and team plan.
- **Nixo:** bank statement (the pending request), monthly actuals, invoice register and team plan.

Sources: [REL] §2, [HYG] §2, [LIVE] D, and **SQL 17 Nov**.

## 4. Consistency validation

**Validator:** `apps/workers/test/demo-evidence-fixtures.test.ts`. Each document is generated from one deterministic fixture per company (`scripts/seed/evidence/fixtures/*.json`).

**Showcase packs (Tensorgate, Halyard, Nixo).** Assertions:

- eighteen contiguous months of actuals to October 2026, with every line totalled;
- revenue tied to the month's invoices plus documented reconciling items, and invoices well formed;
- cash rolled forward each month (closing = opening + inflows − outflows), with burn and runway derived from the cash flow;
- the balance sheet balances, and its movement equals the period's result;
- the bank statement reconciles to the cash flow;
- every customer count is dated and derived from the customer records;
- ownership sums to 100.00% in the current and pro forma tables;
- projections are kept out of actual periods and sit on the deck's targets;
- the raise terms are printed identically in every document;
- each known discrepancy is planted in exactly the stated documents;
- 8–12 text-native PDFs plus CSVs, every page marked and readable by the workers' parser;
- no "(fictional)" in titles, and nothing imitates an official record or a real bank;
- the render is byte-identical from the same fixture;
- the committed manifest matches the generator.

**Compact packs (the other five).** The same checks, plus:

- every invented field is listed with its value and reason;
- each driven revenue line is built from its driver and price;
- exactly one deliberate deck discrepancy is planted;
- 5–7 files per company.

Recorded run: `bash scripts/heavy.sh npx vitest run apps/workers/test/demo-evidence-fixtures.test.ts` gave **131 passed, 23 skipped**. The skips are `runIf` cases that apply only to particular companies ([UPL] compact packs).

**Planted discrepancies** (fixture `knownDiscrepancies`):

| Company    | Id                        | Deliberate | Deck or profile says                             | Documents say                                                                                             |
| ---------- | ------------------------- | :--------: | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Halyard    | `hs-gross-margin`         |    yes     | Gross margin 82%                                 | 29.3% for the 12 months to Oct 2026; 82.0% is the licence margin (deployment payroll is in cost of sales) |
| Halyard    | `hs-burn-runway`          |    yes     | burn ~70,000; cash 480,000 at 30 Sep; 6.9 months | Oct burn 92,340; cash 388,070 at 31 Oct; 4.2 months                                                       |
| Halyard    | `hs-funding-history`      |     no     | one pre-seed of 600,000 (May 2023)               | advance subscription of 1,500,000 (18 Jul 2025), converting at the seed round                             |
| Tensorgate | `tg-burn-runway`          |    yes     | ~$135,000/month; $1.1m at 30 Sep; 8.1 months     | Oct burn 152,800; cash 948,840; 6.2 months                                                                |
| Tensorgate | `tg-contracted-vs-billed` |    yes     | 2 paid contracts; $360k contracted ARR           | recognised 15,000 a month in Aug–Sep 2026 (one customer billed); 30,000 from October                      |
| Tensorgate | `tg-funding-history`      |     no     | one pre-seed of $1.2m (May 2024)                 | 2,000,000 pre-seed extension on a post-money SAFE (4 Dec 2025)                                            |
| Nixo       | `nx-team-size`            |    yes     | team of 12 (onboarding, 30 Sep 2026)             | payroll 10 at 30 Sep (11 at 31 Oct), plus 2 contract engineers                                            |
| Nixo       | `nx-contracted-vs-billed` |    yes     | contracted ARR 1,080,000                         | Oct subscription revenue 72,000, i.e. 864,000 annualised                                                  |
| MedTrail   | `gross-margin-definition` |    yes     | gross margin 72% (Sep 2026)                      | 42.3%                                                                                                     |
| Mizan      | `burn-and-runway`         |    yes     | ~USD 60,000/month; 10 months (30 Sep)            | 7.6 months at October's burn                                                                              |
| Ajopot     | `active-users-definition` |    yes     | 18,700 monthly active users (Mar 2026)           | 14,960 contributing members                                                                               |
| Watchly    | `runway`                  |    yes     | about 20 months                                  | 18.9 months (3,300,000 / 175,000)                                                                         |
| Watchly    | `crm-pipeline-counts`     |     no     | 2 pilots running                                 | 2 (pipeline export against signed contracts)                                                              |
| Maji Loop  | `kiosks-live`             |    yes     | 96 kiosks live in 2025                           | 88 dispensing at 31 Dec 2025                                                                              |

## 5. Ingestion, extraction, indexing and retrieval

| Batch                                      | Docs | Result                                                       | Model calls / USD                   | Source              |
| ------------------------------------------ | ---: | ------------------------------------------------------------ | ----------------------------------- | ------------------- |
| Tensorgate and Halyard (16 Nov, 06:24 UTC) |   26 | 26/26 COMPLETED on the first attempt, within about 2 minutes | 0 / $0 (ledger `fb8a1098`)          | [UPL]               |
| Nixo (16 Nov, 09:40 UTC)                   |   14 | 14/14 COMPLETED                                              | 2 deck reads / $0.0096 (`a25bd6c5`) | [UPL] Nixo          |
| Five compact packs (17 Nov, 02:30 UTC)     |   31 | 31/31 COMPLETED/COMPLETED                                    | 0 / $0 (`7f344ea3`)                 | [UPL] compact packs |

Every document passed these checks:

- company, tenant and owner organisation match;
- private bucket `cq-documents-private` with a tenant-scoped key;
- extraction in `cq-extractions-private`, run COMPLETED;
- chunk set ACTIVE at `organisation_private`;
- `download_audience` ORGANISATION;
- listed in the founder's API and data-room outline.

Two further points:

- **Malware status is `NOT_SCANNED`.** No scanner is attached in production (ADR 0042). This is expected; files are never described as clean.
- **Every upload declared its type.** So no classification call was made.

**Extraction into the evidence model.** From the new documents: 0 evidence items, 0 claims and 0 claim readings.

- Claim cards run only for decks and company profiles.
- Code read 3 Watchly figures deterministically into onboarding suggestions. They are correct against the fixture and left PENDING for the founder ([HYG] §4.3).

**Indexing.**

- `Q_EMBEDDING_PROVIDER=openai` is set on q-api, and `0c78d4dd2` and `3034088b3` shipped.
- The handoff recorded 2,497 embedded, 0 HC ([LOG]). Today: **2,607 embedded, 0 HC, 0 RESTRICTED** (**SQL 17 Nov**).

**Retrieval paths that Q uses** (all shown in the live runs in §7):

| Path                 | Who                                      | What                                                                                                                                                      |
| -------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR 0078 shared read | the investor holding an active grant     | `company.data_room.read` plus `…document.pages.read`. The grant is checked again at every read, and the result carries `sharedUnder {grantId, expiresAt}` |
| ADR 0079 own read    | a current member of the founding company | `documents.uploaded.list` plus page reads with `ownCompanyRead`. A founder's HC chat attachment followed in `1d89a9c6c`                                   |
| Code-read table rows | both                                     | count tables are extracted by code, and a claim check binds counts to source rows (`9c7b38925`, `827cc7763`, `f410019c4`)                                 |

Investor chunk retrieval is unchanged: chunks stay `organisation_private` (Q Knowledge ≠ data-room disclosure).

## 6. Data-room visibility and sharing

**Positive checks.** Each investor sees only what was shared with it.

| Check                                                                                                                               | Result                                                               | Source                |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------- |
| 15 planned shares (Halyard 7, Tensorgate 8): one `relationship_shared/view` policy each; listed; `open` 200; diligence download 200 | 15/15                                                                | [REL] §4              |
| Nixo → Savanna: 10 planned shares                                                                                                   | 10/10 listed; `open` and download 200                                | [HYG] §2              |
| Bank statement shared by fulfilling a request (`38864c09`, policy `1a3a13c5`)                                                       | Thames Arc: listed, download 200                                     | [LIVE] D              |
| Team plan granted live (`c0d522b1`, 18:20:04 UTC)                                                                                   | Thames Arc: listed, `open` 200                                       | [LIVE] D, `d252444b1` |
| Today: live policies on the 8 companies                                                                                             | 28 policies, across exactly 4 recipients (the 4 relationships in §2) | **SQL 17 Nov**        |

**Negative checks.** Nothing reaches anyone it was not shared with.

| Check                                                                                          | Result                                                                            | Source         |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------- |
| 26 founder-private documents × 6 routes, as Savanna (list, data room, get, file, open, access) | 0 of 26 visible                                                                   | [UPL]          |
| 11 unplanned Halyard and Tensorgate documents                                                  | no policy or entry; not listed; open and download 404                             | [REL] §4       |
| Cross-investor: Savanna on Halyard, Thames Arc on Tensorgate (26 documents)                    | not listed; `open` and `GET` 404; 0 policies to any other recipient. **Leaks: 0** | [REL] §4       |
| Thames Arc on Nixo (14 documents)                                                              | data room 200 with none listed; `open` and `GET` 404                              | [HYG] §2       |
| Savanna on the 31 compact-pack documents                                                       | 0 of 31 visible                                                                   | [UPL] compact  |
| Savanna on Halyard's bank statement and team plan after sharing them with Thames Arc           | `open`, `GET` and download 404; not listed                                        | [LIVE] D       |
| 32 withdrawn documents (27 certificates, 5 leftovers)                                          | not listed; `open` 404 (Savanna's `investor-check`)                               | [HYG] §1, §4.1 |
| Halyard's GateQ draft before submission                                                        | Thames Arc `/gateq`: "No applications yet"                                        | [LIVE] F       |

## 7. Q answers with citations

Every turn was typed in Chromium as a marker-checked fictional account. Answers are quoted as recorded.

**A–C, financial evidence, deck against accounts, uncertainty** (Savanna on Tensorgate)

- **First run, on `4f43012a6`: FAIL.** Q said burn and runway "aren't recorded" (conversation `2f4f0b1f`).
- **`bab915357`, conversation `3d510d8e`:**
  - Turn 1: "$152,800 October net burn, $948,840 cash, 6.2 months (p. 1)", plus the deck's "$135,000, $1.1m at 30 Sep, 8.1 months", naming the shared management accounts.
  - Turn 3 named "Management accounts, May 2025 to Oct 2026" and the October 2026 seed deck.
  - Turn 4 said "a reconciled cash-flow and runway schedule would settle it". **PASS.**
- **`8647c718c`, runs `b0ea3d06` and `84be6936`:** burn and runway came from the accounts (p. 1), with the KPI pack in agreement. Q explained the deck as an earlier snapshot (Sep vs Oct) and said the documents do not state why burn changed. **PASS.**
- **`77187e4aa`, conversation `db74c76d`:** all correct. The "why" turn labels its Sep-vs-Oct explanation as an inference. **PASS.**

**D, a private document shared through the workflow** (Thames Arc on Halyard)

- **Before the share.**
  - Run `73eebc9b` (`d252444b1`): "Halyard Security's hiring plan is not among the authorised materials I can read." **PASS.**
  - Run `585e27d3` (`bab915357`): "£388,070 at 31 October 2026 … the bank statements for August to October are still outstanding". **PASS (minor).**
- **After the share.**
  - Run `8ce44fc0`, in a new conversation: "the October closing balance of £388,070 (p. 1), matching the £388,070 cash at month end … document-supported but not independently verified." **PASS.**
  - Run `b0a877f8`, in the same conversation: Q re-read the newly shared plan without being told. Freshness PASS. But it said "4 public-sector account managers"; the document says 3.
- **Count fix on `f410019c4`** (conversation `0121ed1e`):
  - Run `32f7b9b4`: "3 public-sector account managers and 1 information security and assurance manager in Q1".
  - Run `687e5136`: "4 people in Q1 2027: 3 public-sector account managers and 1 …".
  - Claim check: 4 bound, 1 contradiction corrected; then 3/3 bound. Four stale summaries were superseded with history kept. **PASS.**
- Failed rechecks before that, kept as history: `927f25ddd`, `a65386689`, `9c7b38925` (run `a1777c9a`) and `827cc7763` (runs `434ead80`, `2b4011a0`).

**E, comparison** (Savanna on Halyard, Tensorgate and Nixo)

- **`bab915357`, run `06de74f3`: PARTIAL.** Halyard dropped out of the table, and the answer contradicted itself.
- **`8647c718c`, run `6497c94c`:** all three companies appear. Mandate fit (Halyard 8.3, Tensorgate 8.0, "Nixo's cheque fit untestable") is kept apart from how well each is evidenced. Q flagged "Tensorgate's GateQ application asking for $1.5m against $4m in the deck". **PASS.**

**F, GateQ** (Thames Arc, application `0490be41`, submitted)

- **Run `5690a49c` on `d252444b1`:** "current GateQ stage is **Seed**; the earlier **Pre-seed** entry is explicitly superseded … **29.3% gross margin for the 12 months to October 2026**, because deployment-team payroll is included in cost of sales. Still unresolved: Problem, Customers, Market, Traction, Revenue, Team, and Use of funds …"
- Each finding cites "Their GateQ application (submitted 16 Nov 2026)", `USER_CLAIM`/`SELF_REPORTED`.
- **PASS (minor).** "initially cited 82%" is loose, and the dossier showed the correction note three times.

**G, the founder's prioritised gaps** (Halyard's founder)

- **`bab915357`: PARTIAL.** A 183 s background job, and it ignored the HC documents.
- **`b156a9cd1`: PARTIAL.** Run `c5b0f789` read the HC accounts under `ownCompanyRead` only when the documents were named.
- **`1626553fb`, conversation `04029d55`:**
  - Turn 1: "82% vs 29.3% gross margin, ~£70k vs £92,340 burn, 6.9 vs 4.2 months runway" (24.5 s).
  - Turn 2 split the figures into backed, partly backed and not cleanly backed, after `documents.uploaded.list` and page reads.
  - Turn 3 found the NHS contract's 9,800 users with no bridge to the deck's totals.
  - **PASS.**

**H, voice: NOT TESTED.** This environment has no audio (§11).

## 8. Acceptance summary

Production is now **`013cf7130`** (`git ls-remote origin recovery/2026-09-12`). No scenario has been re-run on it. The SHA column is the build on which the latest result was recorded.

| Scenario                                    | Role     | Latest result    | Production SHA at that run | Evidence                                          |
| ------------------------------------------- | -------- | ---------------- | -------------------------- | ------------------------------------------------- |
| A financial evidence                        | investor | PASS             | `77187e4aa`                | [LIVE] timing; runs on `8647c718c`                |
| B deck against financials                   | investor | PASS             | `77187e4aa`                | as above, `84be6936`                              |
| C uncertainty reduction                     | investor | PASS             | `bab915357`                | conversation `3d510d8e` turn 4                    |
| D private → shared                          | both     | PASS             | `f410019c4`                | runs `32f7b9b4`, `687e5136`; `8ce44fc0`           |
| D same-conversation freshness after a share | investor | PASS (freshness) | `d252444b1`                | `b0a877f8`; its count defect fixed on `f410019c4` |
| E comparison, fit kept apart from quality   | investor | PASS             | `8647c718c`                | `6497c94c`; timing on `77187e4aa`                 |
| F GateQ application                         | investor | PASS (minor)     | `d252444b1`                | `5690a49c`                                        |
| G founder's prioritised gaps                | founder  | PASS             | `1626553fb`                | conversation `04029d55`                           |
| H voice                                     | both     | NOT TESTED       | —                          | owner's real-device test                          |

## 9. Negative permission and cross-tenant results

- **In Q turns.**
  - Run `7cef5d87` (Savanna asked about Halyard's bank statement): "I can't see a Halyard Security bank statement". No tool result contained 388,070, the document id or the title.
  - Run `73eebc9b`: no tool result contained `c0d522b1` before the share.
  - Run `06de74f3`: no private Halyard or Nixo document was opened ([LIVE] D, E).
- **Through the API.** All checks in §6 are negative: 0 leaks across 26 + 14 + 31 seeded documents and the withdrawn set.
- **Embeddings.** No HIGHLY_CONFIDENTIAL or RESTRICTED chunk is embedded (**SQL 17 Nov**).
- **Founder reads (ADR 0079).** These cover a current member's own company only. Other members' and other companies' documents stay held, as does RESTRICTED material.
- **Account safety.** Every write ran under a marker check (`fictional_demo` and `synthetic`), with 0 unmarked members on every company touched. A null-safety bug in that check was fixed (`not coalesce(…, false)`, [HYG] §1). Ledgerline, Baridi, Zino Aviation and unmarked accounts were never written.
- **Defect found and fixed.** Run `7cef5d87` also read Watchly's and Rankpay's data rooms for a Halyard question (wrong subject resolution). The fix shipped in `b396c307f` and was confirmed on `8647c718c`.

## 10. Files, migrations, commands, tests and deploys

**Seed scripts** (`scripts/seed/evidence/`):

- `generate.mjs`, `documents.mjs`, `render.mjs`, `compact.mjs`
- `upload.mjs` (`upload | verify | negative`)
- `relationships.mjs` (`seed | mandates | gateq-form | gateq-interview | gateq-correct | gateq-submit | verify`)
- `hygiene.mjs` (`plan | apply [pass2] | investor-check | restore <id>`)
- `supersede-stale-summaries.mjs` (dry run by default)
- 8 fixtures and 8 manifests. Reports go to `out/` (gitignored).

**Validator:** `apps/workers/test/demo-evidence-fixtures.test.ts`.

**Migrations since `2fdc90b1c`:**

- `20261231594500_ai_ops_answer_reasoning_low` (hosted 305)
- `20261231595500_model_usage_warmup_purpose` (hosted 306)
- `20261231596000_synthetic_demo_name_suffix` (data-only: strips "(fictional)" in tenants where every member is marked synthetic; pgTAP covered)

**Production SHAs on which live results were recorded:** `4f43012a6`, `bab915357`, `a5f3d95e9`, `8647c718c`, `b156a9cd1`, `5d08eaaa0`, `1626553fb`, `77187e4aa`, `d252444b1`, `4c832ca1f` (gate PASS, 1,847 s), `927f25ddd`, `a65386689`, `9c7b38925`, `827cc7763`, `f410019c4`.

**Current production:** `013cf7130` (17 Nov, 02:15 UTC). It holds `1d89a9c6c`: the founder's HC chat attachment, the requests-inbox share line, and one stored correction note.

**After production on the integration branch:** `1873e6237` (compact packs) and `1a42046c8` (hygiene pass 2). Both are seed scripts and docs, with no deployed code.

**Key commits** (64 since `2fdc90b1c`):

| Area              | Commits                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| Seed              | `85cb7056b`, `5ce1a4f73`, `db360f5b8`, `ee0f1d251`, `e98c44050`, `37f20389e`, `f472ef8b4`, `1873e6237`, `1a42046c8` |
| ADRs              | ADR 0078 `4f43012a6`; embeddings `0c78d4dd2` and `3034088b3`; ADR 0079 `b156a9cd1`                                  |
| Q reads           | `bab915357`, `a5f3d95e9`, `b396c307f`, `ca639a8f0`, `1626553fb`                                                     |
| GateQ             | `9cf769860`, `5d08eaaa0`                                                                                            |
| Counts and memory | `c6ba4d0f2`, `927f25ddd`, `9c7b38925`, `827cc7763`, `f410019c4`                                                     |
| Speed             | `fbf022688`, `d252444b1`, `4c832ca1f`                                                                               |
| Database          | `6a0fa2274`                                                                                                         |
| Fixes             | `1d89a9c6c`                                                                                                         |

**Spend.** Test spend on 16 Nov was about USD 2.03 of 5 ([LOG]). The seeding slices themselves cost at most USD 0.02 each: [UPL], [REL], [HYG] §3 and §4.4.

## 11. Remaining blockers and decisions

| #   | Item                                                                                                                                                                                                                                                                                                                                                                                                 | Owner / next step                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | **No route to withdraw a claim.** Maji Loop claim `23cad797` (MRR USD 42,000, DOCUMENT_SUPPORTED, CURRENT, `organisation_private`, confirmed **SQL 17 Nov**) rests only on an archived QA deck. `reviseClaim` exists in the evidence package, but no HTTP route, app action or Q tool calls it. Investors cannot see the claim.                                                                      | Lead: add a supersede route with history, then supersede `23cad797` ([HYG] §4.2) |
| 2   | **Ledgerline and Baridi certificates.** `b216ac68`, `1d69a69b`, `dd08b4e0` and `3fbcb6c9` are still ACTIVE (**SQL 17 Nov**). They were left read-only by instruction.                                                                                                                                                                                                                                | Owner decides; `hygiene.mjs` applies once approved                               |
| 3   | **48 companies still carry "(fictional)".** These are unmarked sign-ups, which the migration does not touch by design. Also 2 document titles and 10 investor names (**SQL 17 Nov**).                                                                                                                                                                                                                | Owner: rename through the product, or confirm they are out of scope              |
| 4   | **Voice scenario H not tested.** There is no audio in this environment, so no audio claim is made.                                                                                                                                                                                                                                                                                                   | Owner's real-device test: `audits/2026-11-15-q-voice-audit/owner-device-test.md` |
| 5   | **Transaction-pooler retry pending.** The 16 Nov trial hung run `dff4faca` and was rolled back to the session pooler (pool 3). `6a0fa2274` added statement limits that survive the pooler, but no retry has run ([LEDGER]).                                                                                                                                                                          | Lead, under decision 101: an offline check, then a gated retry                   |
| 6   | **Latency.** The latest figures are 15.4 s, 11.3 s and 17.2 s run totals, and 21.8 s, 17.7 s and 14.7 s to a settled answer in the browser (`77187e4aa`). A first turn was 23.1 s on `bab915357`. The turn reader's 2.2–4.0 s classification calls are the largest share. The warm-up is live in `4c832ca1f`.                                                                                        | Speed lane                                                                       |
| 7   | **Investor fields without a schema.** Portfolio references have a table and contract but no HTTP route. Decision process, diligence needs, notes and meeting history live only in mandate text and `custom.text` ([REL] §6).                                                                                                                                                                         | Needs a route or migration decision                                              |
| 8   | **GateQ numeric discrepancy case not seeded.** The Halyard margin became a founder correction. Gross margin has no quantified GateQ dimension, so code cannot link a disagreement, and the 19 existing LEFT_OPEN disagreements sit on frozen dossiers ([REL] §5).                                                                                                                                    | Lead: choose a quantified dimension (stage or traction count) and seed it        |
| 9   | **The summary writer still accepts figures from Q's own answers.** The conversation-summary gate grounds a figure in any transcript turn. Since `f410019c4`, recall labels these lines "Q said earlier", types them Q_INFERENCE, holds counts to sources, and supersedes contradicted summaries. The writer itself is unchanged.                                                                     | Lead: ground summary figures only in user turns and sources                      |
| 10  | **Done (17 Nov 2026): planned shares granted.** Through the product API: Ajopot 5, Watchly 5 and Maji Loop 6 documents shared with Savanna (view only). Each relationship has 1 answered and 1 pending request; Watchly and Maji Loop moved CONNECTED → IN_DILIGENCE. The 2 unplanned documents stay private. Thames Arc gets 404 on all 18 ([REL] §9). MedTrail and Mizan have no investor planned. | Done                                                                             |
| 11  | **No document-backed claims from the new documents.** Investor-visible figures stay SELF_REPORTED unless Q reads the shared document.                                                                                                                                                                                                                                                                | Product decision ([INV] §3)                                                      |
| 12  | **Watchly's 3 PENDING onboarding suggestions.** Revenue 8,500, burn 173,500 and runway 18.0 are correct against the fixture.                                                                                                                                                                                                                                                                         | Founder confirms ([HYG] §4.3)                                                    |
| 13  | **No scenario re-run on current production `013cf7130`.**                                                                                                                                                                                                                                                                                                                                            | Lead: one A–G sweep before the demo                                              |
