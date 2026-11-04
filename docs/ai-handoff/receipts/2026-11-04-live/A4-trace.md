# A4 trace: "What is their monthly burn?" on Ledgerline (4 Nov, production 55936724d)

These are read-only findings. Sources:

- q-api `deploymentLogs` for 55936724d, read through `scripts/handoff/live/railway/qlogs.mjs`;
- `GET /v1/companies/:id/deck` called as the fictional investor `investor.savanna-seed@fictional.capitalq.local`.

No new Q turns were made.

## The two runs

| Width | qRunId     | Conversation | Asked at (UTC) | Answer path                                                                                                                   |
| ----- | ---------- | ------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1440  | `a41b448b` | `c768b01d`   | 12:51:46       | `DEEP_ANALYSIS` because `RESEARCH`; 103 tools offered, 14 tool calls, 2 model calls; prompt 76,992 chars                      |
| 390   | `bcc26b15` | `77008cfc`   | 12:54:02       | "q answered a follow-up from what it already said" (`turn: 4`), so it reused its own A3 answer, which already said "burn … aren't available" |

Each conversation is a fresh one. The 390 dock carried on the 390 A1–A3 conversation.

## Tools called or prefetched (all `READ_ONLY`, all `SUCCEEDED`)

- **1440:** these ran before the turn was read (preread):
  - `relationship.get`
  - `company.figures.read` (86 ms)
  - `company.get` ×3
  - `company.deck.read` (167 ms, sensitivity `CONFIDENTIAL`)
  - `fit.profile`
  - `approvals.pending.list`
  - `company.search`
  - `relationship.own.list`
  - `q.work.list`
  - `schedule.list`

  After that came `public_web.search` (Brave + Tavily). It found 18 hits and kept 0: "public pages not about whom the search was for left out", so Q answered from the records alone.

  DB phases: `tool.read_company_figures:5`, `tool.read_company_deck:9`, `tool.get_company:33`.
- **390:** the same preread set:
  - `company.figures.read`
  - `relationship.get`
  - `company.get` ×2
  - `company.deck.read` (216 ms)
  - `fit.profile`
  - `approvals.pending.list`
  - `company.search`
  - `relationship.own.list`
  - `q.work.list`
  - `schedule.list`

  No web search ran. DB phases: `tool.read_company_deck:9`, `tool.read_company_figures:5`.

## Deck facts, screen route and subject

- **Deck facts:** no `COMPANY_DECK_FIGURES` entry and no deck fact count appears in any log line for either run. The deck read is visible only as the `company.deck.read` tool call and its DB phase.
- **Screen route and subject:** the plan's screen route and subject are not logged. The nearest signals are:
  - `prepareMs.page: 499` on the 1440 run;
  - `q turn read`: `question: THEIR_OWN_RECORDS`, `aboutNamedOther: true`, `research: EXPLICIT`, and `fromShown: null` (1440) / `"4"` (390).

  The dock's own header showed "Q can see: a company profile · Ledgerline" (screenshots `A4-1440.png`, `A4-390.png`).

## Firewall

- Both runs: `context firewall evaluated`, outcome `AUTHORISED`, task class `COUNTERPARTY_COMPANY_QUESTION`, `COMPANY_PROFILE` among the permitted scopes.
- `deniedReasons: [DISCLOSURE_DENIED, OWNER_ONLY, OWNER_ONLY]` on both runs.
- No tool reported a denial or a `failureCode`.

## Ledgerline deck as the investor reads it (`GET /v1/companies/6f075a0b…/deck`, HTTP 200)

- Extraction: version 1, reading 1, `confirmed: true`, read 2026-10-07.
- All 12 sections are `PRESENT` / `CONFIRMED`.

| #   | Section           | Facts |
| --- | ----------------- | ----- |
| 1   | PROBLEM           | 4     |
| 2   | SOLUTION          | 5     |
| 3   | VALUE_PROPOSITION | 4     |
| 4   | MARKET            | 8     |
| 5   | GO_TO_MARKET      | 6     |
| 6   | BUSINESS_MODEL    | 7     |
| 7   | TRACTION          | 8     |
| 8   | COMPETITION       | 5     |
| 9   | **FINANCIALS**    | 8     |
| 10  | THE_ASK           | 8     |
| 11  | FOUNDERS          | 2     |
| 12  | TEAM              | 8     |

**The burn fact is in FINANCIALS (section 9, deck page 9):**

- "Current monthly net burn = About $39,000" (`FIGURE`, `USER_CLAIM`, `SELF_REPORTED`, `HIGH`).
- "Planned monthly net burn after raise = Near $85,000".

The FINANCIALS summary also states cash of $410k at 30 Sep 2026, and conflicting runway figures of 10.5 and 5 months.

## Reading

The investor can read the burn fact. `company.deck.read` ran and succeeded on both runs, and the firewall authorised them. Even so, both answers said burn is not on record.

- **1440:** the fact either did not reach the answer prompt, or the model was not given it as a figure. Section 9 is the 9th of 12, so truncation or a filter on the deck tool output is a candidate. This is not verified.
- **390:** the run never reconsulted the records. The follow-up shortcut repeated the A3 answer, which had the same omission.
