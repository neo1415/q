import type {
  OnboardingDefinitionManifest,
  OnboardingStepManifest,
} from "@capital-q/onboarding";

import {
  FOUNDER_PHASES,
  FOUNDER_STEPS,
  FOUNDER_WRITE_TARGETS,
} from "./founder-v1.js";
import { FOUNDER_DEFINITION_V9 } from "./founder-v9.js";

/**
 * Founder Definition v10 -- v9 with the profile fields onboarding never
 * asked (DECISIONS 79, the integration owner's audit decisions, batch 7):
 * every field the profile shows is mandatory.
 *
 * - F1.city, right after the country and asked with it: the profile shows
 *   the city beside the country.
 * - F1.founded_year, one short question: the profile shows when the
 *   company was founded. A year is what people know; it is kept as the
 *   year (the first of January of it, shown as the year only).
 * - F1.one_line, right after what the company does: the profile's "in one
 *   line" and header tagline, which semantic matching reads. Q drafts it
 *   from their description and asks them to confirm it.
 *
 * All three write the company's basics (headquarters city, founded date,
 * short description) and are mandatory; "I don't know" answers each.
 * The legal name stays with verification (KYB), never onboarding.
 *
 * Every v9 step key, type, branch and write target is the same, so an
 * answer valid in v9 is valid in v10. v9 stays published and immutable.
 */
export const FOUNDER_DEFINITION_V10_VERSION = 10 as const;

export const FOUNDER_V10_STEPS = {
  city: "F1.city",
  foundedYear: "F1.founded_year",
  oneLine: "F1.one_line",
} as const;

/** The longest one-line summary (the company's short description). */
export const FOUNDER_ONE_LINE_MAX_LENGTH = 400;

const CITY_STEP: Omit<OnboardingStepManifest, "sequenceOrder"> = {
  stepKey: FOUNDER_V10_STEPS.city,
  required: true,
  branching: null,
  configuration: {
    stepType: "short_text",
    phaseKey: FOUNDER_PHASES.F1,
    prompt: "Which city?",
    supportingText: "Where the company is based.",
    minLength: 1,
    maxLength: 120,
  },
  writesTo: [{ targetKey: FOUNDER_WRITE_TARGETS.companyBasics }],
};

const FOUNDED_YEAR_STEP: Omit<OnboardingStepManifest, "sequenceOrder"> = {
  stepKey: FOUNDER_V10_STEPS.foundedYear,
  required: true,
  branching: null,
  configuration: {
    stepType: "range",
    phaseKey: FOUNDER_PHASES.F1,
    prompt: "What year was the company founded?",
    min: "1800",
    max: "2100",
    step: "1",
  },
  writesTo: [{ targetKey: FOUNDER_WRITE_TARGETS.companyBasics }],
};

const ONE_LINE_STEP: Omit<OnboardingStepManifest, "sequenceOrder"> = {
  stepKey: FOUNDER_V10_STEPS.oneLine,
  required: true,
  branching: null,
  configuration: {
    stepType: "short_text",
    phaseKey: FOUNDER_PHASES.F1,
    prompt: "The company in one line",
    supportingText:
      "The line investors see first. Q can draft it from what the company does, for you to confirm or change.",
    minLength: 1,
    maxLength: FOUNDER_ONE_LINE_MAX_LENGTH,
  },
  writesTo: [{ targetKey: FOUNDER_WRITE_TARGETS.companyBasics }],
};

/** The country step no longer sends the city to its note. */
const COUNTRY_SUPPORTING_TEXT = "Search for the country.";

function v10Steps(
  steps: readonly OnboardingStepManifest[],
): OnboardingStepManifest[] {
  const out: Omit<OnboardingStepManifest, "sequenceOrder">[] = [];
  for (const step of steps) {
    if (step.stepKey === FOUNDER_STEPS.country) {
      out.push({
        ...step,
        configuration: {
          ...step.configuration,
          supportingText: COUNTRY_SUPPORTING_TEXT,
        },
      });
      out.push(CITY_STEP, FOUNDED_YEAR_STEP);
      continue;
    }
    out.push(step);
    if (step.stepKey === FOUNDER_STEPS.description) out.push(ONE_LINE_STEP);
  }
  return out.map((step, sequenceOrder) => ({ ...step, sequenceOrder }));
}

export const FOUNDER_DEFINITION_V10: OnboardingDefinitionManifest = {
  ...FOUNDER_DEFINITION_V9,
  version: FOUNDER_DEFINITION_V10_VERSION,
  steps: v10Steps(FOUNDER_DEFINITION_V9.steps),
};
