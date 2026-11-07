import type {
  OnboardingDefinitionManifest,
  OnboardingStepManifest,
} from "@capital-q/onboarding";

import { FOUNDER_STEPS } from "./founder-v1.js";
import { FOUNDER_DEFINITION_V8 } from "./founder-v8.js";

/**
 * Founder Definition v9 -- v8 with the owner's mandatory set (DECISIONS 79,
 * 2026-11-07; proposal in docs/ai-handoff/ONBOARDING-TEST-PLAN.md §8).
 *
 * Mandatory = what the profile shows, plus what matching and verification
 * need. "I don't know" is an answer to every one of them and is recorded as
 * unknown (D-OWN-1; `isNotKnownAnswer`), so a mandatory step never forces a
 * value nobody has.
 *
 * - Now mandatory: the website ("no website yet" is unknown), the country,
 *   what the company does, its categories (profile, matching and
 *   verification), and the traction and raise details the profile shows
 *   (pilots, customers, growth; instrument, timeframe, use of funds, each
 *   only on the path that asks it).
 * - Now optional: why they came (F0.intent writes nothing; F6.raising holds
 *   the fact).
 * - Unchanged: the deck is encouraged, never blocking (F2.materials stays
 *   optional); the founder's role is the founder information asked for
 *   (owner); every other step.
 *
 * The copy no longer calls a mandatory step optional. Step keys, types,
 * options, branches and write targets are all as in v8, so an answer valid
 * in v8 is valid in v9. v8 stays published and immutable.
 */
export const FOUNDER_DEFINITION_V9_VERSION = 9 as const;

/** Steps v9 makes mandatory (each still only on its own path). */
export const FOUNDER_V9_NOW_REQUIRED: ReadonlySet<string> = new Set([
  FOUNDER_STEPS.website,
  FOUNDER_STEPS.country,
  FOUNDER_STEPS.description,
  FOUNDER_STEPS.categories,
  FOUNDER_STEPS.pilots,
  FOUNDER_STEPS.customers,
  FOUNDER_STEPS.growth,
  FOUNDER_STEPS.instrument,
  FOUNDER_STEPS.timeframe,
  FOUNDER_STEPS.useOfFunds,
]);

/** Steps v9 makes optional. */
export const FOUNDER_V9_NOW_OPTIONAL: ReadonlySet<string> = new Set([
  FOUNDER_STEPS.intent,
]);

/** Copy that called a now-mandatory step optional. */
const SUPPORTING_TEXT: Readonly<Record<string, string>> = {
  [FOUNDER_STEPS.website]:
    "Q reads it to fill gaps. No website yet? Say so; that's an answer.",
  [FOUNDER_STEPS.country]:
    "Search for the country; a city can go in your own words.",
};

function withMandatorySet(
  step: OnboardingStepManifest,
): OnboardingStepManifest {
  const required = FOUNDER_V9_NOW_REQUIRED.has(step.stepKey)
    ? true
    : FOUNDER_V9_NOW_OPTIONAL.has(step.stepKey)
      ? false
      : step.required;
  const supportingText = SUPPORTING_TEXT[step.stepKey];
  return {
    ...step,
    required,
    configuration:
      supportingText === undefined
        ? step.configuration
        : { ...step.configuration, supportingText },
  };
}

export const FOUNDER_DEFINITION_V9: OnboardingDefinitionManifest = {
  ...FOUNDER_DEFINITION_V8,
  version: FOUNDER_DEFINITION_V9_VERSION,
  steps: FOUNDER_DEFINITION_V8.steps.map(withMandatorySet),
};
