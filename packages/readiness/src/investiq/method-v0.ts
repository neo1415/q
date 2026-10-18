import type { CoreDimension, FdnDimension } from "./contracts.js";

/**
 * InvestIQ shadow method v0. SHADOW, UNAPPROVED: it never replaces a
 * production readiness, fit or card value and is never shown to a user.
 *
 * Every rule here carries where it came from:
 *   SOURCE                the locked PADL / Product Specification or the
 *                         FDN InvestIQ brief states it
 *   EXISTING_CODE         carried from readiness-rules/v1 so the shadow can
 *                         be compared with production
 *   PROPOSED_PLACEHOLDER  needed to run at all; the sources leave it open.
 *                         Each one is listed in RECONCILIATION.md as an open
 *                         question for the owner.
 *
 * The FDN brief (p.8) leaves the scoring formula, category weights, score
 * bands, thresholds and evidence standards "to be finalised". So this
 * method has NO weights, NO bands, NO numeric grade and NO composite: a
 * dimension's result is its evidence profile, and grade/confidence level
 * stay null with status UNSPECIFIED until a method version is approved.
 */

export type RuleProvenance = {
  readonly kind: "SOURCE" | "EXISTING_CODE" | "PROPOSED_PLACEHOLDER";
  readonly ref: string;
};

export type CriterionDef = {
  readonly key: string;
  readonly dimension: CoreDimension;
  readonly label: string;
  /** FDN brief p.4 dimensions this criterion carries (the FDN lens). */
  readonly fdn: readonly FdnDimension[];
  readonly provenance: RuleProvenance;
};

export type ApplicabilityRule = {
  readonly id: string;
  readonly criteria: readonly string[];
  /** Applies only when the stage is KNOWN and early; unknown context never grants N/A. */
  readonly whenEarlyStage: true;
  readonly reason: string;
  readonly provenance: RuleProvenance;
};

export type InvestIQMethod = {
  readonly version: string;
  readonly status: "SHADOW_UNAPPROVED";
  readonly dimensions: readonly {
    readonly code: CoreDimension;
    readonly label: string;
    readonly output: "BUSINESS_QUALITY" | "INVESTMENT_READINESS";
  }[];
  readonly criteria: readonly CriterionDef[];
  readonly applicability: readonly ApplicabilityRule[];
  /** FDN dimensions this assessment deliberately does not compute. */
  readonly routedElsewhere: readonly {
    readonly fdn: FdnDimension;
    readonly system: "DISCOVERY_FIT";
    readonly provenance: RuleProvenance;
  }[];
};

const FDN_P4: RuleProvenance = {
  kind: "SOURCE",
  ref: "FDN InvestIQ brief p.4 Assessment Framework",
};

function c(
  key: string,
  dimension: CoreDimension,
  label: string,
  fdn: readonly FdnDimension[],
  provenance: RuleProvenance = FDN_P4,
): CriterionDef {
  return { key, dimension, label, fdn, provenance };
}

export const INVESTIQ_SHADOW_METHOD_V0: InvestIQMethod = {
  version: "investiq-shadow/v0",
  status: "SHADOW_UNAPPROVED",
  // Core Seven order and names: PADL Ch4 #63, Spec 4.3 (extract :2818).
  // Business Quality vs Investment Readiness split: PADL Ch4 #62 reading,
  // PROPOSED in ADR 0068 (not yet approved).
  dimensions: [
    {
      code: "FOUNDER_AND_LEADERSHIP",
      label: "Founder & Leadership",
      output: "BUSINESS_QUALITY",
    },
    {
      code: "MARKET_OPPORTUNITY",
      label: "Market Opportunity",
      output: "BUSINESS_QUALITY",
    },
    {
      code: "PRODUCT_AND_TECHNOLOGY",
      label: "Product & Technology",
      output: "BUSINESS_QUALITY",
    },
    {
      code: "COMMERCIAL_PERFORMANCE",
      label: "Commercial Performance",
      output: "BUSINESS_QUALITY",
    },
    {
      code: "FINANCIAL_HEALTH",
      label: "Financial Health",
      output: "BUSINESS_QUALITY",
    },
    {
      code: "GOVERNANCE_AND_INSTITUTIONAL_READINESS",
      label: "Governance & Institutional Readiness",
      output: "INVESTMENT_READINESS",
    },
    {
      code: "CAPITAL_STRATEGY",
      label: "Capital Strategy",
      output: "INVESTMENT_READINESS",
    },
  ],
  criteria: [
    // FDN 5 Management & Team
    c("fl.founder_quality", "FOUNDER_AND_LEADERSHIP", "Founder quality", [
      "MANAGEMENT_AND_TEAM",
    ]),
    c("fl.leadership_depth", "FOUNDER_AND_LEADERSHIP", "Leadership depth", [
      "MANAGEMENT_AND_TEAM",
    ]),
    c("fl.succession", "FOUNDER_AND_LEADERSHIP", "Succession", [
      "MANAGEMENT_AND_TEAM",
    ]),
    c(
      "fl.organisational_structure",
      "FOUNDER_AND_LEADERSHIP",
      "Organisational structure",
      ["MANAGEMENT_AND_TEAM"],
    ),
    c("fl.critical_hires", "FOUNDER_AND_LEADERSHIP", "Critical hires", [
      "MANAGEMENT_AND_TEAM",
    ]),
    // FDN 1 Business Fundamentals (split across three Core Seven dimensions)
    c("mo.market_size", "MARKET_OPPORTUNITY", "Market size", [
      "BUSINESS_FUNDAMENTALS",
    ]),
    c("mo.scalability", "MARKET_OPPORTUNITY", "Scalability", [
      "BUSINESS_FUNDAMENTALS",
    ]),
    c(
      "pt.competitive_advantage",
      "PRODUCT_AND_TECHNOLOGY",
      "Competitive advantage",
      ["BUSINESS_FUNDAMENTALS"],
    ),
    // The FDN brief has no product/technology criterion; this one keeps the
    // canonical dimension assessable and comparable with readiness v1.
    c(
      "pt.product_definition",
      "PRODUCT_AND_TECHNOLOGY",
      "Product and solution",
      [],
      {
        kind: "EXISTING_CODE",
        ref: "readiness-rules/v1 PRODUCT_AND_SOLUTION",
      },
    ),
    c("cp.business_model", "COMMERCIAL_PERFORMANCE", "Business model", [
      "BUSINESS_FUNDAMENTALS",
    ]),
    c("cp.revenue_model", "COMMERCIAL_PERFORMANCE", "Revenue model", [
      "BUSINESS_FUNDAMENTALS",
    ]),
    // FDN 2 Commercial Strength
    c("cp.traction", "COMMERCIAL_PERFORMANCE", "Traction", [
      "COMMERCIAL_STRENGTH",
    ]),
    c("cp.revenue_quality", "COMMERCIAL_PERFORMANCE", "Revenue quality", [
      "COMMERCIAL_STRENGTH",
    ]),
    c("cp.customer_base", "COMMERCIAL_PERFORMANCE", "Customer base", [
      "COMMERCIAL_STRENGTH",
    ]),
    c("cp.retention", "COMMERCIAL_PERFORMANCE", "Retention", [
      "COMMERCIAL_STRENGTH",
    ]),
    c("cp.distribution", "COMMERCIAL_PERFORMANCE", "Distribution", [
      "COMMERCIAL_STRENGTH",
    ]),
    c("cp.sales_engine", "COMMERCIAL_PERFORMANCE", "Sales engine", [
      "COMMERCIAL_STRENGTH",
    ]),
    c("cp.partnerships", "COMMERCIAL_PERFORMANCE", "Partnerships", [
      "COMMERCIAL_STRENGTH",
    ]),
    // FDN 3 Financial Readiness
    c("fh.historical_financials", "FINANCIAL_HEALTH", "Historical financials", [
      "FINANCIAL_READINESS",
    ]),
    c("fh.forecasts", "FINANCIAL_HEALTH", "Forecasts", ["FINANCIAL_READINESS"]),
    c("fh.cash_flow", "FINANCIAL_HEALTH", "Cash flow", ["FINANCIAL_READINESS"]),
    c("fh.profitability", "FINANCIAL_HEALTH", "Profitability", [
      "FINANCIAL_READINESS",
    ]),
    c("fh.working_capital", "FINANCIAL_HEALTH", "Working capital", [
      "FINANCIAL_READINESS",
    ]),
    c("fh.capital_efficiency", "FINANCIAL_HEALTH", "Capital efficiency", [
      "FINANCIAL_READINESS",
    ]),
    c("fh.debt", "FINANCIAL_HEALTH", "Debt", ["FINANCIAL_READINESS"]),
    // FDN 4 Governance
    c("gir.board", "GOVERNANCE_AND_INSTITUTIONAL_READINESS", "Board", [
      "GOVERNANCE",
    ]),
    c(
      "gir.decision_making",
      "GOVERNANCE_AND_INSTITUTIONAL_READINESS",
      "Decision-making",
      ["GOVERNANCE"],
    ),
    c("gir.reporting", "GOVERNANCE_AND_INSTITUTIONAL_READINESS", "Reporting", [
      "GOVERNANCE",
    ]),
    c(
      "gir.ownership_structure",
      "GOVERNANCE_AND_INSTITUTIONAL_READINESS",
      "Ownership and shareholder structure",
      ["GOVERNANCE"],
    ),
    c("gir.controls", "GOVERNANCE_AND_INSTITUTIONAL_READINESS", "Controls", [
      "GOVERNANCE",
    ]),
    // FDN 6 Legal & Corporate
    c(
      "gir.incorporation",
      "GOVERNANCE_AND_INSTITUTIONAL_READINESS",
      "Incorporation",
      ["LEGAL_AND_CORPORATE"],
    ),
    c("gir.licences", "GOVERNANCE_AND_INSTITUTIONAL_READINESS", "Licences", [
      "LEGAL_AND_CORPORATE",
    ]),
    c("gir.contracts", "GOVERNANCE_AND_INSTITUTIONAL_READINESS", "Contracts", [
      "LEGAL_AND_CORPORATE",
    ]),
    c(
      "gir.shareholder_agreements",
      "GOVERNANCE_AND_INSTITUTIONAL_READINESS",
      "Shareholder agreements",
      ["LEGAL_AND_CORPORATE"],
    ),
    c(
      "gir.intellectual_property",
      "GOVERNANCE_AND_INSTITUTIONAL_READINESS",
      "Intellectual property",
      ["LEGAL_AND_CORPORATE"],
    ),
    c(
      "gir.regulatory_exposure",
      "GOVERNANCE_AND_INSTITUTIONAL_READINESS",
      "Regulatory exposure",
      ["LEGAL_AND_CORPORATE"],
    ),
    // FDN 9 Diligence Readiness (placed under GIR: PROPOSED, ADR 0068)
    c("gir.data_room", "GOVERNANCE_AND_INSTITUTIONAL_READINESS", "Data room", [
      "DILIGENCE_READINESS",
    ]),
    c(
      "gir.financial_records",
      "GOVERNANCE_AND_INSTITUTIONAL_READINESS",
      "Financial records",
      ["DILIGENCE_READINESS"],
    ),
    c(
      "gir.legal_documents",
      "GOVERNANCE_AND_INSTITUTIONAL_READINESS",
      "Legal documents",
      ["DILIGENCE_READINESS"],
    ),
    c(
      "gir.management_reporting",
      "GOVERNANCE_AND_INSTITUTIONAL_READINESS",
      "Management reporting",
      ["DILIGENCE_READINESS"],
    ),
    c("gir.cap_table", "GOVERNANCE_AND_INSTITUTIONAL_READINESS", "Cap table", [
      "DILIGENCE_READINESS",
    ]),
    c(
      "gir.commercial_evidence",
      "GOVERNANCE_AND_INSTITUTIONAL_READINESS",
      "Commercial evidence",
      ["DILIGENCE_READINESS"],
    ),
    // FDN 7 Investment Case
    c("cs.raise_amount", "CAPITAL_STRATEGY", "Raise amount", [
      "INVESTMENT_CASE",
    ]),
    c("cs.use_of_funds", "CAPITAL_STRATEGY", "Use of funds", [
      "INVESTMENT_CASE",
    ]),
    c("cs.valuation", "CAPITAL_STRATEGY", "Valuation", ["INVESTMENT_CASE"]),
    c("cs.dilution", "CAPITAL_STRATEGY", "Dilution", ["INVESTMENT_CASE"]),
    c("cs.investment_structure", "CAPITAL_STRATEGY", "Investment structure", [
      "INVESTMENT_CASE",
    ]),
    c("cs.exit_logic", "CAPITAL_STRATEGY", "Exit logic", ["INVESTMENT_CASE"]),
    c("cs.return_potential", "CAPITAL_STRATEGY", "Return potential", [
      "INVESTMENT_CASE",
    ]),
    c("cs.capital_narrative", "CAPITAL_STRATEGY", "Capital narrative", [], {
      kind: "SOURCE",
      ref: "PADL Chapter 4 #74 Capital Narrative pillar (extract :2805)",
    }),
  ],
  applicability: [
    {
      id: "na.early-stage-retention-profitability",
      criteria: ["cp.retention", "fh.profitability"],
      whenEarlyStage: true,
      reason:
        "Early-stage company: retention and profitability are not yet expected (PADL Ch4 #64 pre-seed example).",
      provenance: {
        kind: "PROPOSED_PLACEHOLDER",
        ref: "PADL Ch4 #64 (:2290), #68 (:2472); FDN p.7 'different company stages may require different readiness models'",
      },
    },
  ],
  routedElsewhere: [
    {
      fdn: "INVESTOR_FIT",
      system: "DISCOVERY_FIT",
      provenance: {
        kind: "SOURCE",
        ref: "FSR §4 Finding 3 (extract :78-106); CLAUDE.md Readiness ≠ Fit",
      },
    },
  ],
};
