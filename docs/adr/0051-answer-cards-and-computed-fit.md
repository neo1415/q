# ADR 0051: Q answers as cards, with fit computed by code

Status: Accepted (founder brief 2026-10-05, items B2, C1-C5, C9)
Amends: COMPANY_ANALYST charter rule "produce no score, rating, ranking" (v2 onward); ADR-001 is unchanged.

## Context

On 5 October the founder asked Q for "the companies in my feed ranked against my mandate", for "three startups side by side" and for Y Combinator research. Q answered with a paragraph, with a Markdown table plus comparison cards plus an unasked PDF, and with bullets. The brief asks for coloured cards with a score out of 10, three reasons and measures, focused as Q speaks, and no PDF unless asked.

The analyst charter forbade any score or ranking because no calibrated methodology existed, and that rule stands for the model.

## Decision

1. A new result block `ANSWER_CARDS` (`packages/contracts/src/q/answer-cards.ts`) with shapes RANKED, SIDE_BY_SIDE and RESEARCH, 1-10 cards.
2. The model (COMPANY_ANALYST v17) fills `answerCards`: names, reasons, a level per measure (STRONG, GOOD, PARTIAL, UNKNOWN), Q's view and one spoken line per card. It never writes a number.
3. Code (`packages/model-gateway/src/q/answer-cards.ts`) computes **fit out of 10** as the mean of the known measures (STRONG 10, GOOD 7.5, PARTIAL 4), leaves UNKNOWN out and reports `measured` of `of`, gives no fit with fewer than three known measures, orders RANKED answers by fit (ties keep the model's order), and assigns colours. It is fit against what the person declared, never business quality.
4. TURN_READER v43 makes a document only when a file is asked for; wanting to see a list, top N, comparison or research is an answer shown on screen.

## Consequences

- The same reading always gives the same score and order; the score is explained by the measures on the card.
- Weights are one table in code. The deterministic multi-parameter match score (B1) can replace the level reading later without changing the contract.
- The level per measure is a Q inference over evidence and is shown as such (word plus shape).
