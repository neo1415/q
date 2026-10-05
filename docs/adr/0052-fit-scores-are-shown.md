# ADR 0052: Fit scores are shown

Status: Accepted (founder brief 2026-10-05, items B1-B4; the founder asked for scores explicitly and pre-approved them)
Amends: ADR 0017 §"Prohibited" ("Badge spam; 'Hot / Top match / 94%'; confidence percentages; fit meters"), for fit with a mandate only.
Related: ADR 0051 (answer cards, build/canvas), doc 19 §52-§59, ADR-001 (truth / evidence axes).

## Context

Investors asked Q for "the top three" and wanted to see, on relationship cards, on company requests and on a profile, how well each company fits their mandate and why. ADR 0017 banned fit meters, because a lone number or bar invites "94% match" thinking: false precision, engagement bait and a verdict on the company. The founder now wants fit shown, with the same guard rails.

## Decision

1. **What is shown.** A fit band in words (Strong fit, Good fit, Partial fit, Weak fit, Not enough information, Outside your mandate) and a confidence word (High, Medium, Low confidence). For each of nine parameters (stage, sector, geography, cheque size, business model, traction, team, thesis, round terms) an icon and a word (Strong match, Partial, Mismatch, Unknown, No preference) with a one-sentence reason rendered from a versioned template (`fit-reasons.v1`). A row of nine icons is allowed as a compact summary; it is always next to the band in words.
2. **What is never shown.** No percentage, no score out of 100, no bar or gauge, no "match" probability, no invented confidence number. The internal value that orders and bands profiles never leaves the server.
3. **Unknown never counts against a company.** The value is averaged over known parameters only. Unknown lowers coverage and therefore confidence, and below 40 % coverage the band is "Not enough information". A parameter the investor declared no preference on counts toward neither.
4. **Evidence quality is confidence, not fit.** Evidence status and freshness of each input discount confidence. "Strong fit" additionally requires high confidence.
5. **Hard rules** come only from the investor's declared mandate (eligibility's hard criteria). They produce "Outside your mandate" with the rule named; they are never weighted and never inferred from behaviour.
6. **Deterministic and versioned.** The model is `ranking-config.v4` in `packages/discovery/src/fit/` (extends v3's four factors; INITIAL_HEURISTIC_UNCALIBRATED). A published config is frozen and pinned by a test digest. The Discover feed still orders by v3; v4 describes fit, it does not reorder the feed. No model runs in the fit path, and it is not on the swipe path.
7. **Q's view is separate.** "Q's view" (Worth a look, Maybe, Probably not) is a labelled Q_INFERENCE beside the fit. It is formed from the same reader-visible facts through the Model Gateway, off the critical path, cached, and never changes the band, the order or any parameter. If Q disagrees with the fit, both show.
8. **Colour is never the only signal.** Every outcome has its own icon shape and word; Unknown is a neutral dotted circle, never red; Mismatch is a neutral minus, not an alarm.

## Consequences

- Investors see why a company fits, parameter by parameter, and what is not known yet.
- A comparison (top N) orders by the same model, marks a row's best only where one company is strictly better, and says how many were left out and why.
- ADR 0051's card "fit out of 10" is a model-reading score for research answers; for fit with a mandate, the canvas should render the `FitComparison` DTO in words per this ADR. Reconciling the two on the canvas is an integration point, not a redesign.
- Weights are a proposal until outcome data exists; calibration (status CALIBRATED) will be a new version, calibrated on outcomes, never on clicks, saves or views.
