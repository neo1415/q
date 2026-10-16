# ADR 0075: Scores read unconfirmed investor-visible material

- Status: **Accepted.** The owner directed it on 2026-10-16 and is the authority to amend the rules below; the lead relayed the direction to lane iq. The lead may renumber this ADR.
- Amends:
  - the deck Write Gate (migration `20261207120000`: "Only a confirmed extraction is shown to an investor") and the transcript rule (`20261012090000`: "transcript ≠ evidence"), **for scoring only**;
  - ADR 0074 decision 2 (no number below InvestIQ's coverage gates) and ADR 0068 decision 5, as they apply to display.
- Unchanged: the Context Firewall, RLS, the founder's confirmation workflow, what investors are shown in words, and the InvestIQ v1 arithmetic, weights and anchors.

## Context

The owner, 2026-10-16: investors must see Investability and Suitability on every company that has any investor-visible material, whether or not the founder has confirmed Q's reading. The scores are a screening signal ("should I dig deeper?"), and the agent workforce will act on score thresholds. The first production reading scored only 16 of 461 listed companies, because founders had not confirmed Q's deck readings.

## Decision

1. **Inputs** (`investability-inputs.v2`). Investability may also read:
   - Q's reading of the sections the founder has not reviewed yet, of a deck open to **all** investors (data room PUBLIC, or download open to investors);
   - the pitch investors may play (READY, moderation ALLOWED, AUTHORISED or PUBLIC playback, not superseded) and its generated transcript, read by fixed patterns, never a model.

   Each counts as **Q's inference of what the founder said**: truth Q_INFERENCE, evidence SELF_REPORTED, weight 0.25. That is half a confirmed founder claim (0.5), and confirmed and verified evidence still decide wherever they exist.

   These never count:
   - a section the founder marked as wrong;
   - a deck not open to all investors (shared through a relationship grant, or private);
   - a pitch that is private or not cleared by moderation;
   - Q's own "contradictory" read.

   Founder-private and non-investor-visible material never counts. The negative tests remain, and a "deck not open to investors" test is added.

2. **The Write Gate stays for display.** The investor-facing "why" never quotes or shows an unconfirmed statement. It names the factor and its source only: "Traction · from their own deck, not yet confirmed", or "Team · stated in their pitch video". Confirmed facts are still quoted as before.
3. **Always present.** A number is shown whenever any investor-visible material exists. When InvestIQ's full coverage gates are not met, the score is **provisional**:
   - it uses the same criterion scores, each weighted by its dimension's stage weight shared over that dimension's applicable criteria;
   - unknown criteria stay out, and are never zero;
   - confidence is Low, the band is held at Developing at most, and it is labelled "early read";
   - coverage is shown as "based on 9 of 46 factors".

   Only a company with no deck, no pitch and no shared claim shows "No pitch or deck shared yet".

4. **Suitability** shows a number whenever any mandate parameter is known. It is labelled "2 of 7 known" with the fit's own confidence, and it is the fit's x/10 × 10 where the fit shows one.
5. **Ranking** (`fit-order.v2`) is unchanged: a SCORED Investability, provisional included, is its 0.25 component after explicit fit.

## Consequences

- An offline, read-only count over production gave **461 of 461 listed companies scored** (190 provisional), all 50–54, Developing, Low confidence.
- Today's material is thin and unconfirmed, so it differentiates little. Founder confirmation, document support and verification move both the score and the confidence.
- The workforce must treat Low-confidence, provisional scores as a screening signal, never a decision basis. Any threshold action should require at least Moderate confidence, or human review.
