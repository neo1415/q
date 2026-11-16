# Demo evidence: relationships, sharing, diligence, GateQ and mandates (16 Nov 2026)

Phases 4, 5 (sharing) and 8 of the owner directive of 16 Nov 2026 ([`../directives/2026-11-16-demo-evidence-data-room-seeding.md`](../directives/2026-11-16-demo-evidence-data-room-seeding.md)), after decision 99. It builds on the 26 founder-private documents uploaded by [`2026-11-16-demo-evidence-upload.md`](2026-11-16-demo-evidence-upload.md).

Every write went through the product's own HTTP API (`https://capital-qapi-production.up.railway.app`), signed in as the seeded fictional person whose action it is. No SQL write, no migration, no deploy. Nixo, Ledgerline, Baridi, Zino Aviation and every unmarked account were not touched.

## How it ran

- Script: `scripts/seed/evidence/relationships.mjs`, with modes `seed | mandates | gateq-form | gateq-interview | gateq-submit | verify`. Its report goes to `out/relationships-report.json`, which is gitignored.
- **Safety checks before any write:**
  - Every account is resolved read-only and must carry `app_metadata.fictional_demo` and `synthetic`. The sign-in re-checks both on the returned user.
  - The pair is refused unless _every_ current company member and every current investor representative carries the markers, because the product notifies them.
  - Halyard's and Tensorgate's members are tavus-20 plus-addressed accounts. The investors' representatives are on `fictional.capitalq.local`.
  - No meeting, calendar invite or relationship message was created.
- **Credentials.** The publishable key was read from the management API into memory only, so no temp file was written. Logs show 8-character id prefixes, never an email, password or token.
- **Idempotency.**
  - State is read before every write: the relationship state through read-only SQL; the diligence view, document access, mandate and GateQ coverage through the API.
  - Requests are keyed by title.
  - Every POST carries a stable `Idempotency-Key` (`cq-evidence-rel-<pair>-<step>`, `cq-evidence-gateq-halyard-*`).
  - A second `seed`, `mandates` and `gateq-form` run wrote nothing: 15 of 15 shares `present`, both mandates `present`, the same single GateQ draft reopened, still one CORRECTS link.

## 1. Relationships (Phase 4)

Thames Arc fits Halyard on geography (UK), currency (GBP), stage (seed) and cheque (150k–2M GBP against a 3M GBP round). Its declared sector focus is payments and insurance infrastructure, so the sector does not fit. That gap is kept as it is: it is the case for scenario E, mandate fit kept apart from business quality.

| Pair                                   | Before     | Steps (actor, route, HTTP)                                                                                                                                                                         | After        |
| -------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Halyard ↔ Thames Arc (`d8909e27`)      | none       | investor `POST …/express-interest` with a note (201); founder `POST /v1/network/interests/:id/accept` (201); investor `POST …/meeting-outcome {DILIGENCE}` (201; no meeting exists, so none bound) | IN_DILIGENCE |
| Tensorgate ↔ Savanna Seed (`06367f56`) | DISCOVERED | the same three steps (201, 201, 201)                                                                                                                                                               | IN_DILIGENCE |

## 2. Sharing (Phase 5)

The founder shared each planned document (manifest `plannedShareWith`) with that one relationship through `POST /v1/data-room/documents/:id/grants` with `{relationshipId, accessLevel: "view", days: 90, fileIn: <manifest folder>}`.

- Each share is the founder's own request carrying that exact payload. It is the founder's action, not a Q-prepared card.
- Filing sets the data-room entry to `SHARED_ONLY` in the manifest folder: no title or file is shown to anyone not shared with.
- The answered diligence request's document was shared by fulfilling the request instead. That share is a `relationship_shared` / `view` policy with no expiry.
- The other documents were not touched and stay founder-private, with no data-room entry and no policy.

| Company    | Shared with Thames Arc / Savanna                                                                                                                           | Left founder-private                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Halyard    | 7: management accounts†, cohorts and retention, customer concentration, cap table (via request), raise terms, projections 2027†, KPI pack                  | 6: monthly actuals†, revenue breakdown†, invoice register†, **bank statement†** (scenario D), customer contracts, team plan |
| Tensorgate | 8: management accounts†, revenue breakdown†, customer contracts (via request), customer concentration, cap table, raise terms, projections 2027†, KPI pack | 5: monthly actuals†, invoice register†, **bank statement†**, cohorts and retention, team plan                               |

† HIGHLY_CONFIDENTIAL by default (FINANCIAL, MANAGEMENT_ACCOUNTS, FINANCIAL_MODEL).

## 3. Diligence requests

| Pair                 | Answered (investor asked → founder fulfilled)                                                                                                                                          | Pending (OPEN, for the live step)                                                                                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Halyard ↔ Thames Arc | "Capitalisation table and ownership" (`7f46988f`), FULFILLED by `hs-cap-table` (`4aeb44c3`)                                                                                            | "Business bank statements, Aug to Oct 2026" (`838e62bc`), about "Cash of 388,070 at 31 Oct 2026 and runway of 4.2 months, as the management accounts state" (REPORTED). The founder fulfils it with `hs-bank-statement` live: scenario D |
| Tensorgate ↔ Savanna | "Customer contract summary", FULFILLED by `tg-customer-contracts` (`517dceab`), about "Contracted ARR of $360k against revenue billed from one customer until October 2026" (REPORTED) | "Business bank statements, Aug to Oct 2026", OPEN                                                                                                                                                                                        |

## 4. Verification (`verify`, read-only)

For every one of the 26 documents, checked through read-only SQL (`permissions.disclosure_policies`, `evidence.data_room_entries`) and through three accounts' API calls:

- **Planned (15 of 15):**
  - Exactly one active `relationship_shared/view` policy, whose recipient is the pair's relationship.
  - The pair's investor sees it in `GET /v1/companies/:id/data-room`.
  - `…/data-room/documents/:id/open` returns 200.
  - It appears in the diligence view's shares, and `…/diligence/documents/:id/download` returns 200.
- **Unplanned (11 of 11):**
  - No policy and no data-room entry.
  - Not listed to the pair's investor; open and download return 404.
- **Cross-investor negative.** Savanna checked Halyard's documents, and Thames Arc checked Tensorgate's. Both are fictional. For all 26 documents:
  - not listed in the data room (200 response, without them);
  - `open` returns 404 and `GET /v1/documents/:id` returns 404;
  - 0 policies name any other recipient.
- **Leaks: 0.**

## 5. GateQ (Phase 4 scenarios)

Halyard's founder applied through Thames Arc's gate (`gq_2ymv63720cx6v1nc18sc4xtmz1`, gateway `6560cc04`), so the investor and the canonical relationship are the same ones that hold the diligence requests. The application is `0490be41`, reference `ga_1kqfa1zd54naktn20bgvn5n4sz`, IN_PROGRESS.

| Scenario                         | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Founder correction, history kept | **Done, no model call.** `POST /v1/gateq/apply/account/start` (form) and `…/contact/account` (own account email, confirmed without a code). Then `…/answers` with stage `pre_seed`, then `…/answers {stage: "seed"}`. Coverage shows `company.stage` SETTLED "Seed", with `superseded: [CORRECTION: Pre-seed]`: one CORRECTS link, `CODE_DETECTED`.                                                                                                                                                                                                                  |
| Genuine discrepancy              | **Not reached; stopped as instructed.** It needs interview turns, a model reading. One attempt: the opening line plus 3 turns saying the deck's 82% gross margin and the accounts' 29.3% (`hs-gross-margin`), then leaving it open. The reader filed "82%" as business-model text and the 29.3% sentence as `application.note`, so no disagreement link was made. **Defect found:** the note was split at the decimal point into two statements, "…gross margin of 29." and "3%.". Gross margin has no quantified GateQ dimension, so code detection cannot link it. |
| Answered / pending request       | Satisfied on the same relationship by the diligence requests in §3 (one FULFILLED, one OPEN). GateQ itself has no information-request message kind; its inbox only REPLYs and PASSes.                                                                                                                                                                                                                                                                                                                                                                                |
| Submit                           | **Not done on purpose.** Submitting would freeze the split note into the dossier Thames Arc reads. `node scripts/seed/evidence/relationships.mjs gateq-submit` submits it once the lead decides (about 1 synthesis call).                                                                                                                                                                                                                                                                                                                                            |

The 19 existing LEFT_OPEN disagreements are all on SUBMITTED applications with frozen dossiers. No product route changes them, so none was edited.

## 6. Investor mandates (Phase 4)

These changes went through `PATCH /v1/investors/:id/mandates/:mandateId` as each investor's own representative, with `expectedVersion` and an Idempotency-Key. They are **declared** policy only.

- Savanna: version 25 → 26, raw text 168 → 516 characters.
- Thames Arc: version 19 → 20, raw text 107 → 453 characters.
- For each:
  - the raw mandate text gained the decision process and diligence needs;
  - 2 `custom.text` constraints were added (decision cadence; required diligence documents);
  - existing constraints and the derived `cheque.typical` were kept.
- Thames Arc is the GateQ investor here, so no third mandate was changed.
- Observed behaviour and Q inference are not written by anyone. They come from the product's projections and stay separate.

**Gaps (no migration in this slice):**

- **Portfolio references.** `core.investor_portfolio_references` and its contract (`AddInvestorPortfolioReferenceRequestSchema`) exist, but there is no HTTP route, so they cannot be seeded through the API.
- **No structured fields.** Decision process, diligence requirements, investor notes and meeting history have no fields of their own. They live only as declared mandate text and `custom.text`, which are MANUAL_ONLY for automated use.

## Model calls and spend

| Source                                                                                                                                                                                                      | Calls | USD        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----: | ---------- |
| Diligence share summaries (`network.diligence_document_summaries`, STRUCTURED_EXTRACTION): one per shared document, Halyard 8 and Tensorgate 10. Each summary is shown only to that relationship's investor |    18 | 0.0093     |
| GateQ interview: opening line plus 3 turns (NORMAL_DIALOGUE / ONBOARDING)                                                                                                                                   |     4 | 0.0048     |
| Relationship steps, grants, mandates, GateQ form                                                                                                                                                            |     0 | 0          |
| **Total**                                                                                                                                                                                                   |    22 | **0.0141** |

Budget: reserved $0.30 (`25a34cd2`), recorded actual $0.0141. Owner cap for this slice: $1.

**Flag:** sharing a HIGHLY_CONFIDENTIAL document through either share route makes the diligence summariser send its text to a model. This happened for management accounts, revenue breakdown and projections. The behaviour matches decision 99 ("shared means readable" for that one investor), but the decision says it still needs an ADR, and `heldBackFromQ` in `own-records.ts` still holds these documents back. The lead should confirm that the two paths agree.

## Reproduce

```bash
export PATH=/opt/node24/bin:$PATH NODE_USE_ENV_PROXY=1   # SUPABASE_ACCESS_TOKEN, CQ_SEED_ACCOUNT_PASSWORD in env
node scripts/seed/evidence/relationships.mjs seed         # idempotent
node scripts/seed/evidence/relationships.mjs mandates
node scripts/seed/evidence/relationships.mjs gateq-form   # no model call
node scripts/seed/evidence/relationships.mjs verify       # SQL + three accounts' API; 0 leaks expected
```

## Next

- **Scenario D (live).** Halyard's founder fulfils the pending bank-statement request with `hs-bank-statement` from the relationship page.
- **GateQ discrepancy.** Two routes, both the lead's call:
  - fix the decimal-point split in the statement reader;
  - or choose a discrepancy on a quantified dimension (stage or traction count), then re-run `gateq-interview` and `gateq-submit`.
- **Q-turn check.** That Thames Arc's and Savanna's Q can now cite the shared CONFIDENTIAL documents needs a live Q turn, with its budget.

## 7. GateQ margin correction attempt (decision 100, 16 Nov 13:37 UTC)

Halyard's application `0490be41` (`ga_1kqfa1zd54naktn20bgvn5n4sz`) was corrected, not restarted, through the applicant's own route as the seeded fictional founder (sign-in re-checks `fictional_demo` and `synthetic`). New mode: `node scripts/seed/evidence/relationships.mjs gateq-correct`, one `POST /v1/gateq/apply/turn`, `clientTurnId` `cq-evidence-gateq-halyard-correct-margin`.

- **Sent (turn `95c9b0c1`, seq 8):** "Correction to my earlier answer, which got cut at the decimal point: our management accounts for the 12 months to October 2026 show a gross margin of 29.3%, not 29 and 3% as two notes, because the deployment team sits in cost of sales. The 82.0% in the pitch deck is licence margin."
- **Stored (reading v9, outcome READ):** two new `application.note` TEXT statements, `fab7161a` (the whole 29.3% sentence, kept intact by fix 9cf769860) and `2e7e813b` ("The 82.0% in the pitch deck is licence margin."). No `gross_margin` quantity, no CORRECTS and no DISAGREES link. The only link on the application is still the stage CORRECTS (`232b4645` → `6c25ff0a`). There are no disagreement events.
- **Not superseded:** the split notes `311b5d8f` ("…gross margin of 29.") and `326b8d65` ("3%.") are still active in coverage, not history. Q's reply (`18acc1d3`, intent CORRECTION) says "I'll treat this as correcting the two partial notes", but no link was recorded. **Defect:** Q's words claim a correction that the record does not hold. The reader treated the correction as prose for `application.note` instead of `CORRECTS S<n>`. The founder applicant API has no other route that supersedes a statement.
- **Submit withheld,** as instructed: the application is still IN_PROGRESS, so submitting would freeze both split notes into Thames Arc's dossier. The lead decides what comes next. Options: a reader fix so that an explicit correction of a note links CORRECTS (a single target, or both halves), then one more turn; or accept the notes as they stand.
- **Cost:** 1 model call (NORMAL_DIALOGUE / ONBOARDING), $0.0019 (`ai_ops.model_usage`, PRICE_SNAPSHOT). Budget reserved $0.30 (`21dc58d3`), with the actual recorded.

## 8. Second correction and submission (16 Nov, 15:43 UTC, production `5d08eaaa0`)

- **Correction:** after fix `5d08eaaa0` was deployed, Halyard's founder sent one more correction turn (client turn id `…-correct-margin-2`).
- **What was recorded:**
  - Two CORRECTS links (origin MODEL_READING, turn `ab182746`) superseded both split notes: `311b5d8f` ("…29.") and `326b8d65` ("3%.").
  - The new note carries "gross margin of 29.3%" whole.
  - No current note is split at a decimal.
  - The pre-seed → seed correction (`232b4645 → 6c25ff0a`) is still in place.
- **Submission:** at 15:44:01 the application `0490be41` was SUBMITTED through `POST /v1/gateq/apply/submit`, and the dossier synthesis settled. Model cost was below USD 0.01 (ledger `c207e89c`).
- **Known quirk:** the correction note is stored twice, identically, one copy linked to each half. That is harmless but visible in the history.
