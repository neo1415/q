# Demo evidence upload and ingestion (16 Nov 2026): Tensorgate and Halyard, founder-private

Phase 5 of the owner directive of 16 Nov 2026 (`docs/ai-handoff/directives/2026-11-16-demo-evidence-data-room-seeding.md`), **founder-private only**. The 26 synthetic documents from `scripts/seed/evidence/` (base commit 85cb7056b) were uploaded to production through the normal founder document API, as each company's own seeded fictional founder. Nothing was shared or granted, no data-room level or download audience was set, no visibility or sensitivity rule was changed, nothing was deleted, and Nixo and non-fictional companies were not touched. Sharing waits for the owner decision.

## How it ran

- Script: `scripts/seed/evidence/upload.mjs` (`upload | verify | negative`). The founder is resolved read-only: `core.company_members` (current founder) → `identity.user_profiles` → `auth.users`, which must carry `app_metadata.fictional_demo` and `synthetic`. The email stays in memory and the log shows only 8-character id prefixes.
- The seeded founder accounts for these two companies are the tavus-20 plus-addressed accounts (`docs/seed/tavus-20/LOGINS.md`), not `@fictional.capitalq.local`. The script therefore checks the service-role fictional marker on the signed-in user rather than the email domain. Signed in as the onboarded owner of each company: Tensorgate founder `801f52ed`, Halyard founder `e3703a99`.
- The public Supabase key was read from the management API (publishable key only) into a 0600 scratch file outside the repository, then shredded.
- Route: `POST /v1/documents/upload-sessions` (with `companyId`, the manifest `documentType`, title, `filename` = the stable seed file name, MIME type and size) → direct `PUT` to private storage → `POST …/complete` with `clientSha256`. The upload API takes no folder or checklist codes; those stay in the manifest for the later data-room step.
- **Idempotency.** Before uploading, the founder's own `GET /v1/documents?companyId=` list is read, and a document is skipped when its seed file name or sha256 is already present. Idempotency-Key headers are `cq-evidence-seed-<id>-<sha16>`. A second `upload tensorgate` run skipped all 13. No schema column was added.
- Timeline: upload began 2026-11-16T06:24:26Z. All 26 versions reached `COMPLETED` within about 2 minutes, well inside the 10-minute polling bound.

## Results per document

Every row below was checked through read-only SQL (`evidence.documents`, `document_versions`, `document_processing_runs`, `document_extractions`, `document_pages`, `q_knowledge.chunk_sets/chunks`, `data_room_entries`, `permissions.disclosure_policies`) and through the founder's API. All 26 rows passed each of these checks:

- `company_id`, `tenant_id` and `owner_organisation_id` match the company.
- The storage bucket is `cq-documents-private` and the key is tenant-scoped (`raw/<tenant>/<random>`).
- The extraction artifact is in `cq-extractions-private`, and the latest processing run is `COMPLETED` with no error code.
- The chunk set is `ACTIVE`, at `organisation_private`.
- `download_audience` is `ORGANISATION`, with 0 data-room entries and 0 disclosure policies.
- The document appears in the founder's `GET /v1/documents?companyId=` list and in the owner view of `GET /v1/companies/:id/data-room`.

"Text chars" is the extracted page text (`document_pages.text`). "Chunks" counts the active `q_knowledge.chunks`.

### Tensorgate (`bf55d6e1`), 13 of 13 ingested

| Seed id                     | Doc id     | Title                                                                   | Type                | Sensitivity         | Visibility           | Processing / text     | Text chars | Chunks | Facts / claims |
| --------------------------- | ---------- | ----------------------------------------------------------------------- | ------------------- | ------------------- | -------------------- | --------------------- | ---------: | -----: | -------------- |
| `tg-management-accounts`    | `dc002308` | Management accounts, May 2025 to Oct 2026                               | MANAGEMENT_ACCOUNTS | HIGHLY_CONFIDENTIAL | organisation_private | COMPLETED / COMPLETED |       7965 |     17 | 0 / 0          |
| `tg-monthly-actuals`        | `87332c9e` | Monthly actuals data, May 2025 to Oct 2026                              | MANAGEMENT_ACCOUNTS | HIGHLY_CONFIDENTIAL | organisation_private | COMPLETED / COMPLETED |       4519 |      4 | 0 / 0          |
| `tg-revenue-breakdown`      | `303c040f` | Monthly revenue by customer                                             | FINANCIAL           | HIGHLY_CONFIDENTIAL | organisation_private | COMPLETED / COMPLETED |       3387 |     13 | 0 / 0          |
| `tg-invoice-register`       | `f0f9f934` | Invoice register                                                        | FINANCIAL           | HIGHLY_CONFIDENTIAL | organisation_private | COMPLETED / COMPLETED |       2167 |      1 | 0 / 0          |
| `tg-bank-statement`         | `8fba21b9` | Business account statement, Aug 2026 to Oct 2026, with monthly balances | FINANCIAL           | HIGHLY_CONFIDENTIAL | organisation_private | COMPLETED / COMPLETED |       4079 |     10 | 0 / 0          |
| `tg-customer-contracts`     | `517dceab` | Customer contract summary                                               | CUSTOMER            | CONFIDENTIAL        | organisation_private | COMPLETED / COMPLETED |       1996 |      8 | 0 / 0          |
| `tg-cohorts-retention`      | `a907ba5b` | Customer cohorts and retention                                          | CUSTOMER            | CONFIDENTIAL        | organisation_private | COMPLETED / COMPLETED |       2187 |      8 | 0 / 0          |
| `tg-customer-concentration` | `24e169dd` | Customer concentration                                                  | COMMERCIAL          | CONFIDENTIAL        | organisation_private | COMPLETED / COMPLETED |        922 |      4 | 0 / 0          |
| `tg-cap-table`              | `1260f55b` | Capitalisation table and ownership                                      | CORPORATE           | CONFIDENTIAL        | organisation_private | COMPLETED / COMPLETED |       1890 |      6 | 0 / 0          |
| `tg-raise-terms`            | `a41cba4d` | Seed round terms and use of funds                                       | CORPORATE           | CONFIDENTIAL        | organisation_private | COMPLETED / COMPLETED |       1168 |      6 | 0 / 0          |
| `tg-projections-2027`       | `a7b8eab7` | Projections to December 2027, with assumptions                          | FINANCIAL_MODEL     | HIGHLY_CONFIDENTIAL | organisation_private | COMPLETED / COMPLETED |       2617 |      8 | 0 / 0          |
| `tg-kpi-pack`               | `31dd8098` | KPI and product metrics pack                                            | OPERATIONAL         | CONFIDENTIAL        | organisation_private | COMPLETED / COMPLETED |       2238 |      8 | 0 / 0          |
| `tg-team-hiring-plan`       | `1222cd01` | Team and hiring plan                                                    | OPERATIONAL         | CONFIDENTIAL        | organisation_private | COMPLETED / COMPLETED |       2424 |     10 | 0 / 0          |

### Halyard Security (`1ab2cc02`), 13 of 13 ingested

| Seed id                     | Doc id     | Title                                                                   | Type                | Sensitivity         | Visibility           | Processing / text     | Text chars | Chunks | Facts / claims |
| --------------------------- | ---------- | ----------------------------------------------------------------------- | ------------------- | ------------------- | -------------------- | --------------------- | ---------: | -----: | -------------- |
| `hs-management-accounts`    | `7d1605cc` | Management accounts, May 2025 to Oct 2026                               | MANAGEMENT_ACCOUNTS | HIGHLY_CONFIDENTIAL | organisation_private | COMPLETED / COMPLETED |       9092 |     17 | 0 / 0          |
| `hs-monthly-actuals`        | `51b72b78` | Monthly actuals data, May 2025 to Oct 2026                              | MANAGEMENT_ACCOUNTS | HIGHLY_CONFIDENTIAL | organisation_private | COMPLETED / COMPLETED |       5075 |      4 | 0 / 0          |
| `hs-revenue-breakdown`      | `0f54f23a` | Monthly revenue by customer                                             | FINANCIAL           | HIGHLY_CONFIDENTIAL | organisation_private | COMPLETED / COMPLETED |       6130 |     14 | 0 / 0          |
| `hs-invoice-register`       | `5ce41404` | Invoice register                                                        | FINANCIAL           | HIGHLY_CONFIDENTIAL | organisation_private | COMPLETED / COMPLETED |      25188 |     18 | 0 / 0          |
| `hs-bank-statement`         | `38864c09` | Business account statement, Aug 2026 to Oct 2026, with monthly balances | FINANCIAL           | HIGHLY_CONFIDENTIAL | organisation_private | COMPLETED / COMPLETED |       7042 |     10 | 0 / 0          |
| `hs-customer-contracts`     | `a050ea36` | Customer contract summary                                               | CUSTOMER            | CONFIDENTIAL        | organisation_private | COMPLETED / COMPLETED |       5759 |     19 | 0 / 0          |
| `hs-cohorts-retention`      | `fdb97f87` | Customer cohorts and retention                                          | CUSTOMER            | CONFIDENTIAL        | organisation_private | COMPLETED / COMPLETED |       3401 |      8 | 0 / 0          |
| `hs-customer-concentration` | `65799eaa` | Customer concentration                                                  | COMMERCIAL          | CONFIDENTIAL        | organisation_private | COMPLETED / COMPLETED |       1371 |      4 | 0 / 0          |
| `hs-cap-table`              | `4aeb44c3` | Capitalisation table and ownership                                      | CORPORATE           | CONFIDENTIAL        | organisation_private | COMPLETED / COMPLETED |       2148 |      6 | 0 / 0          |
| `hs-raise-terms`            | `85629237` | Seed round terms and use of funds                                       | CORPORATE           | CONFIDENTIAL        | organisation_private | COMPLETED / COMPLETED |       1386 |      6 | 0 / 0          |
| `hs-projections-2027`       | `b3d7f334` | Projections to December 2027, with assumptions                          | FINANCIAL_MODEL     | HIGHLY_CONFIDENTIAL | organisation_private | COMPLETED / COMPLETED |       2995 |      8 | 0 / 0          |
| `hs-kpi-pack`               | `ebdded05` | KPI and product metrics pack                                            | OPERATIONAL         | CONFIDENTIAL        | organisation_private | COMPLETED / COMPLETED |       2246 |      8 | 0 / 0          |
| `hs-team-hiring-plan`       | `c0d522b1` | Team and hiring plan                                                    | OPERATIONAL         | CONFIDENTIAL        | organisation_private | COMPLETED / COMPLETED |       2438 |     10 | 0 / 0          |

### Observations

- **Malware status is `NOT_SCANNED` on all 26.** Production has no scanner attached (ADR 0042), so these files are processed but never described as clean. This is expected, not a failure.
- **Extracted facts and claims: none.** There are 0 `evidence_items`, 0 `claims`, 0 onboarding suggestions and 0 `document_claim_readings` from these documents.
  - Claim cards run only for PITCH_DECK and COMPANY_PROFILE.
  - The local-figures reader offers figures only into an ACTIVE founder onboarding session, and both founders' sessions are COMPLETED.
  - The figures are therefore retrievable as chunked text only. No evidence-model claims are linked to them, so no truth_class or evidence_status values exist to report.
  - Linking document-backed claims is a later step and needs a decision. It is not done here.
- **Embeddings.** The chunk sets carry no embedding, as the provider decision (decision 6) is still open. Retrieval is lexical (`content_tsv`) until then.
- Each company now has 25 active documents: the 12 earlier seed documents plus these 13. Earlier documents were left untouched.

## Model calls and spend

- `ai_ops.model_usage` for both companies' tenants and founders since 06:24:26Z shows **0 calls and $0**, checked after Tensorgate (before Halyard was uploaded) and again after both.
- Budget ledger: reserved $0.50 (`fb8a1098`); recorded actual $0.00.

## Negative checks (fictional investor Savanna Seed Partners)

Signed in as `investor.savanna-seed@fictional.capitalq.local`; read-only HTTP; 26 documents × 6 checks.

| Check                                                       | Result for all 26                        |
| ----------------------------------------------------------- | ---------------------------------------- |
| `GET /v1/documents?companyId=<company>`                     | 200, none of the new document ids listed |
| `GET /v1/companies/<company>/data-room` (investor view)     | 200, no new document id or title present |
| `GET /v1/documents/<id>`                                    | 404                                      |
| `GET /v1/documents/<id>/file`                               | 404                                      |
| `GET /v1/companies/<company>/data-room/documents/<id>/open` | 404                                      |
| `GET /v1/data-room/documents/<id>/access` (owner route)     | 404                                      |

Result: **0 of 26 visible.** The Q tool path (`read_company_document` inside a Q turn) was not exercised, because that needs a live model turn. The data-room open route above uses the same disclosure check. A Q-turn check belongs with the sharing slice, after the owner decides.

## Failures

None. All 26 uploaded, processed and chunked on the first attempt.

## Reproduce

```bash
export PATH=/opt/node24/bin:$PATH NODE_USE_ENV_PROXY=1 CQ_PUBLIC_JSON=<0600 file outside the repo>
node scripts/seed/evidence/generate.mjs
node scripts/seed/evidence/upload.mjs upload      # idempotent; skips what is there
node scripts/seed/evidence/upload.mjs verify      # SQL + founder API; JSON in out/upload-report.json
node scripts/seed/evidence/upload.mjs negative    # Savanna Seed cannot list or open any of them
```

## Next (needs owner decision)

- Data-room placement: set the level, folder and checklist through `POST /v1/data-room/documents/:id/level`.
- Grants: Tensorgate → Savanna Seed; Halyard → Thames Arc, once a relationship exists.
- Decisions 5 (HIGHLY_CONFIDENTIAL financials held back from Q) and 6 (embeddings provider).

## Nixo (16 Nov, 09:40 UTC)

- **Sign-in:** the owner authorised it (decision 99). It used a one-time admin magic-link session as the Nixo founder (`cb2b58ab`): no password change and no email sent. The admin key was held in memory only.
- **Upload:** all 14 `nx-*` documents (12 PDFs, including the generated pitch deck, and 2 CSVs) went through the normal founder upload route. All sessions completed, and `verify` shows 14/14 COMPLETED.
- **Model calls:** 2, for deck reading, at USD 0.0096 (ledger `a25bd6c5`).
- **Visibility:** every document is founder-private. The Savanna negative check covered all 40 seeded documents. Savanna sees exactly the 8 Tensorgate documents shared with it. No Nixo or Halyard document is listed or opens for Savanna.

## Compact packs: MedTrail, Mizan, Ajopot, Watchly, Maji Loop (17 Nov, 02:30 UTC)

Phase 2's smaller packages (`scripts/seed/evidence/compact.mjs`, fixtures `medtrail|mizan|ajopot|watchly|maji-loop.json`). Each fixture keeps the figures production records for the company, read read-only on 17 Nov 2026: identity, founders, team size, the raise in `core.capital_objectives` (amount, currency, instrument, close date, use-of-funds lines), and the deck and claim figures. For example, Watchly's existing management-accounts CSV records cash of 3,300,000 and burn of 175,000. Every invented field is listed under `assumptions`. Each pack has exactly one deliberate deck discrepancy:

- MedTrail: gross margin, 72% against 42.3%.
- Mizan: runway, 10 months against 7.6 at October's burn.
- Ajopot: 18,700 active users against 14,960 contributing members.
- Watchly: about 20 months of runway against 18.9.
- Maji Loop: 96 kiosks at the end of 2025 against 88 dispensing.

No new deck was generated. Validator: `bash scripts/heavy.sh npx vitest run apps/workers/test/demo-evidence-fixtures.test.ts` gives 131 passed and 23 skipped, where the skips are runIf cases that apply only to particular companies.

- **Upload:** 31 documents went up through the normal founder route. Each was uploaded as the company's marked fictional founder, and the marker check was unchanged. Each declared its manifest type. Prefixes: MedTrail `b5280fd1` (7, founder `969cb8b0`), Mizan `d9c03bb4` (6, `2371a60b`), Ajopot `91de2a77` (6, `3acf2825`), Watchly `526c2d72` (6, `ea854270`), Maji Loop `01c554bf` (6, `2ba89060`). Every upload session reached COMPLETED on the first attempt, and no filename clashed with the companies' existing documents.
- **Verify:** 31/31 COMPLETED/COMPLETED. All 31 passed every per-document check listed above:
  - company, tenant and organisation match;
  - private bucket and tenant-scoped key;
  - extraction in `cq-extractions-private`, run COMPLETED;
  - chunk set ACTIVE at `organisation_private`;
  - `download_audience` ORGANISATION, with 0 data-room entries and 0 disclosure policies;
  - listed in the founder's API and data-room outline.
  - Sensitivity follows the type defaults: management accounts, revenue builds, invoice registers and the Ajopot payout ledger are HIGHLY_CONFIDENTIAL; the rest are CONFIDENTIAL.
  - Claim readings: 0. Watchly: 3 onboarding suggestions were offered from the new documents, deterministically.
- **Model calls:** 0 (`ai_ops.model_usage` since 02:30:52Z). Ledger `7f344ea3`: reserved $0.20, actual $0.00.
- **Negative check (Savanna Seed Partners):** 71 seeded documents were checked. **0 of the 31 new documents are visible**: list and data room answer 200 without them, and get, file, open and access answer 404. The only visible documents are the 8 Tensorgate and 10 Nixo documents already shared with Savanna through the workflow by earlier lanes. This slice shared nothing, granted nothing and set no data-room level.
- The report JSON and the 0600 public-key file stayed in the session scratchpad. The key file was shredded.
