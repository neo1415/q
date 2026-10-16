# ADR 0074: Investability and Suitability scores, shown to investors and used for ranking

- Status: **Accepted by owner direction** (2026-10-16, lane iq). It needs only the lead's integration and the CI and pgTAP gates.
- Number: 0074 was chosen to avoid collisions with lanes in flight. The lead renumbers it if needed.
- Amends: ADR 0068 decisions 5 ("the internal 0–4 score is never shown as a number"; "shadow only until calibration") and 7 ("no investor visibility of any InvestIQ output"); the doc 19 / Discover feed card rule "no score on the card"; ADR 0052 "words only" (already softened by ADR 0059 for the fit out of 10). PADL #142 (no false precision) and #104 (governed visibility) are honoured by the measures below, not waived.

## Context

The owner, 2026-10-16: every company and founder carries two scores, visible to investors, "so the investor knows what is worth his time". Investability is how investable the company is on its evidence. Suitability is how well it fits this investor's mandate. The InvestIQ methodology "must actually be used now, and used for ranking." They are shown at the top of the company profile, on every company card (Discover, Explore, CRM records and pipeline, search, saved, comparisons) and in Q's answers. They are recomputed when evidence changes.

## Decision

1. **Two scores, never blended in display.** Investability = FDN InvestIQ `investiq/v1` overall × 25 (0–100 integer). Suitability = the fit out of 10 × 10. Each is shown with its coverage ("based on 5 of 8 areas", "6 of 7 known") and a confidence in words, plus a short "why". No percentage sign and no decimals.
2. **No number without enough evidence.** InvestIQ's coverage gates decide. Below them, the investor sees "Investability: not enough shared evidence yet", the coverage, and what is missing. Unknown is never zero and never low.
3. **Governed visibility (PADL #104, Context Firewall).** Investability is computed only from investor-eligible information (INVESTIQ-METHODOLOGY.md, "Investor-eligible inputs"), and is the same for every investor. A relationship grant or founder-private record can never change it. RLS: the company's members, and any active participant while the company is listed. Suitability is investor-private.
4. **Ranking through the versioned config only.** `fit-order.v2` adds Investability (weight 0.25) after explicit fit (Suitability weight 0.75). It applies only to candidates the fit can score; it is absent when unknown; exploration and diversity follow. Hard eligibility comes first. There is no pay-to-rank, no engagement signal and no model.
5. **Calibration continues.** `investiq/v1` constants remain hypotheses. The CALIBRATION.md pilot is still required, and changes become `investiq/v2` with old revisions reproducible from their basis hash.

## Consequences

- Investors see numbers that are honest about thin evidence. Today most companies are self-reported, which gives low confidence, a band held at Developing, or no number.
- Founders improve their Investability by sharing evidence with investors and getting it verified. Private uploads do not move it, by design.
- Doc 19's prohibition on presenting ranking arithmetic as a judgement still holds. The ordering key (the blend) is never shown; only the two scores are.
