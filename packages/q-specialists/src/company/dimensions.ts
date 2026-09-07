import type { CompanyIntelligenceDimension } from "@capital-q/q-core";

/**
 * Which company dimension a piece of institutional understanding speaks to
 * (CQ-Q-020 §5, §24-§33).
 *
 * A deterministic mapping from knowledge key prefix to dimension, so that
 * "which part of the business is this about" is answered by a table
 * somebody can read and argue with, rather than by a model each time. A
 * key nobody mapped falls to null and its facts still travel — an
 * unmapped key must never become an invisible one.
 */

const PREFIX_TO_DIMENSION: readonly (readonly [
  string,
  CompanyIntelligenceDimension,
])[] = [
  ["company.description", "DESCRIPTION"],
  ["company.stage", "DESCRIPTION"],
  ["business_model.", "BUSINESS_MODEL"],
  ["commercial.pricing", "BUSINESS_MODEL"],
  ["commercial.sales_motion", "BUSINESS_MODEL"],
  ["product.", "PRODUCT"],
  ["market.", "MARKET"],
  ["customer.", "CUSTOMERS"],
  ["commercial.customer", "CUSTOMERS"],
  ["traction.", "TRACTION"],
  ["commercial.", "TRACTION"],
  ["financial.", "FINANCIAL"],
  ["team.", "TEAM"],
  ["founder.", "TEAM"],
  ["strategy.", "STRATEGY"],
  ["capital.", "CAPITAL_OBJECTIVE"],
];

export function dimensionForKnowledgeKey(
  knowledgeKey: string,
): CompanyIntelligenceDimension | null {
  const key = knowledgeKey.toLowerCase();
  // Longest prefix wins, so "commercial.customer_concentration" reaches
  // CUSTOMERS rather than the broader TRACTION rule above it.
  let best: readonly [string, CompanyIntelligenceDimension] | null = null;
  for (const entry of PREFIX_TO_DIMENSION) {
    if (
      key.startsWith(entry[0]) &&
      (best === null || entry[0].length > best[0].length)
    ) {
      best = entry;
    }
  }
  return best === null ? null : best[1];
}

/**
 * The dimensions a question is asking about, from the question's own words.
 *
 * Deterministic and deliberately generous: matching too many dimensions
 * costs a little context, while matching too few would silently narrow
 * what Capital Q looks at because of a phrasing it did not recognise. An
 * unmatched question means "no particular focus", which reads everything
 * the plan allows — never nothing.
 */
const DIMENSION_TERMS: Readonly<
  Record<CompanyIntelligenceDimension, readonly string[]>
> = {
  DESCRIPTION: [
    "what do",
    "what does",
    "describe",
    "overview",
    "about the company",
    "who are they",
  ],
  BUSINESS_MODEL: [
    "business model",
    "make money",
    "revenue model",
    "pricing",
    "monetis",
    "monetiz",
    "sales motion",
    "how do they charge",
  ],
  PRODUCT: [
    "product",
    "solution",
    "technology",
    "platform",
    "what do they build",
    "differentiat",
  ],
  MARKET: [
    "market",
    "industry",
    "sector",
    "competitor",
    "competitive",
    "tam",
    "geograph",
  ],
  CUSTOMERS: [
    "customer",
    "client",
    "concentration",
    "retention",
    "churn",
    "renewal",
    "logo",
  ],
  TRACTION: [
    "traction",
    "growth",
    "milestone",
    "partnership",
    "contract",
    "validation",
    "adoption",
  ],
  FINANCIAL: [
    "revenue",
    "arr",
    "mrr",
    "burn",
    "runway",
    "margin",
    "profit",
    "financial",
    "cash",
    "unit econom",
    "capital efficien",
  ],
  TEAM: [
    "team",
    "founder",
    "leadership",
    "hiring",
    "headcount",
    "employee",
    "who runs",
  ],
  STRATEGY: [
    "strategy",
    "strategic",
    "expansion",
    "roadmap",
    "direction",
    "priorit",
    "plan for",
  ],
  CAPITAL_OBJECTIVE: [
    "raising",
    "raise",
    "round",
    "fundrais",
    "capital objective",
    "use of funds",
    "target close",
  ],
};

export function focusFromQuestion(
  question: string,
): readonly CompanyIntelligenceDimension[] {
  const text = question.toLowerCase();
  const matched: CompanyIntelligenceDimension[] = [];
  for (const [dimension, terms] of Object.entries(DIMENSION_TERMS) as readonly [
    CompanyIntelligenceDimension,
    readonly string[],
  ][]) {
    if (terms.some((term) => text.includes(term))) {
      matched.push(dimension);
    }
  }
  return matched;
}

/**
 * Whether the question is asking what changed. Used only to decide whether
 * to read a knowledge SERIES rather than only its current reading — never
 * to decide what may be read.
 */
export function asksAboutChange(question: string): boolean {
  const text = question.toLowerCase();
  return (
    text.includes("chang") ||
    text.includes("since") ||
    text.includes("moved") ||
    text.includes("progress") ||
    text.includes("different now") ||
    text.includes("update")
  );
}

/**
 * Whether the question is asking what Capital Q does not know. A gap
 * question does not create gaps; it decides how prominently the ones that
 * exist are reported.
 */
export function asksAboutGaps(question: string): boolean {
  const text = question.toLowerCase();
  return (
    text.includes("don't we know") ||
    text.includes("dont we know") ||
    text.includes("do not know") ||
    text.includes("missing") ||
    text.includes("what's missing") ||
    text.includes("gaps") ||
    text.includes("unknown")
  );
}
