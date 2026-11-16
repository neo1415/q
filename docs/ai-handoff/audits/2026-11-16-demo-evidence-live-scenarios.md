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
