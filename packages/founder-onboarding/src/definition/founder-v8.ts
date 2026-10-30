import type {
  OnboardingDefinitionManifest,
  OnboardingStepManifest,
} from "@capital-q/onboarding";

import { FOUNDER_STEPS } from "./founder-v1.js";
import { FOUNDER_DEFINITION_V7 } from "./founder-v7.js";

/**
 * Founder Definition v8 -- v7 with the country chosen from the geography
 * taxonomy (owner 2026-10-30: "hand-made country lists are patching").
 *
 * Up to v7 F1.country was a single select over a fixed list of twenty
 * countries plus "somewhere else": "Copenhagen, Denmark" was saved as
 * "other". The geography vocabulary already holds every ISO 3166-1
 * country (geography v5), so v8 binds the step to it, the way the
 * investor's geography step works: a reference to one geography node,
 * searched, never an option list. The write target accepts only a node
 * that is a country (it carries an ISO code; a region is refused) and
 * stores its ISO code as the company's headquarters country, as before.
 * A city stays free text: the answer's note, in their words.
 *
 * Nothing else changes: every other v7 step is identical. v7 stays
 * published and immutable; sessions pinned to it (and to v1-v6) keep their
 * option answers, which `founderCountryIso` reads to the same ISO code.
 */
export const FOUNDER_DEFINITION_V8_VERSION = 8 as const;

/** The vocabulary the founder's country is chosen from. */
export const FOUNDER_COUNTRY_VOCABULARIES = ["geography"] as const;

function withCountryFromGeography(
  step: OnboardingStepManifest,
): OnboardingStepManifest {
  if (step.stepKey !== FOUNDER_STEPS.country) return step;
  const { prompt, phaseKey } = step.configuration;
  return {
    ...step,
    configuration: {
      stepType: "reference_select",
      prompt,
      supportingText:
        "Optional for now. Search for the country; a city can go in your own words.",
      ...(phaseKey === undefined ? {} : { phaseKey }),
      resourceType: "TAXONOMY_NODE",
      vocabularyCodes: [...FOUNDER_COUNTRY_VOCABULARIES],
      minItems: 1,
      maxItems: 1,
    },
  };
}

export const FOUNDER_DEFINITION_V8: OnboardingDefinitionManifest = {
  ...FOUNDER_DEFINITION_V7,
  version: FOUNDER_DEFINITION_V8_VERSION,
  steps: FOUNDER_DEFINITION_V7.steps.map(withCountryFromGeography),
};
