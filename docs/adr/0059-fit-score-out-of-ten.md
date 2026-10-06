# ADR 0059: Fit is shown as a score out of 10 beside its words

Status: Accepted (founder brief B, overnight 2026-10-06)
Amends: ADR 0052 §2 ("no score"), for the score out of 10 only.

## Context

ADR 0052 showed fit with a mandate in words only. ADR 0053 gave Q's answer cards a computed fit out of 10. The founder asked for scores on cards everywhere, so the two surfaces disagreed.

## Decision

1. Everywhere fit with a mandate appears (profile, relationship cards, Company requests, top 3, answer cards) it reads "7.5/10 · Good fit": the score out of 10 always beside the band in words and the confidence word.
2. The score is computed in code (`fitScoreOutOf10`, `@capital-q/contracts`) only from the outcomes the reader already sees: Strong 10, Partial 4, Mismatch 0, Unknown and no-preference left out. Fewer than three known parameters, "Not enough information" or a declared rule's exclusion: no score, the band alone. Absence never becomes a low number.
3. Still never: percentages, scores out of 100, gauges, bars, match probabilities, invented confidence numbers. The server's internal ordering value still never leaves the server.
4. Q's view stays separate and labelled, per ADR 0052 §7.

## Consequences

One scale (out of 10) across the canvas and the fit surfaces. The score is reproducible from the visible breakdown, so a reader can always see why.
