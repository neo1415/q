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
