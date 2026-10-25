import type {
  OnboardingDefinitionManifest,
  OnboardingStepManifest,
} from "@capital-q/onboarding";

import {
  EARLY_STAGE_OPTIONS,
  FOUNDER_STEPS,
  LATER_STAGE_OPTIONS,
} from "./founder-v1.js";
import { FOUNDER_DEFINITION_V6 } from "./founder-v6.js";

/**
 * Founder Definition v7 -- v6 with the number of paying customers asked at
 * seed too (live 25 Oct e2e, owner-approved).
 *
 * v4 gave an early-stage company whose signal is "Paying customers" the
 * revenue questions (monthly revenue, trend, margin), but the paying
 * customers count (F5.customers) stayed on the path only from Series A. A
 * seed company's deck said "210 customers": the fact could settle nowhere,
 * was read back, confirmed, and kept only as a note.
 *
 * v7 puts F5.customers on the path for an early-stage company whose signal
 * is paying customers, the same condition as v4's revenue questions, as
 * well as from Series A as before. Nothing else changes: every v6 step key,
 * option and mapping is the same, so an answer valid in v6 is valid in v7.
 * v6 stays published and immutable; sessions pinned to it keep running it.
 */
export const FOUNDER_DEFINITION_V7_VERSION = 7 as const;

/** F5.signal's option for paying customers (since v4). */
const PAYING_SIGNAL = "paying";

function withCustomersAtSeed(
  step: OnboardingStepManifest,
): OnboardingStepManifest {
  if (step.stepKey !== FOUNDER_STEPS.customers) return step;
  return {
    ...step,
    branching: {
      op: "ANY",
      expressions: [
        {
          op: "IN",
          stepKey: FOUNDER_STEPS.stage,
          values: [...LATER_STAGE_OPTIONS],
        },
        {
          op: "ALL",
          expressions: [
            {
              op: "IN",
              stepKey: FOUNDER_STEPS.stage,
              values: [...EARLY_STAGE_OPTIONS],
            },
            {
              op: "IN",
              stepKey: FOUNDER_STEPS.signal,
              values: [PAYING_SIGNAL],
            },
          ],
        },
      ],
    },
  };
}

export const FOUNDER_DEFINITION_V7: OnboardingDefinitionManifest = {
  ...FOUNDER_DEFINITION_V6,
  version: FOUNDER_DEFINITION_V7_VERSION,
  steps: FOUNDER_DEFINITION_V6.steps.map(withCustomersAtSeed),
};
