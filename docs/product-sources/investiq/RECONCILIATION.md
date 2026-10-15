# FDN InvestIQ Internal Strategy brief: reconciliation with the locked sources

Status: **PREPARED FOR LEAD/OWNER DECISION**, 2026-10-15 (Lane M). Source: `FDN_InvestIQ_Internal_Strategy.pdf` / `.txt` in this folder ("Draft for Internal Alignment, October 2026"; cited as **FDN p.N** using the brief's own section numbers 01–09, with `.txt` line numbers). Locked extracts: `docs/product-sources/text/` (PADL `Real_PADL_…txt`, Spec `Real_CAPITAL_Q_PRODUCT_SPECIFICATION.txt`, FSR `Capital_Q_Final_System_Review.txt`). This continues `docs/ai-handoff/INVESTIQ-RECONCILIATION.md` (2026-10-11) and does not supersede it; the uncalibrated v0.2 experiment in `INVESTIQ-METHODOLOGY-PROPOSED.md` remains PROPOSED and is **not** adopted here. Proposed amendments: [ADR 0068](../../adr/0068-investiq-fdn-methodology-reconciliation.md).

## 1. The methodology as written

| Element | What the brief states | Location |
| --- | --- | --- |
| Purpose | "investment-readiness system for determining how investable a business is, identifying what could prevent it from raising capital, and helping management fix those gaps" | FDN p.01 (:28-30), p.09 (:372-374) |
| Central question | "what would make them invest, … hesitate, and … walk away?" | FDN p.01 (:37-38) |
| Journey | Assess → Prepare → Position → Connect → Execute | FDN p.03 (:119-157) |
| Dimensions (9) | 1 Business Fundamentals, 2 Commercial Strength, 3 Financial Readiness, 4 Governance, 5 Management & Team, 6 Legal & Corporate, 7 Investment Case, 8 Investor Fit, 9 Diligence Readiness, each with listed focus areas | FDN p.04 (:168-201) |
| Valuation | A module inside the Investment Case, not a substitute for readiness; triangulates comparables, precedents, revenue/EBITDA multiples, DCF where visibility supports it, peer-relative, dilution math, negotiated pricing | FDN p.04 (:206-210) |
| Outputs | readiness assessment; "InvestIQ score or readiness profile **once the scoring methodology is formally approved**"; strengths/blockers; evidence gaps; priorities; capital-structure recommendations; investor-fit profile; valuation/dilution observations; roadmap | FDN p.05 (:222-230) |
| Guardrails | paying never guarantees access/approval/success; assessment and investor selection independent; a business may be advised not to raise equity; "Scores should never create false precision. Evidence quality and investment judgment must remain visible."; stage/instrument-specific models | FDN p.07 (:307-313) |
| To be finalised | scoring formula and category weightings; score bands, thresholds and evidence standards; stage- and instrument-specific models; questionnaire; report template; pricing; rules for investor-facing visibility of any score; extent of CapitalQ integration | FDN p.08 (:325-340) |

**Weights:** UNSPECIFIED. **Formula / aggregation:** UNSPECIFIED. **Thresholds and bands:** UNSPECIFIED. **Evidence standards:** UNSPECIFIED. **Missing-data rules:** UNSPECIFIED beyond "evidence gaps" as an output and "evidence quality … must remain visible". **Stage/instrument variants:** UNSPECIFIED. **Worked examples:** none. **Confidence model:** UNSPECIFIED. **Valuation arithmetic:** methods listed, selection and combination UNSPECIFIED.

## 2. Mapping onto the canonical Core Seven

The Core Seven (PADL Ch4 #63, :2251-2262; Spec 4.3, :2818-2825) stay canonical. The FDN nine are carried as a **lens**: every FDN focus area becomes a criterion inside one Core Seven dimension (`packages/readiness/src/investiq/method-v0.ts`), and the result reports per FDN dimension which criteria fed it.

| FDN dimension (p.04) | Core Seven destination | Notes |
| --- | --- | --- |
| 1 Business Fundamentals | split: market size, scalability → Market Opportunity; competitive advantage → Product & Technology; business model, revenue model → Commercial Performance | Split is PROPOSED (Q1). PADL #64 treats business model as *weighting context*, not a dimension. |
| 2 Commercial Strength | Commercial Performance | Direct. |
| 3 Financial Readiness | Financial Health | Direct; name differs ("readiness" vs "health"). |
| 4 Governance | Governance & Institutional Readiness | Direct. |
| 5 Management & Team | Founder & Leadership | Direct. |
| 6 Legal & Corporate | Governance & Institutional Readiness | PADL folds legal into governance; IP kept here (FDN placement) rather than Product & Technology (Q2). |
| 7 Investment Case | Capital Strategy | Exit logic, return potential and valuation go beyond PADL #74's "clarity" remit (conflict C4). |
| 8 Investor Fit | **Not this assessment**: routed to discovery fit | Conflict C3. |
| 9 Diligence Readiness | Governance & Institutional Readiness (PROPOSED) | Could instead be part of Investment Readiness only (Q3). |
| — (no FDN equivalent) | Product & Technology | The brief has no product/technology dimension (conflict C2); one criterion is carried from readiness-rules/v1. |

## 3. Conflicts

Each is marked **ADR/PADL** (needs an amendment) or **RECONCILABLE** (resolvable by interpretation, no amendment).

| # | Conflict | Brief | Locked source / code | Marking |
| --- | --- | --- | --- | --- |
| C1 | Nine dimensions vs Core Seven | FDN p.04 (:168-201) lists nine | PADL Ch4 #63 (:2253) "seven Core Assessment Dimensions … universal"; sector modules "extend rather than replace" | **RECONCILABLE** if the nine are a lens over the Core Seven (as implemented). **ADR/PADL** if the owner wants nine canonical dimensions. |
| C2 | No Product & Technology dimension | absent from FDN p.04 | PADL #63 (:2257) | **RECONCILABLE** (keep canonical; FDN lens leaves it unmapped). Owner to confirm (Q2). |
| C3 | Investor Fit inside readiness | FDN p.04 #8 (:195-197); p.08 "Investor fit and capital strategy are part of readiness" (:332) | FSR §4 Finding 3 (:78-106) "Readiness ≠ Quality ≠ Fit…", "must not collapse into one score"; CLAUDE.md invariants; `fitScoreOutOf10` in `packages/contracts/src/http/fit.ts:387` is a separate mandate-fit system | **ADR**: FDN's "investor-fit profile" output is delivered by referencing the discovery fit system, never computed into readiness. |
| C4 | InvestIQ prescribes capital form | FDN p.02 "what form of capital is most appropriate" (:105-107); p.05 "capital-structure recommendations" (:227); p.07 "may be advised not to raise equity if debt … more appropriate" (:310-311) | PADL Ch4 #74 (:2800-2830): Capital Strategy "rather than determining what type of capital the company should pursue"; must avoid "This business should pursue debt instead." (:2825), which is "the role of FDN Advisory" | **ADR/PADL**: either amend #74 or (recommended) assign capital-form advice to FDN human advisory outside Capital Q's automated InvestIQ. |
| C5 | Same name, different system | FDN p.06 (:262-285): InvestIQ is FDN's "methodology-led" system; CapitalQ is the tech; "complementary, not interchangeable" | PADL Ch4 (#60-#78) and Spec Ch4 (:2742): InvestIQ is "the proprietary institutional reasoning system at the core of Capital Q" | **ADR/PADL**: name the relationship (Q4). |
| C6 | Readiness-centric framing vs Business Quality separation | FDN p.01 "underlying quality, readiness and credibility" in one system (:31-32); "InvestIQ score or readiness profile" (:223) | PADL Ch4 #62 (:2218-2250) Business Quality distinct from readiness; PADL #105 (:5384) "Initial InvestIQ is an investment-readiness assessment" | **RECONCILABLE**: one InvestIQ system, separate outputs (Business Quality and Investment Readiness); no single "InvestIQ score". The PADL's own #62/#105 wording tension is pre-existing (see INVESTIQ-RECONCILIATION.md item 3). |
| C7 | Operations / diligence scope | FDN p.04 #9 Diligence Readiness; p.03 Execute "Diligence coordination, Negotiation support, Transaction management" (:152-157) | PADL Ch4 #73 (:2739) operations outside the core framework; #75 support due diligence, not replace it; PADL #63 rationale "not to audit" | **RECONCILABLE**: diligence *readiness* (are records available) is assessable; transaction execution is FDN service work, not assessment. |
| C8 | Valuation inside the assessment | FDN p.04 (:206-210) | Not in the Core Seven; PADL #74 assesses clarity, not correctness, of the raise | **ADR**: whether Capital Q computes valuations at all; today recorded only as "valuation stated" (UNSPECIFIED method). |
| C9 | Stage **and instrument** specific models | FDN p.07 (:313), p.08 (:330) | PADL Ch4 #64 (:2296-2301) adapts to stage, sector, business model, evidence; instrument not listed | **RECONCILABLE** as an additional context axis in #64, but needs owner confirmation (Q5). |
| C10 | Score visibility | FDN p.08 "Rules for investor-facing visibility of any InvestIQ score" to be finalised (:338) | PADL #104 (:5367) blind until completion; CLAUDE.md founder-private must never silently alter investor ranking; `core.company_readiness_assessments` is founder-private (migration `20261216090000`) | **RECONCILABLE now**: no investor visibility until a governed rule exists; shadow output is never shown. |
| C11 | Commercial model | FDN p.07 (:301-305) paid diagnostic engagements | PADL #106 (:5403) "Full InvestIQ Diagnosis … Without Requiring Paid Advisory" | **RECONCILABLE**: the in-product diagnosis stays free; paid FDN engagements are deeper human work. FDN p.07 "paying … must never guarantee investor access" matches CLAUDE.md "No pay-to-rank, ever." |
| C12 | Code: legacy eight pillars | the FDN nine | `packages/readiness/src/rules/v1.ts:109-147` (FOUNDER … INVESTMENT_READINESS, legacy #016 taxonomy) | **RECONCILABLE**: v1 stays production; the shadow maps it (section 5). |
| C13 | Code: verification folded into readiness | — | readiness v1 counts FOUNDER_IDENTITY / ORGANISATION verification lines toward pillar status (stored lines `source: VERIFICATION`); ADR-001 keeps `verification_claims` a separate workflow | **RECONCILABLE**: the shadow excludes them; whether v1 should is a separate lead decision. |

Agreements (no conflict): no false precision (FDN p.07 :312 = PADL #142 :6217 qualitative confidence); evidence quality visible (= PADL #65, #69, #105); independence of assessment from investor selection (= FSR §4); "assess the business, not only the pitch deck" (= PADL #103 evidence first); continuous improvement journey (= FSR :13 InvestIQ → Blueprint → Updated InvestIQ).

## 4. How the outputs should inform each surface

Six objects stay separate. None is derived from another and none is merged into a "Capital Q score".

| Object | Owner | What InvestIQ contributes |
| --- | --- | --- |
| Business Quality | InvestIQ (Founder & Leadership, Market, Product & Technology, Commercial, Financial) | Dimension evidence profiles. |
| Investment Readiness | InvestIQ (Governance & Institutional Readiness, Capital Strategy incl. diligence readiness) | Profiles, blockers, roadmap (Blueprint). |
| Intelligence Confidence | InvestIQ, per dimension | Evidence basis; qualitative level UNSPECIFIED until approved. |
| Investor Fit | `packages/discovery/src/fit` | Nothing. Fit reads the mandate and authorised company facts, never InvestIQ subscores. |
| Interest | relationship events | Nothing. |
| Relationship State | deterministic projector over `relationship_events` | Nothing. |

- **Q analysis:** Q may cite dimension evidence profiles, known gaps and conflicts *the current actor may see*, labelled with truth class and evidence status. It never states a grade or confidence level that the method has not produced, and never narrates inference as verified.
- **Discover / ranking:** **no input** until a governed visibility rule exists (C10, Q6). Even then, only investor-authorised, non-founder-private evidence may feed a feature, and no LLM sits in the ranking path.
- **Q Cards:** may show dimension names and evidence coverage once publication rules exist. Never a numeric InvestIQ score (FSR §4; PADL #142).
- **Investor matching:** stays mandate fit. The FDN "investor-fit profile" (p.05) is rendered *by referencing* fit results.
- **GateQ:** GateQ qualification stays rule-based and computes no score (`packages/gateq/src/domain/qualification.ts:26`). A submitted dossier may later carry the founder-authorised InvestIQ profile as shared evidence, never a gate.
- **Diligence:** known gaps, conflicts and diligence-readiness criteria become a request list. InvestIQ supports diligence, it doesn't replace it (PADL #75).

## 5. Shadow implementation and first comparison

`packages/readiness/src/investiq/` holds a pure function `assessInvestIQ(input, method)`, with method `investiq-shadow/v0` (SHADOW_UNAPPROVED). Inputs are observations, each with a criterion, a reading (`SUPPORTS_STRENGTH` / `INDICATES_WEAKNESS` / `RECORDED`), truth class, evidence status, lifecycle and provenance. Outputs are per-dimension evidence profiles, criterion states (`NOT_APPLICABLE` / `UNKNOWN` / `CONFLICTED` / `WEAKNESS_EVIDENCED` / `STRENGTH_INDICATED` / `RECORDED`), the FDN lens, finalisation reasons, an input hash and a rule-by-rule trace. The method contains **no weight, band, threshold or composite**. `grade`, confidence `level` and both headlines are `null` with status `UNSPECIFIED_PENDING_METHOD_APPROVAL`. Every rule carries provenance (SOURCE / EXISTING_CODE / PROPOSED_PLACEHOLDER). The only placeholder is the early-stage N/A rule for retention and profitability. It never fires when the stage is unknown, and evidence on record overrides it.

The comparison is `scripts/handoff/live/investiq-shadow-compare.mjs`. It ran one read-only `select` over the latest v1 assessment per company. Staging, 2026-10-15, 28 companies. Production values changed: 0.

- 18 dimension cases where v1 says **Strong** but the strongest admissible evidence is self-reported and nothing is judged. All are Founder (16) or Product (2). v1 Strong means "records present". It is not business strength.
- 36 cases where v1 shows a non-Unknown status but every line it used is excluded here: sector categories (21 lines), verification lines (32), or "not known" statements.
- 24 cases of v1 **Gap** where facts are on record. A Gap means a missing artefact (deck, use of funds), not a weakness.
- 2 open contradictions (commercial), detected identically by both.
- 6 early-stage N/A applications.
- 1214 of 1400 criterion slots are UNKNOWN. 178 are RECORDED, and 0 are judged strength or weakness, because no current producer emits merit readings. The FDN brief's criteria are far wider than what Capital Q collects today.

## 6. Open questions for the owner

1. Are the nine FDN dimensions a lens over the Core Seven (recommended), or a replacement needing a PADL amendment to #63?
2. Product & Technology has no FDN counterpart. Keep it as canonical? Should IP sit under Legal (FDN) or Product (PADL)?
3. Diligence Readiness: a criterion group under Governance & Institutional Readiness, or a separate Investment Readiness facet?
4. Naming: is "InvestIQ" FDN's methodology brand, Capital Q's engine, or both? The brief says the two are "complementary, not interchangeable". The PADL makes InvestIQ part of Capital Q.
5. Should instrument (equity/debt/strategic) become a #64 context axis next to stage, sector and business model?
6. Investor-facing visibility of any InvestIQ output: who may see what, and when (PADL #104 blind-until-complete)?
7. Capital-form recommendations: amend PADL #74, or keep them as FDN human advisory outside the product (recommended)?
8. Valuation: does Capital Q compute valuations, or only record and check the clarity of a stated one?
9. Approval of weights, bands, thresholds, evidence standards and the qualitative confidence levels. Until then the method stays shadow-only.
10. Business Quality composition: confirm the first five dimensions (PADL #62 reading), with Governance and Capital Strategy reported separately.
11. Pilot: the brief proposes 3–5 FDN businesses (p.08 :349). Which ones, and may their evidence be used for calibration?
