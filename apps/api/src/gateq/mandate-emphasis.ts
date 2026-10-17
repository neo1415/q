import type { ApplicationDimension } from "@capital-q/gateq-intake";
import type { InvestorMandateSnapshot } from "@capital-q/investors";

/**
 * What a GateQ interview should lean on, from the gateway owner's mandate.
 *
 * Live 2026-10-17 (Partech): a detailed active mandate (revenue growth,
 * enterprise customers, technical founders, B2B and transaction models) had
 * no effect on the interview, because the published gate had no criteria
 * and the interviewer only reads published policy. The mandate still must
 * not become GateQ rules (Declared Mandate ≠ GateQ Rules), so only the
 * dimension a field is about crosses: never a value, a threshold, the
 * investor's wording, or anything that could change who qualifies. Fields
 * the mandate registry marks MANUAL_ONLY (their own free text) are never
 * read, and neither are hard exclusions: what a fund refuses is not a topic
 * to interview a founder about.
 */
const GREEN_FLAG_DIMENSIONS: Readonly<
  Record<string, readonly ApplicationDimension[]>
> = {
  strong_revenue_growth: ["claims.revenue", "claims.traction"],
  capital_efficiency: ["company.business_model", "claims.revenue"],
  high_retention: ["claims.traction"],
  enterprise_customers: ["company.customers"],
  distribution_advantage: ["company.customers", "company.market"],
  regulatory_moat: ["company.market"],
  repeat_founder: ["company.team"],
  deep_domain_expertise: ["company.team"],
};

const IMPORTANCE_ORDER: Readonly<Record<string, number>> = {
  MUST: 0,
  STRONG: 1,
  NICE: 2,
  NEUTRAL: 3,
};

export function emphasisFromMandate(
  mandate: InvestorMandateSnapshot,
): readonly ApplicationDimension[] {
  const ranked: { dimension: ApplicationDimension; rank: number }[] = [];
  const push = (dimension: ApplicationDimension, importance: string): void => {
    // What they avoid or exclude is not what they want to hear more about.
    const rank = IMPORTANCE_ORDER[importance];
    if (rank === undefined) return;
    ranked.push({ dimension, rank });
  };

  for (const constraint of mandate.constraints) {
    if (constraint.automatedUse !== "ELIGIBLE" || constraint.isHardExclusion) {
      continue;
    }
    const codes =
      constraint.value.kind === "codes" ? constraint.value.values : [];
    switch (constraint.dimension) {
      case "green_flag":
        for (const code of codes) {
          for (const dimension of GREEN_FLAG_DIMENSIONS[code] ?? []) {
            push(dimension, constraint.importance);
          }
        }
        break;
      case "founder.business_attribute":
        push("company.team", constraint.importance);
        break;
      case "business.attribute":
        for (const code of codes) {
          if (code.includes("revenue")) {
            push("claims.revenue", constraint.importance);
          } else if (code.includes("capital")) {
            push("raise.use_of_funds", constraint.importance);
          } else if (code.includes("regulat")) {
            push("company.market", constraint.importance);
          }
        }
        break;
      // Who qualifies (stage, place, sector, cheque, role), what they
      // refuse and their own words are not topics to lean on.
      case "stage":
      case "geography.country":
      case "sector":
      case "red_flag":
      case "investment_role":
      case "custom.text":
      case "cheque.typical":
        break;
    }
  }

  for (const preference of mandate.taxonomyPreferences) {
    if (preference.isExclusion) continue;
    if (preference.vocabularyCode === "business_model") {
      push("company.business_model", preference.preferenceStrength);
    } else if (preference.vocabularyCode === "customer_type") {
      push("company.customers", preference.preferenceStrength);
    }
  }

  // Stable: most important first, then the mandate's own order.
  const ordered = ranked
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index);
  const out: ApplicationDimension[] = [];
  for (const { dimension } of ordered) {
    if (!out.includes(dimension)) out.push(dimension);
  }
  return out;
}
