import type {
  OnboardingDefinitionManifest,
  OnboardingStepManifest,
} from "@capital-q/onboarding";

import { FOUNDER_STEPS, SIGNAL_OPTIONS } from "./founder-v1.js";
import { FOUNDER_DEFINITION_V2 } from "./founder-v2.js";

/**
 * Founder Definition v3 -- v2, with the early signals founders actually
 * have (lead decision 2026-10-01, harden spec §3).
 *
 * Live (bench, 2026-10-01): a pre-seed founder with "a few paying customers
 * on annual contracts" fit none of F5.signal's options, the step keeps no
 * other words, and Q put the same choice six turns running. Paying
 * customers are the strongest early signal a pre-seed company can have,
 * and a signed partnership or distribution deal the next most common one
 * the list lacked. Both are added; nothing else changes. Every step key,
 * order, branch and mapping is v2's, so v3 is a strict superset: an answer
 * valid in v2 is valid in v3.
 *
 * v2 stays published and immutable; sessions pinned to it keep running it.
 */

export const FOUNDER_DEFINITION_V3_VERSION = 3 as const;

export const SIGNAL_OPTIONS_V3 = [
  ...SIGNAL_OPTIONS.filter((option) => option.optionKey !== "none"),
  { optionKey: "paying", label: "Paying customers" },
  {
    optionKey: "partnerships",
    label: "Signed partnerships or distribution deals",
  },
  // Last, as in v2: the answer when none of the others is true.
  ...SIGNAL_OPTIONS.filter((option) => option.optionKey === "none"),
];

function withV3Signal(step: OnboardingStepManifest): OnboardingStepManifest {
  if (
    step.stepKey !== FOUNDER_STEPS.signal ||
    step.configuration.stepType !== "single_select"
  ) {
    return step;
  }
  return {
    ...step,
    configuration: { ...step.configuration, options: SIGNAL_OPTIONS_V3 },
  };
}

export const FOUNDER_DEFINITION_V3: OnboardingDefinitionManifest = {
  ...FOUNDER_DEFINITION_V2,
  version: FOUNDER_DEFINITION_V3_VERSION,
  steps: FOUNDER_DEFINITION_V2.steps.map(withV3Signal),
};
