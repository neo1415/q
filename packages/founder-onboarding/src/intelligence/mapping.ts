import type { FounderFactKey } from "@capital-q/q-core";

import { FOUNDER_STEPS } from "../definition/founder-v1.js";

/**
 * Which onboarding step answers each extractable fact (CQ-Q-021 §20, §23).
 *
 * This table is the reason a suggestion can exist at all. A candidate is
 * only useful if the journey already has a step that knows how to validate
 * it, write it and show it back; a fact with no step is a fact Capital Q
 * would have nowhere to put, so it is dropped rather than invented into a
 * new question.
 *
 * It is also what makes "do not ask twice" decidable: a confirmed response
 * to the mapped step is exactly the evidence that the fact is answered.
 */

const FACT_TO_STEP: Readonly<Partial<Record<FounderFactKey, string>>> = {
  company_name: FOUNDER_STEPS.companyName,
  website: FOUNDER_STEPS.website,
  country: FOUNDER_STEPS.country,
  stage: FOUNDER_STEPS.stage,
  description: FOUNDER_STEPS.description,
  categories: FOUNDER_STEPS.categories,
  founder_role: FOUNDER_STEPS.founderRole,
  founder_count: FOUNDER_STEPS.founderCount,
  full_time: FOUNDER_STEPS.fullTime,
  team_size: FOUNDER_STEPS.teamSize,
  functions: FOUNDER_STEPS.functions,
  signal: FOUNDER_STEPS.signal,
  pilots: FOUNDER_STEPS.pilots,
  revenue_status: FOUNDER_STEPS.revenueStatus,
  customers: FOUNDER_STEPS.customers,
  growth: FOUNDER_STEPS.growth,
  raising: FOUNDER_STEPS.raising,
  currency: FOUNDER_STEPS.currency,
  target_amount: FOUNDER_STEPS.targetAmount,
  instrument: FOUNDER_STEPS.instrument,
  timeframe: FOUNDER_STEPS.timeframe,
  use_of_funds: FOUNDER_STEPS.useOfFunds,
};

export function stepForFactKey(key: FounderFactKey): string | null {
  return FACT_TO_STEP[key] ?? null;
}

export function factKeyForStep(stepKey: string): FounderFactKey | null {
  for (const [key, step] of Object.entries(FACT_TO_STEP)) {
    if (step === stepKey) {
      return key as FounderFactKey;
    }
  }
  return null;
}

/**
 * Facts a founder company cannot complete onboarding without.
 *
 * Deliberately short (§43). Onboarding completes when the minimum is known,
 * and everything else stays a visible gap rather than a blocked journey.
 * There is no "100% complete" here to chase.
 */
export const FOUNDER_REQUIRED_FACTS: readonly FounderFactKey[] = [
  "company_name",
  "country",
  "stage",
  "description",
  "categories",
  "founder_role",
];

/**
 * Which facts are worth asking about, given what kind of business this is
 * (§26).
 *
 * The rule this encodes: never ask a company for a metric its business does
 * not produce. A pre-revenue company has no retention rate, and asking for
 * one is not thoroughness — it teaches the founder that Capital Q is not
 * reading what they already said.
 *
 * Deliberately coarse. Three shapes, drawn from the revenue-status answer
 * the journey already collects, and nothing invented beyond it.
 */
export type BusinessShape = "PRE_REVENUE" | "EARLY_REVENUE" | "REVENUE";

const SHAPE_EXCLUSIONS: Readonly<
  Record<BusinessShape, readonly FounderFactKey[]>
> = {
  // Nothing is sold yet: revenue scale, customer counts and growth rates
  // describe something that does not exist. Pilots and early signal do.
  PRE_REVENUE: ["customers", "growth"],
  EARLY_REVENUE: ["growth"],
  REVENUE: ["pilots"],
};

export function factAppliesTo(
  key: FounderFactKey,
  shape: BusinessShape,
): boolean {
  return !SHAPE_EXCLUSIONS[shape].includes(key);
}

/**
 * The business shape, from the founder's own answer rather than a guess.
 *
 * An unanswered revenue status means PRE_REVENUE is not assumed: unknown is
 * unknown, and the caller gets `null` so it asks rather than excludes.
 */
export function businessShapeFrom(
  revenueStatus: string | null,
): BusinessShape | null {
  if (revenueStatus === null) {
    return null;
  }
  const value = revenueStatus.toLowerCase();
  if (value.includes("pre_revenue") || value.includes("none")) {
    return "PRE_REVENUE";
  }
  if (value.includes("early") || value.includes("first")) {
    return "EARLY_REVENUE";
  }
  return "REVENUE";
}

/** A plain sentence describing the shape, for the prompt's trusted frame. */
export function describeBusinessShape(
  shape: BusinessShape | null,
  stage: string | null,
): string {
  const parts: string[] = [];
  if (stage !== null) {
    parts.push(`Stage as the founder described it: ${stage}.`);
  }
  switch (shape) {
    case "PRE_REVENUE":
      parts.push(
        "The company reports no revenue yet, so do not ask about revenue scale, customer counts or growth rates; pilots, letters of intent, waitlists and partnerships are what matter here.",
      );
      break;
    case "EARLY_REVENUE":
      parts.push(
        "The company reports early revenue, so growth rates are premature; the number of paying customers and what they pay for are what matter.",
      );
      break;
    case "REVENUE":
      parts.push(
        "The company reports revenue, so commercial questions are appropriate; do not ask about pilots as though nothing were sold.",
      );
      break;
    case null:
      parts.push(
        "Capital Q does not yet know whether the company has revenue. Do not assume it does or does not.",
      );
      break;
  }
  return parts.join(" ");
}
