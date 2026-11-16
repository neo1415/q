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
