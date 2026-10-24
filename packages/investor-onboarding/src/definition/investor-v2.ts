import type {
  OnboardingDefinitionManifest,
  OnboardingStepManifest,
} from "@capital-q/onboarding";

import {
  INVESTOR_DEFINITION_V1,
  INVESTOR_PHASES,
  INVESTOR_REVISABLE_STEPS as INVESTOR_REVISABLE_STEPS_V1,
  INVESTOR_STEPS,
} from "./investor-v1.js";

/**
 * Investor Definition v2 -- v1 with the firm's website (QO-27c, 24 Oct).
 *
 * An investor who said "our website is ..." was told it was queued, and
 * nothing held it: v1 had no step for it. v2 adds one optional short-text
 * step after the firm's name. It writes the investor organisation's
 * `website_url` only; the address is what the investor told Q, never a
 * verified domain, and it changes no verification state.
 *
 * Nothing else changes: every v1 step key, branch and mapping is the same,
 * so an answer valid in v1 is valid in v2. v1 stays published and
 * immutable; sessions pinned to it keep running it.
 */
export const INVESTOR_DEFINITION_V2_VERSION = 2 as const;

export const INVESTOR_WEBSITE_STEP = "I0.website" as const;

export const INVESTOR_WEBSITE_WRITE_TARGET = "investor.website" as const;

const WEBSITE_STEP: Omit<OnboardingStepManifest, "sequenceOrder"> = {
  stepKey: INVESTOR_WEBSITE_STEP,
  required: false,
  branching: null,
  configuration: {
    stepType: "short_text",
    phaseKey: INVESTOR_PHASES.I0,
    prompt: "Your firm's website",
    supportingText: "Optional. Founders can see who you are before they reply.",
    minLength: 1,
    maxLength: 200,
    placeholder: "example.com",
  },
  writesTo: [{ targetKey: INVESTOR_WEBSITE_WRITE_TARGET }],
};

function withWebsite(
  steps: readonly OnboardingStepManifest[],
): OnboardingStepManifest[] {
  const out: Omit<OnboardingStepManifest, "sequenceOrder">[] = [];
  for (const step of steps) {
    out.push(step);
    if (step.stepKey === INVESTOR_STEPS.organisationName) {
      out.push(WEBSITE_STEP);
    }
  }
  return out.map((step, sequenceOrder) => ({ ...step, sequenceOrder }));
}

export const INVESTOR_DEFINITION_V2: OnboardingDefinitionManifest = {
  ...INVESTOR_DEFINITION_V1,
  version: INVESTOR_DEFINITION_V2_VERSION,
  steps: withWebsite(INVESTOR_DEFINITION_V1.steps),
};

/** The website may be revised after onboarding too. */
export const INVESTOR_REVISABLE_STEPS: ReadonlySet<string> = new Set([
  ...INVESTOR_REVISABLE_STEPS_V1,
  INVESTOR_WEBSITE_STEP,
]);
