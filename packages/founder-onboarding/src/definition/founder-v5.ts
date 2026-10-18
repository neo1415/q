import type {
  OnboardingDefinitionManifest,
  OnboardingStepManifest,
} from "@capital-q/onboarding";

import { COUNTRY_OPTIONS, FOUNDER_STEPS } from "./founder-v1.js";
import { FOUNDER_DEFINITION_V4 } from "./founder-v4.js";

/**
 * Founder Definition v5 -- v4 with the Gulf on the country list (2026-10-15).
 *
 * Qatar was not on it: a Doha founder could only answer "somewhere else"
 * and spell the country out. v5 adds the GCC countries the list lacked
 * (Qatar, Saudi Arabia, Kuwait, Bahrain, Oman; the UAE was already there)
 * before "somewhere else". Option keys stay lowercase ISO 3166-1 alpha-2,
 * which is what the write target upper-cases into the headquarters country.
 *
 * Nothing else changes: every v4 step key, order, branch and mapping is the
 * same, so an answer valid in v4 is valid in v5. v4 stays published and
 * immutable; sessions pinned to it keep running it.
 */
export const FOUNDER_DEFINITION_V5_VERSION = 5 as const;

export const GCC_COUNTRY_OPTIONS = [
  { optionKey: "qa", label: "Qatar" },
  { optionKey: "sa", label: "Saudi Arabia" },
  { optionKey: "kw", label: "Kuwait" },
  { optionKey: "bh", label: "Bahrain" },
  { optionKey: "om", label: "Oman" },
] as const;

/** v1's list with the Gulf added before "somewhere else". */
export const COUNTRY_OPTIONS_V5 = [
  ...COUNTRY_OPTIONS.filter((o) => o.optionKey !== "other"),
  ...GCC_COUNTRY_OPTIONS,
  ...COUNTRY_OPTIONS.filter((o) => o.optionKey === "other"),
];

function withGulfCountries(
  steps: readonly OnboardingStepManifest[],
): OnboardingStepManifest[] {
  return steps.map((step) =>
    step.stepKey === FOUNDER_STEPS.country &&
    step.configuration.stepType === "single_select"
      ? {
          ...step,
          configuration: { ...step.configuration, options: COUNTRY_OPTIONS_V5 },
        }
      : step,
  );
}

export const FOUNDER_DEFINITION_V5: OnboardingDefinitionManifest = {
  ...FOUNDER_DEFINITION_V4,
  version: FOUNDER_DEFINITION_V5_VERSION,
  steps: withGulfCountries(FOUNDER_DEFINITION_V4.steps),
};
