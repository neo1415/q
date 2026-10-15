# ADR 0068: Reconcile the FDN InvestIQ brief with the locked InvestIQ decisions

- Status: **Proposed** (2026-10-15, Lane M), updated the same day with two owner decisions (naming; delegation of the method). Not yet accepted. Changes no production value.
- Inputs: `docs/product-sources/investiq/FDN_InvestIQ_Internal_Strategy.pdf` (Oct 2026 draft) and its [reconciliation](../product-sources/investiq/RECONCILIATION.md); PADL Chapter 4 #62-#76, #104-#106, #142; Product Specification 4.3/4.7; FSR §4 and §16.E.
- Number: 0068 was the next free number on `claude/lead-oct15`. The lead renumbers it if another lane took it.

## Context

The owner's FDN brief describes InvestIQ as FDN's investment-readiness methodology. It has nine dimensions, includes Investor Fit and capital-form advice, and leaves its formula, weights, bands, thresholds and evidence standards "to be finalised". The locked PADL makes InvestIQ Capital Q's assessment engine over the Core Seven. It separates Business Quality from readiness and from fit, and forbids prescribing capital decisions (#74). Several of the brief's statements therefore cannot be implemented without a decision.

## Decision (proposed)

1. **The FDN nine are canonical (owner decision, 2026-10-15).** Business Fundamentals, Commercial Strength, Financial Readiness, Governance, Management & Team, Legal & Corporate, Investment Case, Investor Fit and Diligence Readiness are the InvestIQ dimensions. This **amends PADL Ch4 #63** (Core Seven). The amendment keeps the Core Seven as a _projection_: every FDN criterion maps to exactly one Core Seven dimension, and assessments emit a Core Seven view so existing consumers keep working. Sector modules extend the nine.
2. **Investor Fit is not part of InvestIQ readiness.** The FDN "investor-fit profile" output is rendered from the existing discovery fit system. InvestIQ never computes, stores or blends fit, interest, match, relationship state or outcome. This clarifies FDN p.08 ("investor fit … part of readiness") against FSR §4 Finding 3.
3. **Capital-form advice stays human FDN advisory.** Capital Q's InvestIQ keeps PADL #74: it assesses the clarity of the capital strategy and does not recommend debt over equity. If the owner wants the product to make such recommendations, that is a PADL #74 amendment, decided separately.
4. **Separate outputs.** One InvestIQ system produces Business Quality (Founder & Leadership, Market, Product & Technology, Commercial, Financial) and Investment Readiness (Governance & Institutional Readiness, Capital Strategy, with diligence-readiness criteria under Governance & Institutional Readiness). Each dimension also carries Intelligence Confidence. There is no single "InvestIQ score" and no composite across the two.
5. **Numbers are owner-delegated and versioned.** The owner delegated weights, rules and bands to the lead. `investiq/v1` (status OWNER_DELEGATED_PENDING_CALIBRATION) carries stage weights, evidence multipliers, bands, discrete confidence levels and coverage gates, each traced to RESEARCH.md. v1 stays shadow-only until the CALIBRATION.md checks pass on 3–5 real FDN companies. Any parameter change creates a new method version; old results stay reproducible. User-facing confidence stays qualitative (PADL #142), and the internal 0–4 score is never shown as a number.
6. **Applicability is contextual and versioned.** NOT_APPLICABLE comes only from a versioned context rule (stage now; instrument proposed as an added #64 axis). Unknown context never grants it, and evidence on record overrides it. Unknown is never zero.
7. **No investor visibility** of any InvestIQ output until a governed visibility rule exists (FDN p.08; PADL #104).
8. **Naming (owner decision, 2026-10-15).** InvestIQ is **FDN Capital Partners' proprietary methodology and the canonical name**. The Capital Q engine _implements_ FDN InvestIQ: it runs only FDN-approved method versions and never redefines the methodology. PADL Ch4 and Spec Ch4 wording that calls InvestIQ "the proprietary institutional reasoning system at the core of Capital Q" gets a corrigendum to "Capital Q's implementation of FDN InvestIQ". FDN advisory engagements remain services around the methodology.

## Consequences

- `packages/readiness/src/investiq/` (shadow v0) implements points 1, 2, 4, 5 and 6 as a pure, versioned function, with tests and a read-only comparison harness against readiness-rules/v1. Production readiness v1, fit, GateQ and Q cards are unchanged.
- `investiq/v1` (`method-v1.ts`, `assess-v1.ts`) implements points 1, 2, 4, 5, 6 and 8 in shadow mode. It has 44 tests (weight tables, band edges, coverage, multipliers, confidence, locked rules) and is included in the read-only comparison harness. It has no consumer wiring.
- A promoted (approved) version needs: an approved method, contracts moved to `@capital-q/contracts`, a migration for snapshots with RLS and permission tests, real producers of merit readings (`SUPPORTS_STRENGTH`/`INDICATES_WEAKNESS`) through the Write Gate, and calibration on the FDN pilot.
- Open questions for the owner are listed in RECONCILIATION.md §7. Point 3 (capital-form advice) and the valuation exclusion stay locked; the owner did not override them. v1 keeps them: Investor Fit weight 0, valuation and dilution ungraded, and no capital-form output.
