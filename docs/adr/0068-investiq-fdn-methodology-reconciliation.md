# ADR 0068: Reconcile the FDN InvestIQ brief with the locked InvestIQ decisions

- Status: **Proposed** (2026-10-15, Lane M). Not approved. Changes no production value.
- Inputs: `docs/product-sources/investiq/FDN_InvestIQ_Internal_Strategy.pdf` (Oct 2026 draft) and its [reconciliation](../product-sources/investiq/RECONCILIATION.md); PADL Chapter 4 #62-#76, #104-#106, #142; Product Specification 4.3/4.7; FSR §4 and §16.E.
- Number: 0068 was the next free number on `claude/lead-oct15`. The lead renumbers it if another lane took it.

## Context

The owner's FDN brief describes InvestIQ as FDN's investment-readiness methodology. It has nine dimensions, includes Investor Fit and capital-form advice, and leaves its formula, weights, bands, thresholds and evidence standards "to be finalised". The locked PADL makes InvestIQ Capital Q's assessment engine over the Core Seven. It separates Business Quality from readiness and from fit, and forbids prescribing capital decisions (#74). Several of the brief's statements therefore cannot be implemented without a decision.

## Decision (proposed)

1. **Core Seven stay canonical.** The FDN nine are an FDN _lens_: their focus areas become versioned criteria inside the Core Seven dimensions, and results report per FDN dimension. PADL #63 is not amended.
2. **Investor Fit is not part of InvestIQ readiness.** The FDN "investor-fit profile" output is rendered from the existing discovery fit system. InvestIQ never computes, stores or blends fit, interest, match, relationship state or outcome. This clarifies FDN p.08 ("investor fit … part of readiness") against FSR §4 Finding 3.
3. **Capital-form advice stays human FDN advisory.** Capital Q's InvestIQ keeps PADL #74: it assesses the clarity of the capital strategy and does not recommend debt over equity. If the owner wants the product to make such recommendations, that is a PADL #74 amendment, decided separately.
4. **Separate outputs.** One InvestIQ system produces Business Quality (Founder & Leadership, Market, Product & Technology, Commercial, Financial) and Investment Readiness (Governance & Institutional Readiness, Capital Strategy, with diligence-readiness criteria under Governance & Institutional Readiness). Each dimension also carries Intelligence Confidence. There is no single "InvestIQ score" and no composite across the two.
5. **No numbers until approved.** A method version may carry weights, bands, thresholds or confidence levels only after owner approval. Until then grades and levels are `null`/UNSPECIFIED, and unapproved methods are `SHADOW_UNAPPROVED`, never user-visible.
6. **Applicability is contextual and versioned.** NOT_APPLICABLE comes only from a versioned context rule (stage now; instrument proposed as an added #64 axis). Unknown context never grants it, and evidence on record overrides it. Unknown is never zero.
7. **No investor visibility** of any InvestIQ output until a governed visibility rule exists (FDN p.08; PADL #104).
8. **Naming.** "InvestIQ" names both the FDN methodology and the Capital Q engine that implements its approved versions. FDN advisory engagements are services around it, not the product.

## Consequences

- `packages/readiness/src/investiq/` (shadow v0) implements points 1, 2, 4, 5 and 6 as a pure, versioned function, with tests and a read-only comparison harness against readiness-rules/v1. Production readiness v1, fit, GateQ and Q cards are unchanged.
- A promoted (approved) version needs: an approved method, contracts moved to `@capital-q/contracts`, a migration for snapshots with RLS and permission tests, real producers of merit readings (`SUPPORTS_STRENGTH`/`INDICATES_WEAKNESS`) through the Write Gate, and calibration on the FDN pilot.
- Open questions for the owner are listed in RECONCILIATION.md §6. Points 3 and 8 can be rejected without affecting the shadow code.
