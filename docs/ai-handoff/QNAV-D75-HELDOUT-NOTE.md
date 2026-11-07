# q-nav, decision 75: the sealed held-out run (by category only)

The fresh held-out set ran once, live on `44a79ef` ($1.31). The receipt is `receipts/2026-11-07-qnav-d75-heldout.json`.

|                                 | pass  | decision | move-target | wrong-page | forbidden |
| ------------------------------- | ----- | -------- | ----------- | ---------- | --------- |
| held-out (264 turns, fresh set) | 88.6% | 95.5%    | 86.9%       | 1.1% (3)   | 0         |
| dev r4 (500 turns)              | 94.8% | —        | 94.5%       | 0.4%       | 0         |
| old held-out (pre-75, spent)    | 78.8% | —        | 75.2%       | 3.9%       | 0         |

**Scope.** This note uses only the category counts the receipt reports. No held-out row, sentence or proposal was read. The set is now spent. Moves stay OFFER-only. Docs only: no tuning.

## 1. What generalised

- **Deciding whether to move at all.** Decision is 95.5% on held-out. Telling a page request from a question Q answers in chat, from advice, from a list made for the question, from no-such-page and from the other side's pages now transfers to wording nobody tuned against.
- **Records.** RECORD is 97.4%. Naming companies, investors, threads, documents and editions, then resolving them in code, holds.
- **Safety:**
  - forbidden is 0 again;
  - wrong-page fell from 3.9% to 1.1% against the previous held-out set;
  - the dev-to-held-out gap shrank from about 12 points to about 7.6.
    So reasoning from purposes generalises much better than matching titles did.
- **What doesn't fully transfer is precision.** Decision is 95.5%, but move-target is 86.9%, so most of the remaining misses are the right decision with an inexact place: a different tab or section, or an OFFER from a needless alternative. COVERAGE, at 83.7%, carries most of it.

## 2. The three wrong-page moves, by category

| Category                     | What kind of turn it is                               | Likely cause (category level)                                                                                                                                                                                                          |
| ---------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NOT_THAT_ONE (1 of 10 turns) | A correction over several turns ("no, the other one") | Finding which other record or place they mean from RECENT TURNS. The prompt says it plainly but gives the model no structure for "the other one": the candidates shown before. A reference-resolution problem, not a page-meaning one. |
| TWO_ASKS (1 of 5)            | Two requests in one turn                              | Choosing which ask to serve. The rule "the one they ask to see, else the last" is applied inconsistently when both are questions.                                                                                                      |
| COVERAGE (1 of about 86)     | One page-level ask                                    | A neighbouring page with an overlapping purpose. That's a 1.2% rate in COVERAGE.                                                                                                                                                       |

COLLAPSED_PANE has a move-target of 33% (no wrong-page). The likely cause is structural: with the pane collapsed, a question gets STAY with the target remembered. When the model itself decides STAY, it names no place, so there's nothing to remember. The prompt doesn't tell it to name the place as if the pane were open (code handles the collapse). This is a prompt fix that should generalise.

## 3. What could close the gap to 95% on a fresh held-out set, and what it would cost

I don't think another round of prompt rules on this design will get there honestly. Each rule now trades coverage against safety, as r3 and r4 showed. Three structural changes could, roughly in order of value:

1. **Self-consistency voting** (the strongest lever for safety and precision):
   - Run the decision 3 times (temperature > 0) and MOVE only when all three name the same place. Two out of three agreeing gives an OFFER; otherwise STAY.
   - This cuts wrong-page and unstable precision without any rules, and it's the standard way to turn a model's own uncertainty into a calibrated OFFER.
   - Cost: the template and site map are cached, so each extra sample costs mostly its uncached turn tokens and output, about $0.006. That's about 3× per turn, roughly $0.018 a turn live. Latency stays about the same (the samples run in parallel beside retrieval).
   - It fits decision 73: more intelligence, paid for, not less.
2. **Higher reasoning effort for this one task** (a routing config change, not a code change): `reasoning_levels.NAVIGATION_DECISION = MEDIUM` instead of LOW. Corrections, two asks and ambiguity are reasoning tasks, and LOW is likely starving them. Cost is about +$0.002 a call in output tokens.
3. **A focused second look for precision.** After the model states the goal, show it only the candidate places with their full purposes: the pages, tabs and sections under the route it chose plus its alternative. It then picks the exact one. Candidates come from the site map structure, not from keyword or embedding matching. Cost is one more short call, about $0.003, plus about 0.5 s of latency, still inside the answer's own time.
4. **The collapsed-pane prompt fix** above. It's free, and it's a rule about how the pane works, not about words.

**How to measure it honestly:**

- One dev round with 1 + 2 (+4) is about $9 with voting (500 × about $0.018).
- Then a NEW held-out set: a third one, written again by an independent author from what the pages do, and sealed before the dev run. About $5 with voting.
- With about $25 of the $50 used, that's about $14: within budget, with room for one fix-up round.

**What I wouldn't do:** add rules or examples drawn from these misses, or reuse this held-out set. Both would only move the number. They wouldn't make Q understand more.

## Recommendation (owner decides)

Keep batch 3 OFFER-only. Its safety record (wrong-page 1.1% on unseen wording, 0 forbidden) is good for offers, which cost nothing when wrong. If moves should go on, approve:

1. voting × 3 with reasoning MEDIUM, and the collapsed-pane fix;
2. a third sealed held-out set;
3. one dev round, then that held-out set once.

Ship moves only if that held-out set shows ≥95% move-target and ≤0.5% wrong-page.
