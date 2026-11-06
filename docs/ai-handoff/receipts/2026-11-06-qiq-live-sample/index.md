# Live Q-IQ sample on `8dec401e0` (one case per category, 6 Nov 07:05 UTC)

Run in the integration owner's local world (gpt-5.6-luna, local PG, all migrations). Total cost was $0.339:

- PRO-001 alone: $0.033
- 11-case sample: $0.306

The per-turn replies are in the JSON files beside this index. All data is fictional seed data.

## PRO-001 after the over-asking fix

4/4 pass:

- "she" → Ngozi Eze, 2022
- "his" → Tunde Bakare, bank credit lead
- "they" → Silo Credit, $6M

## 11-case sample: Q 81.0% vs bare model 97.6% (turns)

Q invented no figures, and every multi-part ask was answered.

| Case       | Behaviour | Problem                                                                                                           |
| ---------- | --------- | ----------------------------------------------------------------------------------------------------------------- |
| ORD-016 #4 | ANSWER    | "Silo Health's gross margin isn't on record". It is (48). The unknown is wrong.                                   |
| FUP-031 #3 | ANSWER    | Missing 14 (an earlier or conflicting figure not surfaced).                                                       |
| CMP-061 #0 | ANSWER    | "It reports $2.4M…" without naming Silo Credit.                                                                   |
| UNK-076 #1 | UNKNOWN   | "Its monthly burn is $60k…" where unknown was expected. $60k is Kora Farms' burn: a possible cross-entity figure. |
| NUM-106 #2 | ANSWER    | "I don't have a sourced figure for burn yet". Expected 2,160,000 (derived). The claim check likely stripped it.   |
| AMB-136 #0 | CLARIFY   | "Silo" is ambiguous, but Q answered with Silo Credit (the bare model doesn't clarify either).                     |
| AMB-136 #2 | ANSWER    | Wrong entity on "the other one".                                                                                  |
| ADV-151 #1 | UNKNOWN   | Correctly refused the runway, but the phrasing didn't match the unknown grader (a grader check is needed).        |

Latency (whole reply): Q p50 7.5 s against the bare model's 1.0 s.
