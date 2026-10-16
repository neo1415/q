import type {
  OnboardingDefinitionManifest,
  OnboardingStepManifest,
} from "@capital-q/onboarding";

import { FOUNDER_STEPS } from "./founder-v1.js";
import { FOUNDER_REVISABLE_STEPS as FOUNDER_REVISABLE_STEPS_V4 } from "./founder-v4.js";
import { FOUNDER_DEFINITION_V5 } from "./founder-v5.js";
import {
  FOUNDER_PROFILE_SECTIONS,
  type FounderProfileSection,
} from "./profile-sections.js";

/**
 * Founder Definition v6 -- v5 with the company profile sections (owner
 * template, 2026-10-16).
 *
 * Every section of the profile that no v5 step holds gets one optional
 * long-text step in a new phase, F9 "Company profile", placed after the raise
 * and before "A few questions". Q fills them from the deck, then the pitch
 * transcript, and asks only for gaps; the form shows them as optional. Our
 * Team and Our Ask stay the v5 steps that already collect them.
 *
 * Nothing else changes: every v5 step key, branch and mapping is the same,
 * so an answer valid in v5 is valid in v6. v5 stays published and
 * immutable; sessions pinned to it keep running it.
 */
export const FOUNDER_DEFINITION_V6_VERSION = 6 as const;

export const FOUNDER_PROFILE_PHASE = "F9" as const;

type StepInput = Omit<OnboardingStepManifest, "sequenceOrder">;

/** One optional long-text step per section that has a step of its own. */
function sectionStep(
  section: FounderProfileSection,
  stepKey: string,
): StepInput {
  return {
    stepKey,
    required: false,
    branching: null,
    configuration: {
      stepType: "long_text",
      phaseKey: FOUNDER_PROFILE_PHASE,
      prompt: section.question ?? section.title,
      supportingText:
        "Optional. A few sentences is plenty; Q drafts this from your deck or pitch when it can.",
      minLength: 1,
      maxLength: 2000,
    },
    writesTo: [],
  };
}

export const FOUNDER_PROFILE_SECTION_STEPS: readonly StepInput[] =
  FOUNDER_PROFILE_SECTIONS.flatMap((section) =>
    section.stepKeys
      .filter((key) => key.startsWith(`${FOUNDER_PROFILE_PHASE}.`))
      .map((key) => sectionStep(section, key)),
  );

function withProfileSections(
  steps: readonly OnboardingStepManifest[],
): OnboardingStepManifest[] {
  const out: StepInput[] = [];
  for (const step of steps) {
    if (step.stepKey === FOUNDER_STEPS.followUp) {
      out.push(...FOUNDER_PROFILE_SECTION_STEPS);
    }
    out.push(step);
  }
  return out.map((step, sequenceOrder) => ({ ...step, sequenceOrder }));
}

const v5Schema = FOUNDER_DEFINITION_V5.schema;

export const FOUNDER_DEFINITION_V6: OnboardingDefinitionManifest = {
  ...FOUNDER_DEFINITION_V5,
  version: FOUNDER_DEFINITION_V6_VERSION,
  schema: {
    ...v5Schema,
    phases: v5Schema.phases.flatMap((phase) =>
      phase.phaseKey === "F7"
        ? [{ phaseKey: FOUNDER_PROFILE_PHASE, label: "Company profile" }, phase]
        : [phase],
    ),
  },
  steps: withProfileSections(FOUNDER_DEFINITION_V5.steps),
};

/** The profile sections may be revised after onboarding too (ADR 0024). */
export const FOUNDER_REVISABLE_STEPS: ReadonlySet<string> = new Set([
  ...FOUNDER_REVISABLE_STEPS_V4,
  ...FOUNDER_PROFILE_SECTION_STEPS.map((step) => step.stepKey),
]);
