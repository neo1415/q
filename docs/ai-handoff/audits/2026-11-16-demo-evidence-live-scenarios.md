# Demo evidence: live scenarios (16 Nov 2026)

## Scenarios A–C on `4f43012a6` (ADR 0078 live), 09:00 UTC

Investor: Savanna Seed Partners (fictional). Conversation: `2f4f0b1f`. Relationship: Tensorgate, `IN_DILIGENCE`. Eight Tensorgate documents are shared with Savanna, including management accounts, revenue breakdown and 2027 projections. Model spend: USD 0.16 (ledger `878bc972`).

| Turn | Ask                                                        | Result                                                                                                                                                                                                          |
| ---- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | "What's Tensorgate's burn and runway right now?"           | **FAIL.** Q said burn and runway "aren't recorded". No document listing or reading tool ran (14 tools, including a public web search), so the shared management accounts were never consulted.                  |
| 2    | "Does that match what their deck says?"                    | **FAIL.** Q said the deck "does not establish current burn or runway". That is false: deck p.10 states about $135k monthly burn, $1.1m cash at 30 Sep and 8.1 months of runway. The page moved to the deck tab. |
| 3    | "Which documents is that based on?"                        | **FAIL.** Q named the profile and the deck and repeated the false claim.                                                                                                                                        |
| 4    | "What would resolve the remaining question on Tensorgate?" | **PARTIAL.** It now quoted deck p.10 correctly, contradicting turns 1–3. It then asked for management accounts that are already shared, and appended an unprompted "public web search was unavailable" line.    |

Root-cause work in progress:

1. Q lists and reads documents shared with the asking investor before answering a figures question.
2. The same deck must give the same reading on every turn.
3. Q must not request documents that are already shared.
4. The research guard covers own-records and data-room questions.

## Scenarios A–C rerun on `bab915357` (11:45 UTC)

Savanna, conversation `3d510d8e`, new wording. Cost USD 0.23 (ledger `0ab566db`).

| Turn | Ask                                                                          | Result                                                                                                                                                                                                                                                                                                                                                                                     |
| ---- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | "How much cash is Tensorgate burning each month, and how long will it last?" | **PASS, slow.** Q read the data room and the shared management accounts (`company.data_room.read` and `…document.pages.read`). It gave "$152,800 October net burn, $948,840 cash, 6.2 months (p. 1)" and the deck's "$135,000, $1.1m at 30 Sep, 8.1 months", calling the accounts the better working figure. It named the shared accounts and made no request offer. 21 tools, **23.1 s**. |
| 2    | "Is that consistent with their pitch deck?"                                  | **PASS, thin.** Q stated both sets of figures and said they conflict, with dates. It did not give the reasons the accounts carry (SOC 2 audit, round legal fees, reserved GPU) or note the September vs October period. 5.7 s.                                                                                                                                                             |
| 3    | "Which documents did you use for that?"                                      | **PASS.** Q named "Management accounts, May 2025 to Oct 2026" and the October 2026 seed deck. It also sent a stray separate line, "The company profile is ready to open." 7.4 s.                                                                                                                                                                                                           |
| 4    | "What's still unresolved, and what would settle it?"                         | **PASS.** Q said which balance and burn are current, and that a reconciled cash-flow and runway schedule would settle it. No already-shared document was requested and no web line appeared. 5.7 s.                                                                                                                                                                                        |

Open items:

- turn 1 latency (23 s);
- explaining the reasons for a discrepancy when the accounts carry them;
- the stray "ready to open" line.

## Scenarios D–G on `bab915357`, 11:45–11:59 UTC

Typed Q turns in Chromium (1440×900) as the seeded fictional accounts, with marker checks before every sign-in. Product writes were made only through the product API (one fulfilment). Results were read with read-only SQL. Screenshots are in [`../evidence/2026-11-16-scenarios-d-g/`](../evidence/2026-11-16-scenarios-d-g/). Model spend was about USD 0.27 (ledger `2bbd6a7a`). Latency is the time to a settled answer in the browser; run time is server-side.

### D: private to shared (Thames Arc on Halyard)

| Step                                                                            | Ask / action                                                                                                                             | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 (conversation `ec7079d2`, run `585e27d3`, USD 0.0146, 15 s)                  | "How much cash does Halyard Security actually have in the bank right now?"                                                               | Q read the management accounts and KPI pack (`data_room.read` plus 2 × `document.pages.read`). It answered "£388,070 at 31 October 2026 … company-reported … the bank statements for August to October are still outstanding", citing the diligence requests. It created no duplicate request. `relationship.get` showed the open request `838e62bc`, and the data-room listing did not include the bank statement. **PASS (minor):** "outstanding" implies the request without saying "you already asked for it". `public_web.search` ran on an own-records question (`research: EXPLICIT`). |
| Fulfil                                                                          | Halyard's founder, `POST /v1/network/relationships/d8909e27/diligence/requests/838e62bc/fulfil {documentId: hs-bank-statement 38864c09}` | 201, policy `1a3a13c5`. The request is now FULFILLED by `38864c09`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Access checks (API)                                                             | Thames Arc / Savanna                                                                                                                     | Thames Arc: the data room lists it; diligence download 200; `data-room/…/open` 404, the same as the cap table fulfilled by request. Savanna: open 404, `GET /v1/documents/:id` 404, diligence download 404, not listed.                                                                                                                                                                                                                                                                                                                                                                       |
| D2 (same conversation, run `d58a4564`, USD 0.0641, 16 s)                        | "Halyard has just answered the bank statement request. Does the bank balance agree with their management accounts?"                      | **FAIL.** `executionClass: ANSWER_FROM_CONTEXT`: no document or relationship tool ran (only `public_web.search`). Q said the request is "still outstanding" and called the user's statement a conflict with "the latest record". The screenshot shows the working state; the answer is from the database.                                                                                                                                                                                                                                                                                     |
| D3 (new conversation `0deafa06`, run `8ce44fc0`, USD 0.0142, 17 s)              | "Does Halyard Security's bank statement balance agree with the cash in their management accounts?"                                       | **PASS.** Q read the management accounts and the bank statement (`38864c09`): "the October closing balance of £388,070 (p. 1), matching the £388,070 cash at month end … document-supported but not independently verified."                                                                                                                                                                                                                                                                                                                                                                  |
| D4 Savanna negative (conversation `84100201`, run `7cef5d87`, USD 0.0223, 16 s) | "What closing balance does Halyard Security's latest bank statement show?"                                                               | **PASS.** "I can't see a Halyard Security bank statement". Q gave only the deck figures (£480k at 30 Sep, about £70k burn, 6.9 months) and pointed to expressing interest. No tool result contains 388,070, the document id or its title. Defect: Q also read Watchly's and Rankpay's data rooms and figures for this Halyard question.                                                                                                                                                                                                                                                       |

**D verdict: PARTIAL.** Sharing and denial behave correctly, and a fresh question reconciles the statement. A follow-up in the same conversation answers from stale context and denies the fulfilment.

### E: comparison (Savanna on Halyard, Tensorgate, Nixo)

Conversation `216bceab`, run `06de74f3`, USD 0.0216, settled at 45 s (run 38 s). Ask: "Put Halyard Security, Tensorgate and Nixo side by side for me: how strong is each business on the evidence, and separately how well does each fit our mandate?"

- **Separation holds.** Mandate fit is shown apart from business strength: Tensorgate 8/10 and Nixo 7.5/10, with each measure known or unknown. Tensorgate's geography mismatch is named, and unknowns are written as unknown.
- **No leakage.** Q read Tensorgate's shared KPI pack and management accounts. For Nixo it saw only the profile (`figures.read` NONE). Q did not open any private Halyard or Nixo document.
- **Halyard missing.** Halyard dropped out of the side-by-side table. `company.search` was called with the query "Put Halyard Security"; it found Halyard, but no fit, figures or deck read followed. Instead Rankpay's deck, figures and data room were read, though Rankpay was not asked about. The text then says Halyard's "sector, stage, geography … are not established", which is false, because its network-visible profile states them.
- **Contradictions in the answer.**
  - It says "Neither Capital Q's records nor the sources I read give a figure for ARR yet" right after "USD 360,000 of contracted ARR", and does the same for runway.
  - The Tensorgate card says "no source documents yet" while 8 documents are shared.
  - It never quotes the October management-accounts burn (152,800) or runway (6.2 months), although it read them.
  - The round-terms cell says "Not known: Post-money SAFE, $30m cap in their deck".
- **Copy defect.** "this comparison uses the I have on record only" is missing a word.

**E verdict: PARTIAL.** Mandate fit is kept separate and there is no leakage. One of the three companies was not compared, and the answer contradicts itself.

### F: GateQ (Thames Arc, application `0490be41`, IN_PROGRESS, not submitted)

- **UI.** `/gateq` for Thames Arc shows "No applications yet" (screenshot `F1-thames-t0.jpg`). The IN_PROGRESS draft (15 statements, 1 CORRECTS link, pre-seed → seed) is not visible to the investor. That is consistent with an unsubmitted draft staying with the founder.
- **Q in the dock on `/gateq`** (the dock reused conversation `0deafa06`, run `11daded9`, USD 0.0654, 19 s). Ask: "Where has Halyard Security got to with its GateQ application to us …". Q answered from the diligence record: Halyard "progressed to diligence rather than remaining at the GateQ application stage", two answered requests, "no open diligence requests".
- **Q in a fresh conversation** (`cf2365c5`, run `b6b09a05`, USD 0.0254, 39 s). Ask: "What stage did they give, and are any of their GateQ answers still unresolved?" Q said "Halyard Security entered GateQ at seed stage … its GateQ diligence is now in progress". Neither run had a GateQ tool. The stage came from the deck, and diligence was mislabelled as GateQ. Q did add that "the record does not include the actual GateQ application answers".

**F verdict: PARTIAL.** The draft stays private, which is correct. The correction history cannot be shown to the investor before submission, and submission was not done, on purpose. Defect: Q attributes deck and diligence facts to GateQ ("entered GateQ at seed stage") without reading any GateQ record.

### G: founder intelligence (Halyard's founder)

Conversation `f6415253`, run `b87ad973` (USD 0.0067), plus a delegated job (USD 0.0326), settled at 183 s. Ask: "We want to close the seed round. What are the most important gaps investors will push on, and which of our documents actually back up the numbers we're claiming?"

- **Turned into a background job.** Routing `teamJob: true`. It produced the private analysis "Halyard Security: seed-round investor gaps and evidence map" with three prioritised actions and "12 points … still open".
- **Sources cited.** The deck, the old cap table (30 Sep), the key NHS contract summary, `hs-customer-contracts` and the phishing-method note.
- **Gaps.**
  - It did not use the founder's own management accounts, invoice register, revenue breakdown, KPI pack, `hs-cap-table` or bank statement. Those are mostly HIGHLY_CONFIDENTIAL, so this is consistent with `heldBackFromQ` applying even to the owner.
  - As a result, Q asks the founder to "reconcile revenue and gross margin" and "provide cap-table … evidence" that is already uploaded.
  - It misses the seeded deck 82% against accounts 29.3% gross-margin contradiction, and the burn/runway drift (70k and 6.9 months against 92,340 and 4.2 months).
- **Display.** The chat truncates the list items mid-sentence ("5,303…", "approved…").

**G verdict: PARTIAL.** The guidance is prioritised and specific to Halyard, and it is not a checklist. It is not short: a 3-minute job, and the summary is cut off mid-sentence. It ignores the founder's strongest documents.

### Defects found

1. **Stale follow-up.** A same-conversation follow-up after a state change answers from context (`ANSWER_FROM_CONTEXT`). It does not re-read the relationship or documents, and it contradicts the user (run `d58a4564`).
2. **Expensive classification fallback.** The first FAST_CLASSIFICATION model times out at 2.5 s. Every follow-up then falls back to a second model with about 38k input tokens, at USD 0.058–0.059 each (runs `d58a4564`, `11daded9`). That is about 4× the cost of a whole fresh turn. It also happened at lower cost in `7cef5d87` and `06de74f3`.
3. **Wrong subject resolution.** The company query was taken with the verb ("Put Halyard Security"), Halyard was dropped, and unrelated companies (Rankpay, Watchly) were read (runs `06de74f3`, `7cef5d87`).
4. **Contradictory comparison.** In the comparison answer, "no figure for ARR/runway" sits next to the stated figures, and the card says "no source documents yet" though 8 are shared (run `06de74f3`).
5. **No GateQ tool.** Q has no investor-side GateQ application tool, and it labels deck stage and diligence as "GateQ" (run `b6b09a05`).
6. **Founder's documents held back.** The founder's own HIGHLY_CONFIDENTIAL documents are held back from the founder's own Q job, so Q asks for evidence the founder already has (delegated job for `b87ad973`).
7. **Needless web search.** `public_web.search` runs on own-records and diligence questions (`research: EXPLICIT`) in every investor run.
8. **Truncated chat items.** The job summary in chat cuts list items mid-sentence.

## Rerun on `a5f3d95e9` (13:03 UTC)

Savanna, conversation `4b9a3278`, new wording. Answers were correct throughout:

- burn of $152,800 for October from the shared accounts, set beside the deck's ~$135,000 for 30 September;
- runway of 6.2 against 8.1 months;
- both documents named, with the deck figures on p. 10.

Still open:

- **Turn 1 took 21.8 s.** All reads finished by 5.4 s. The time went to:
  - three classification calls that hit their 2.5–3.0 s limits, then an 8.8 s fallback classification;
  - two answer rounds, the second running `company.search` and `public_web.search` at 12.8 s.
- **Reasons not given:** turn 2 still did not explain the reasons for the difference.
- **Unneeded page moves:** each figures turn opened the company profile ("I've opened the company profile."), against decision 98.

All three are in the scope of the worker fixing defects 2 and 7.

## Rerun on `8647c718c` (14:13 UTC)

Savanna, conversation `1e659dc4`; USD 0.06 (ledger `c0aa24a6`). All answers were correct.

- **Figures:** burn and runway came from the shared accounts (p. 1). The KPI pack agrees, and the deck's figures were given alongside.
- **"Why does the deck show a different number?":** Q said the deck is an earlier snapshot (Sep vs Oct), which explains the runway difference. It said the documents do not state why burn changed.
- **"Line up Halyard Security, Tensorgate and Nixo":** all three companies appear. Mandate fit (Halyard 8.3, Tensorgate 8.0, Nixo's cheque fit untestable) is kept apart from how well each is evidenced. Q flagged Tensorgate's GateQ application asking for $1.5m against $4m in the deck.

**Latency, from the q-api `q answer produced` logs:**

| Run                                   | Total  | Answer call              | Prompt (chars) | Tools offered |
| ------------------------------------- | ------ | ------------------------ | -------------- | ------------- |
| Figures (`b0ea3d06`)                  | 17.8 s | 7.0 s, two model rounds  | 87k            | 112           |
| "Why does the deck…" (`84be6936`)     | 26.9 s | 16.4 s, reasoning MEDIUM | 106k           | 100           |
| Three-company comparison (`6497c94c`) | 27.8 s | 19.6 s, reasoning MEDIUM | 97k            | —             |

The prepare phase took 3–9 s across the three runs. The worker cutting latency has the details.

**Page moves:** company overview for the figures question, deck tab for the deck question. Both are within decision 98.

## Scenario G rerun on `b156a9cd1` (15:04 UTC)

The account was Halyard Security's seeded founder, with the `fictional_demo` and `synthetic` markers checked first. Conversation `d3d81729`. Decision 100 and ADR 0079 were live. Each ask was in new wording. Screenshots: `evidence/2026-11-16-scenario-g-b156a9cd1/G-t0…t4.jpg`.

| Turn | Ask (abridged)                                                                           | Run        | Time | USD    | Document reads                                                                                                 |
| ---- | ---------------------------------------------------------------------------------------- | ---------- | ---- | ------ | -------------------------------------------------------------------------------------------------------------- |
| 1    | "what's most worth fixing first? Keep it short and prioritised"                          | `278141d8` | 22 s | 0.0054 | deck, figures, profile only                                                                                    |
| 2    | "Which of the figures we're claiming do our own documents actually back up…?"            | `5f75f14f` | 30 s | 0.0246 | none (figures, deck, `records.own.read` readiness)                                                             |
| 3    | "Does anything in our own documents contradict what the deck says? Margin, burn, runway" | `d178c978` | 15 s | 0.0154 | none by tool; it cites the KPI pack, p. 1 (CONFIDENTIAL)                                                       |
| 4    | Probe: "What do our management accounts show…, and does the invoice register back up…?"  | `c5b0f789` | 33 s | 0.0292 | `document.pages.read` on management accounts `7d1605cc` and invoice register `5ce41404`, with `ownCompanyRead` |

- **Routing:** no background job. Turn 1 was ADVICE with `research: EXPLICIT`, but no web search ran. Turns 2–4 were THEIR_OWN_RECORDS.
- **Cost:** the total was USD 0.0746 across 25 model calls (ledger `2b934663`, reserved 0.60).

**What worked**

- **Turn 3 found every contradiction.** These are the 82% against 29.3% gross margin ("explicitly including the deployment team in cost of sales"), burn of £70k against £92,340, and runway of 6.9 against 4.2 months, plus cash of £480k against £388,070. Each came with a short three-step fix: one reporting date, one margin definition, and a Sept→Oct cash bridge. The list items were whole.
- **Turn 1 was short and prioritised.** It had four whole items, with no mid-sentence cuts, which fixes defect 8.
- **Turn 4 worked when the documents were named.** Q read the founder's HIGHLY_CONFIDENTIAL management accounts and invoice register under `ownCompanyRead` and cited p. 1. It reported the 29.3% gross margin against an 82.0% licence-only margin, and it explained that the deck's 82% is the licence margin. It also reported £92,340 burn and 4.2 months of runway. The invoices matched revenue: £73k in October and £85k in September, with £71k of October receipts. It called the figures unaudited and not verified, as ADR 0079 §5 requires.

**What did not**

- **Q did not open the strongest documents unprompted.** In the three scenario asks, no `company.data_room.document.read` or `document.pages.read` call ran. Q never opened the management accounts, invoice register, bank statement, monthly revenue or projections.
- **Turn 2 contradicts the documents and the next turn.** It says the deck's cash, burn and runway have "no separate financial record here [that] corroborates them". Two management-accounts files, a bank statement and the KPI pack are all uploaded, and turn 3 then quotes the KPI pack. Turn 2 also asks for "signed contracts or invoices, … bank statements", which are already uploaded. Its answer runs to about 3.2k characters, so it is not short.
- **Turn 1 asks for documents Q already has.** It says "the cap table … should follow" (two cap tables are uploaded) and asks for a cash bridge without opening the accounts.
- **The contradiction came from a document Q could already read.** Turn 3's contradiction came from the CONFIDENTIAL KPI pack, which was readable before ADR 0079. It did not come from the newly unlocked accounts.

**Verdict: PARTIAL.**

- **The read path works.** Turn 4 shows that ADR 0079 works in production with correct provenance and wording.
- **The scenario's main contradictions now surface.** Turn 3 brings out the margin, burn and runway differences, and list items are whole.
- **Defect 6 is only half fixed.** Q is now allowed to read the documents, but it does not choose to. A founder's "what do my documents back up / contradict" question should list and read the HIGHLY_CONFIDENTIAL financial documents without being named. Until it does, Q will still say records are missing (turn 2) and ask for documents that are already uploaded.
- **Suggested next fix:** for THEIR_OWN_RECORDS questions about figures or contradictions, plan `documents.uploaded.list` plus page reads of the MANAGEMENT_ACCOUNTS and FINANCIAL documents in the prepare phase.

## Timing on `77187e4aa` (16 Nov, 17:02 UTC)

The reasoning migration `20261231594500` was applied before the deploy (hosted 305 applied). Savanna, conversation `db74c76d`, new wording.

| Turn                                  | Run total, before (`8647c718c`) | Run total, now | Browser settle, now |
| ------------------------------------- | ------------------------------- | -------------- | ------------------- |
| Figures                               | 17.8 s                          | 15.4 s         | 21.8 s              |
| "Why is the deck's number different?" | 26.9 s                          | 11.3 s         | 17.7 s              |
| Three-company comparison              | 27.8 s                          | 17.2 s         | 14.7 s              |

**Answers:** all correct. The "why" turn now says the documents do not explain the difference, and labels its September-vs-October explanation as an inference.

**Still open:** the turn reader makes up to four classification calls of 2.2–4.0 s each, and is now the largest share. q-api's database pool (`DATABASE_POOL_MAX=3`, session pooler) adds queueing; a decision on that is pending with the owner.

## Scenario G on `1626553fb` (16 Nov, 17:45 UTC)

Halyard's founder, conversation `04029d55`, new wording. Screenshots: `evidence/2026-11-16-scenario-g-1626553fb/`. The first attempt hit a stale browser profile that showed the app's "You're offline" page; a fresh profile fixed it.

| Turn | Ask                                                                | Result                                                                                                                                                                                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | "Before we go out to raise, what should we tighten up first?"      | **PASS (24.5 s).** Q gave the deck against the management accounts: 82% vs 29.3% gross margin, ~£70k vs £92,340 burn, 6.9 vs 4.2 months runway. Then traction proof, and how 64,000 enrolled staff relates to 71,000 seats and £852k ARR. **Minor:** it suggests "bank, revenue and contract evidence" although a bank statement is already uploaded. |
| 2    | "Which of our numbers are actually backed by what we've uploaded?" | **PASS (18.6 s).** `documents.uploaded.list` and page reads ran. Q split the numbers into backed (raise terms, cap table percentages, incorporation date), partly backed (invoices, enrolment method) and not cleanly backed (ARR, seats, customer count, margin, burn, cash, runway).                                                                |
| 3    | "Is there anything in our own files that disagrees with the deck?" | **PASS (14.5 s).** Q gave the margin, burn and runway differences with periods. It noted the accounts show 82.0% as licence-only margin, and found a traction mismatch (the NHS contract covers 9,800 users, with no bridge to the deck's totals). It called these reconciliation issues, not errors.                                                 |

## Scenario D rerun on `d252444b1` (16 Nov, 18:19 UTC)

Thames Arc's investor, one conversation `8811f9c7`, with fix `b396c307f` live. Accounts were marker-checked (`fictional_demo`, `synthetic`) and a fresh browser profile was used. `hs-projections-2027` is already shared with Thames Arc (relationship `d8909e27`), so the test used `hs-team-hiring-plan` (`c0d522b1`), which was PRIVATE with no grants. Screenshots: [`../evidence/2026-11-16-scenarios-df-d252444b1/`](../evidence/2026-11-16-scenarios-df-d252444b1/) `D-t1.jpg`, `D-t2.jpg`.

| Step                                                                          | Ask / action                                                                                                                                         | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before                                                                        | API checks                                                                                                                                           | Thames Arc and Savanna: `GET /v1/documents/:id` 404, data-room `open` 404, not listed in Halyard's data room.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D1 (run `73eebc9b`, USD 0.0921, run 15.5 s, settle 21.7 s)                    | "What does Halyard Security's hiring plan say about the roles they'll recruit in 2027 with the seed money, and when each one starts?"                | **PASS.** "Halyard Security's hiring plan is not among the authorised materials I can read." It gave the deck's 35% deployment-team allocation and pointed to the shared projections. No tool result contains `c0d522b1`. **Cost defect (2) again:** two FAST_CLASSIFICATION calls timed out at 4.0 s, then a 36.5k-token fallback cost USD 0.0748 (81% of the turn).                                                                                                                                                                                                  |
| Share                                                                         | Halyard's founder, `POST /v1/data-room/documents/c0d522b1/grants {relationshipId d8909e27, accessLevel view, days 90, fileIn team}`, Idempotency-Key | 200 `{changed: 1}` at 18:20:04. The document is now SHARED_ONLY with one view grant to `d8909e27`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| After (API)                                                                   | Thames Arc / Savanna                                                                                                                                 | Thames Arc: listed in the data room, `open` 200 (`GET /v1/documents/:id` stays 404, the owner route). **Savanna: `GET /v1/documents/:id` 404, `open` 404, not listed.**                                                                                                                                                                                                                                                                                                                                                                                                |
| D2 (same conversation, run `b0a877f8`, USD 0.0176, run 14.6 s, settle 20.7 s) | "Break that down for me: how many people per role, and in which quarter does each group start?"                                                      | **Freshness PASS.** `executionClass: CONTEXTUAL_FOLLOW_UP`, but Q re-read the data room (now listing `c0d522b1`) and `relationship.get`, then `company.data_room.document.read {document: "Team and hiring plan"}` (status READ, `DOCUMENT_SUPPORTED`). The user restated nothing. The answer: "five 2027 groups, adding 15 people … 4 public-sector account managers and 1 information security and assurance manager in Q1; 6 deployment engineers and 4 product engineers in Q2; and 1 finance and operations manager in Q3 … projected hires, not actual results." |

**Defects in D2.**

- **Wrong figure in the prose.** The document says **3** public-sector account managers. Q's own structured finding says 3, but the prose says 4, so the parts add to 16 against the stated total of 15.
- **No page cite.** The plan is one page, but `pageCount` is null and the findings have empty `evidenceRefs`. The answer shows no "p. 1".
- **Wrong closing offer.** It ends "Want me to ask Halyard Security for a document that would settle this?" although the document was just read.
- **Noise reads.** `company.search` ran with the queries "quarter" and "each group start". Both turns also read the GateQ summary, the bank statement and the management accounts for a hiring question.

**Verdict: PARTIAL.** The `b396c307f` freshness fix works: the same conversation picks up the new share without restating, and Savanna is still refused. The answer misstates one figure and has no page cite.

## Scenario F on `d252444b1` (16 Nov, 18:21 UTC)

Thames Arc's investor, new conversation `6233d75a`, run `5690a49c`. Application `0490be41` is SUBMITTED (15:44:01 UTC). The run was `MULTI_SOURCE`, `THEIR_OWN_RECORDS`, `research: NEVER`. It cost USD 0.0205 over 6 model calls (one classification failure). The run took 12.8 s, and the browser settled at 18.7 s.

- **Ask:** "Halyard Security has sent us a GateQ application. What does it actually say about their gross margin and their stage, and what's still unresolved in it?"
- **Tools:** `app.own.read {kind: gateq}` and `app.gateq.inbox.summarise {applicationId: 0490be41}`, then figures, deck, data room, `relationship.get`, and page 1 of the management accounts (`7d1605cc`) and the bank statement (`38864c09`).
- **Answer:** "current GateQ stage is **Seed**; the earlier **Pre-seed** entry is explicitly superseded … the application initially cited 82%, but Halyard's correction says that is licence margin … **29.3% gross margin for the 12 months to October 2026**, because deployment-team payroll is included in cost of sales. Still unresolved: Problem, Customers, Market, Traction, Revenue, Team, and Use of funds are all marked missing … the sector criterion does not meet your stated focus; that is a mandate-fit issue, not an unanswered application field."
- **Provenance:** every GateQ finding cites `source: "Their GateQ application (submitted 16 Nov 2026)"`, `asOf 2026-11-16T15:44:01Z`, `USER_CLAIM` / `SELF_REPORTED`. The 29.3% finding also cites the data-room management accounts (`DOCUMENT_SUPPORTED`). The split notes ("29." / "3%.") do not appear. Mandate fit is kept apart from the application's content, and no deck or diligence fact is labelled as GateQ.
- **UI (`F-end.jpg`, read-only, status unchanged):** `/gateq` Inbox shows Halyard Security, "Qualifies", "Meets every required rule of your gate; 1 preferred rule isn't met", "Submitted 16 Nov. Frozen at submission.", round GBP 3,000,000 equity, and Traction, Revenue, Customers and Market "Not covered". The dossier below shows Stage Seed.
- **Minor issues:**
  - "the application initially cited 82%" is slightly loose. The application's note says the deck's 82.0% is licence margin.
  - The dossier's founder's note shows the correction text three times (the known duplicate-note quirk from relationships §8), so the investor can see the repetition.
  - Reading the bank statement was not needed for this question.

**Verdict: PASS (minor).** This is the ca639a8f0 fix: Q reads the submitted application through a GateQ tool, cites it by name and date, shows the pre-seed→seed correction and the whole 29.3%, and keeps non-GateQ facts separately labelled.

**Spend:** USD 0.1302 across 3 runs (budget ledger `c95983ac`, reserved 0.80).

## Scenario D recheck on `927f25ddd` (16 Nov, 19:40 UTC)

Thames Arc, new conversation `e7e3c866`. Screenshots: `evidence/2026-11-16-scenario-d-927f25ddd/`.

**FAIL on the count.** Asked "How many people is Halyard Security planning to hire next year, and in which roles?", Q said 15 hires, including "4 public-sector account managers". The document and fixture say 3, so the parts sum to 16. The follow-up "Which quarter does each group start?" repeated 4.

Turn 1 also ran `public_web.search`, two `company.search` calls and `app.gateq.inbox.summarise`, none of which a hiring question needs.

A fix is in progress. It covers table layouts in the extracted text, a total stated in a different sentence from the parts, the follow-up turn, and the web and GateQ reads.

## Scenario D recheck on `a65386689` (16 Nov, 21:33 UTC)

Thames Arc, conversation `2a26d43b`. Screenshots: `evidence/2026-11-16-scenario-d-a65386689/`. Migration `20261231596000` was applied before the deploy; the investor names now read "Savanna Seed Partners" and "Thames Arc Capital".

**Still FAIL on the count.** Asked "What hiring does Halyard Security have planned for 2027, by role?", Q said "4 public-sector account managers" and "5 in Q1". The stored chunk row reads "Public-sector account manager | Sales | 3 2027-Q1". The follow-up, answered from context, repeated it.

Web search and the GateQ read no longer ran. A fix is in progress: code-extracted table rows given to the answer as facts, and the check bound to those rows on both turns.

## Scenario D recheck on `9c7b38925` (16 Nov, 23:09 UTC)

Thames Arc, conversation `28071f0c`, run `a1777c9a`. Screenshots: `evidence/2026-11-16-scenario-d-9c7b38925/`. The database safety fix `6a0fa2274` is also live, with no timeout or stall errors seen since.

**FAIL again, the third failure of this shape.** Q said "four public-sector account managers" (the source says 3), and on the follow-up "five hires in Q1" (the source says 4). No claim-check log line appeared for the run.

Q's earlier wrong answers were persisted to memory and recalled into new conversations. Next steps:

- mandatory claim-check diagnostics;
- a replay built from this run's real stored data;
- memory integrity: Q's own answers are never recalled as figure evidence, and corrections supersede the stored item.

## Scenario D recheck on `827cc7763` (17 Nov, 00:16 UTC): root cause visible

Thames Arc, conversation `1de1cf20`. Q still said "4 public-sector account managers … 5 hires" in Q1.

The new `q claim check` log line shows why. Run `434ead80` had:

- sources `facts 44, retrieved 0, documentRows 0, toolResults 0, memory 1, earlierReplies 1`;
- `tables 0`;
- answer `examined 5, bound 0, unplaced 5`.

So the hiring plan was not retrieved or read at all: the answer came from recalled memory of Q's own earlier wrong answers. The follow-up `2b4011a0` was the same: memory 1, earlier replies 2, tables 0.

The fix in progress:

- a document-backed question whose only figure sources are memory or earlier replies reads the document first;
- counts that nothing binds are withheld;
- stale memory is superseded.
