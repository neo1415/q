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

## Re-run on `61b7a8539` (over-asking commits 1+2, live-gap fixes; 08:20 UTC, $0.297)

**Q 85.7% vs bare 95.2%** (was 81.0% vs 97.6%; the same 11 cases, but live replies vary).

- Wrong-entity turns: 0.
- AMBIGUITY: Q 66.7% vs bare 33.3%.
- FOLLOW_UPS, NUMBERS and ADVERSARIAL: 100%.

Still failing:

| Case       | Problem                                                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AMB-136 #0 | "Silo" answered as Silo Credit. The name-candidates path didn't fire live; the reader probably doesn't put the partial name in `namedOther`.                |
| CMP-061 #0 | "It reports $2.4M…": the subject is still unnamed.                                                                                                          |
| ORD-016 #0 | A list reply omitted Silo Credit.                                                                                                                           |
| UNK-076 #2 | A correct refusal ("turning that into ARR would be fabrication"). The grader wants the subject named.                                                       |
| MEM-121 #1 | Recalled the pass reason but not the runway criterion.                                                                                                      |
| CON-091 #2 | The grader scored a labelled derivation ($310k × 12 = $3.72M, "my calculation") as invented. That is a grader policy question; the grader was not loosened. |

## Re-run on `7a41ff4d0` (live gaps round 2; 09:05 UTC, $0.297)

**Q 95.2% vs bare 97.6%** (was 85.7% vs 95.2%).

| Measure                  | Q    | Bare  |
| ------------------------ | ---- | ----- |
| References resolved      | 100% | 97.6% |
| Ambiguous asks clarified | 100% | 0%    |
| Helpfulness              | 5.00 | 4.91  |
| Wrong-entity turns       | 0    | 0     |
| Invented figures         | 0    | 0     |

Still failing:

| Case       | Problem                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ORD-016 #0 | The list gave only Silo Credit; Silo Health and Brightpath were omitted.                                                                                |
| UNK-076 #2 | A correct refusal ("isn't established here, and I won't invent one"). The grader's unknown markers miss "isn't established", so this is a grader check. |

Latency is unchanged: Q p50 7.3 s against the bare model's 1.1 s.
