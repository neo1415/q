import type {
  BranchExpression,
  OnboardingDefinitionManifest,
  OnboardingStepManifest,
} from "@capital-q/onboarding";

import {
  CURRENCY_OPTIONS,
  EARLY_STAGE_OPTIONS,
  FOUNDER_PHASES,
  FOUNDER_REVISABLE_STEPS as FOUNDER_REVISABLE_STEPS_V1,
  FOUNDER_STEPS,
  LATER_STAGE_OPTIONS,
  RAISING_ACTIVE_OPTIONS,
} from "./founder-v1.js";
import { FOUNDER_DEFINITION_V3 } from "./founder-v3.js";

/**
 * Founder Definition v4 -- v3 plus an adaptive financials block (Q.01,
 * audit docs/strategy/q-promises-2026-10-07.md: "financials stop at revenue
 * band + customer count").
 *
 * After the traction questions, Q asks for the numbers investors ask first:
 * last month's revenue and its trend, gross margin, monthly burn, cash in
 * the bank and runway, and, when raising, the smallest cheque the founder
 * would take. Every one is optional; skipping leaves it unknown, which is
 * never recorded as zero. Revenue questions are asked only of a company
 * that says it has revenue (never "what is your margin" to a pre-revenue
 * founder).
 *
 * Each answer is written, by the `company.financial_claims` target, as the
 * founder's own claim through the Knowledge Write Gate: USER_CLAIM,
 * SELF_REPORTED, founder_private. Money is a decimal string plus an ISO
 * currency, never a float.
 *
 * Every v3 step key, order, branch and mapping is unchanged, so an answer
 * valid in v3 is valid in v4. v3 stays published and immutable; sessions
 * pinned to it keep running it.
 */

export const FOUNDER_DEFINITION_V4_VERSION = 4 as const;

export const FOUNDER_FINANCIAL_STEPS = {
  currency: "F5.fin_currency",
  monthlyRevenue: "F5.monthly_revenue",
  revenueTrend: "F5.revenue_trend",
  grossMargin: "F5.gross_margin",
  monthlyBurn: "F5.monthly_burn",
  cash: "F5.cash",
  runway: "F5.runway_months",
  minCheque: "F6.min_cheque",
} as const;

export const FOUNDER_FINANCIAL_WRITE_TARGET = "company.financial_claims";

export const REVENUE_TREND_OPTIONS = [
  { optionKey: "growing", label: "Growing month on month" },
  { optionKey: "flat", label: "Roughly flat" },
  { optionKey: "declining", label: "Declining" },
  { optionKey: "lumpy", label: "Lumpy: depends on the month" },
];

/**
 * A company says it has revenue: a later-stage company that described
 * revenue, or an early one whose signal is paying customers. An unanswered
 * revenue question is not "no revenue": the block simply is not offered.
 */
const hasRevenue: BranchExpression = {
  op: "ANY",
  expressions: [
    {
      op: "ALL",
      expressions: [
        {
          op: "IN",
          stepKey: FOUNDER_STEPS.stage,
          values: [...LATER_STAGE_OPTIONS],
        },
        { op: "EXISTS", stepKey: FOUNDER_STEPS.revenueStatus },
      ],
    },
    {
      op: "ALL",
      expressions: [
        {
          op: "IN",
          stepKey: FOUNDER_STEPS.stage,
          values: [...EARLY_STAGE_OPTIONS],
        },
        { op: "IN", stepKey: FOUNDER_STEPS.signal, values: ["paying"] },
      ],
    },
  ],
};

const raising: BranchExpression = {
  op: "IN",
  stepKey: FOUNDER_STEPS.raising,
  values: [...RAISING_ACTIVE_OPTIONS],
};

type StepInput = Omit<OnboardingStepManifest, "sequenceOrder">;

const money = (
  stepKey: string,
  prompt: string,
  supportingText: string,
  branching: BranchExpression | null,
  phaseKey: string = FOUNDER_PHASES.F5,
): StepInput => ({
  stepKey,
  required: false,
  branching,
  configuration: {
    stepType: "range",
    phaseKey,
    prompt,
    supportingText,
    min: "0",
    max: "1000000000000",
    step: "1",
  },
  writesTo: [{ targetKey: FOUNDER_FINANCIAL_WRITE_TARGET }],
});

/** The F5 financials block, asked after growth. */
const FINANCIAL_BLOCK: readonly StepInput[] = [
  {
    stepKey: FOUNDER_FINANCIAL_STEPS.currency,
    required: false,
    branching: null,
    configuration: {
      stepType: "single_select",
      phaseKey: FOUNDER_PHASES.F5,
      prompt: "Which currency do you report your numbers in?",
      supportingText:
        "Only your team sees your financials. Skip anything you don't know yet.",
      options: CURRENCY_OPTIONS,
    },
    writesTo: [],
  },
  money(
    FOUNDER_FINANCIAL_STEPS.monthlyRevenue,
    "Roughly what did you bill last month?",
    "A round number is fine.",
    hasRevenue,
  ),
  {
    stepKey: FOUNDER_FINANCIAL_STEPS.revenueTrend,
    required: false,
    branching: hasRevenue,
    configuration: {
      stepType: "single_select",
      phaseKey: FOUNDER_PHASES.F5,
      prompt: "How has monthly revenue moved lately?",
      options: REVENUE_TREND_OPTIONS,
    },
    writesTo: [{ targetKey: FOUNDER_FINANCIAL_WRITE_TARGET }],
  },
  {
    stepKey: FOUNDER_FINANCIAL_STEPS.grossMargin,
    required: false,
    branching: hasRevenue,
    configuration: {
      stepType: "range",
      phaseKey: FOUNDER_PHASES.F5,
      prompt: "What is your gross margin?",
      supportingText: "As a percentage of revenue.",
      min: "-100",
      max: "100",
      step: "1",
      unit: "%",
    },
    writesTo: [{ targetKey: FOUNDER_FINANCIAL_WRITE_TARGET }],
  },
  money(
    FOUNDER_FINANCIAL_STEPS.monthlyBurn,
    "How much do you spend beyond revenue each month?",
    "Net burn. Investors never see this unless you share it.",
    null,
  ),
  money(
    FOUNDER_FINANCIAL_STEPS.cash,
    "How much cash is in the bank today?",
    "Investors never see this unless you share it.",
    null,
  ),
  {
    stepKey: FOUNDER_FINANCIAL_STEPS.runway,
    required: false,
    branching: null,
    configuration: {
      stepType: "range",
      phaseKey: FOUNDER_PHASES.F5,
      prompt: "How many months of runway is that?",
      min: "0",
      max: "240",
      step: "1",
      unit: "months",
    },
    writesTo: [{ targetKey: FOUNDER_FINANCIAL_WRITE_TARGET }],
  },
];

/** Asked after the use of funds, when raising: in the raise's own currency. */
const MIN_CHEQUE: StepInput = money(
  FOUNDER_FINANCIAL_STEPS.minCheque,
  "What is the smallest cheque you would take?",
  "In the raise's currency. Skip if any size is welcome.",
  raising,
  FOUNDER_PHASES.F6,
);

function withFinancials(
  steps: readonly OnboardingStepManifest[],
): OnboardingStepManifest[] {
  const out: StepInput[] = [];
  for (const step of steps) {
    out.push(step);
    if (step.stepKey === FOUNDER_STEPS.growth) out.push(...FINANCIAL_BLOCK);
    if (step.stepKey === FOUNDER_STEPS.useOfFunds) out.push(MIN_CHEQUE);
  }
  return out.map((step, sequenceOrder) => ({ ...step, sequenceOrder }));
}

export const FOUNDER_DEFINITION_V4: OnboardingDefinitionManifest = {
  ...FOUNDER_DEFINITION_V3,
  version: FOUNDER_DEFINITION_V4_VERSION,
  steps: withFinancials(FOUNDER_DEFINITION_V3.steps),
};

/** Every financial step may be revised after onboarding (ADR 0024). */
export const FOUNDER_REVISABLE_STEPS: ReadonlySet<string> = new Set([
  ...FOUNDER_REVISABLE_STEPS_V1,
  ...Object.values(FOUNDER_FINANCIAL_STEPS),
]);
