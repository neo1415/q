import { FOUNDER_STEPS } from "../definition/founder-v1.js";
import { FOUNDER_FINANCIAL_STEPS } from "../definition/founder-v4.js";
import type { FinancialMeasureKey } from "./measures.js";

/**
 * The journey step a measure is confirmed on: the founder's own question
 * for that figure, whose validated answer the existing write targets carry
 * into their claim. A measure with no step (annual revenue, CAC, churn) is
 * read but not offered in v1: there is no question it answers.
 */
export const MEASURE_STEPS: Readonly<
  Partial<Record<FinancialMeasureKey, string>>
> = {
  monthly_revenue: FOUNDER_FINANCIAL_STEPS.monthlyRevenue,
  net_burn: FOUNDER_FINANCIAL_STEPS.monthlyBurn,
  cash_balance: FOUNDER_FINANCIAL_STEPS.cash,
  gross_margin: FOUNDER_FINANCIAL_STEPS.grossMargin,
  runway_months: FOUNDER_FINANCIAL_STEPS.runway,
  paying_customers: FOUNDER_STEPS.customers,
  headcount: FOUNDER_STEPS.teamSize,
};

/** The fact key the onboarding suggestion names for each offered measure. */
export const MEASURE_TARGET_FIELDS: Readonly<
  Partial<Record<FinancialMeasureKey, string>>
> = {
  monthly_revenue: "financial.monthly_revenue",
  net_burn: "financial.burn_rate",
  cash_balance: "financial.cash_balance",
  gross_margin: "financial.gross_margin",
  runway_months: "financial.runway_months",
  paying_customers: "customers",
  headcount: "team_size",
};

export function measureOfStep(stepKey: string): FinancialMeasureKey | null {
  const found = Object.entries(MEASURE_STEPS).find(
    ([, step]) => step === stepKey,
  );
  return found === undefined ? null : (found[0] as FinancialMeasureKey);
}
