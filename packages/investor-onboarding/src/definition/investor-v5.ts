import type {
  OnboardingDefinitionManifest,
  OnboardingStepManifest,
} from "@capital-q/onboarding";

import { INVESTOR_PHASES, INVESTOR_STEPS } from "./investor-v1.js";
import { INVESTOR_DEFINITION_V4 } from "./investor-v4.js";

/**
 * Investor Definition v5 -- v4 with every field the profile shows made
 * mandatory (DECISIONS 79, integration owner's audit decisions, batch 7).
 *
 * - New, mandatory: I11.public_description, the firm's description as the
 *   profile shows it ("In your words"). Q drafts it from what they told it
 *   about their mandate and asks them to confirm; their own words are kept
 *   when they give them. It writes the organisation's public_description.
 * - Now mandatory: every preference list the profile and mandate show --
 *   how firm each focus is, sectors to avoid, business models, customer
 *   types, capital intensity, regulated markets, revenue, founder fit,
 *   green flags and their strength, what else they look for, what they'd
 *   rather not see, what is never shown, excluded sectors, portfolio, and
 *   the thesis in their words.
 * - "None" answers each list (`NONE_ANSWER_TEXT`, INVESTOR_NONE_STEPS): for
 *   many investors "no preference" is the honest answer, and a mandatory
 *   step cannot be declined. "None" holds no value, so nothing is
 *   preferred, avoided or excluded, and no "how firm is that?" follows it.
 *   "I don't know" stays an answer too.
 * - Unchanged: the discovery style stays optional (owner).
 *
 * Every v4 step key, type, option, branch and write target is the same, so
 * an answer valid in v4 is valid in v5. v4 stays published and immutable.
 */
export const INVESTOR_DEFINITION_V5_VERSION = 5 as const;

export const INVESTOR_PUBLIC_DESCRIPTION_STEP =
  "I11.public_description" as const;

export const INVESTOR_PUBLIC_DESCRIPTION_WRITE_TARGET =
  "investor.public_description" as const;

/**
 * The lists "None" answers: nothing preferred, avoided, excluded or added.
 * A strength ("how firm is that?") is not among them: it is asked only
 * about a list that holds something.
 */
export const INVESTOR_NONE_STEPS: ReadonlySet<string> = new Set([
  INVESTOR_STEPS.sectorsAvoid,
  INVESTOR_STEPS.businessModels,
  INVESTOR_STEPS.customerTypes,
  INVESTOR_STEPS.capitalIntensity,
  INVESTOR_STEPS.regulatoryAppetite,
  INVESTOR_STEPS.revenueState,
  INVESTOR_STEPS.founderPreferences,
  INVESTOR_STEPS.greenFlags,
  INVESTOR_STEPS.customCriteria,
  INVESTOR_STEPS.avoid,
  INVESTOR_STEPS.hardExclusions,
  INVESTOR_STEPS.sectorExclusions,
  INVESTOR_STEPS.portfolio,
  INVESTOR_STEPS.additionalContext,
]);

/** Steps v5 makes mandatory: the lists, and the strength of each focus. */
export const INVESTOR_V5_NOW_REQUIRED: ReadonlySet<string> = new Set([
  ...INVESTOR_NONE_STEPS,
  INVESTOR_STEPS.geographyStrength,
  INVESTOR_STEPS.sectorStrength,
  INVESTOR_STEPS.founderStrength,
  INVESTOR_STEPS.greenFlagStrength,
]);

const PUBLIC_DESCRIPTION_STEP: Omit<OnboardingStepManifest, "sequenceOrder"> = {
  stepKey: INVESTOR_PUBLIC_DESCRIPTION_STEP,
  required: true,
  branching: null,
  configuration: {
    stepType: "long_text",
    phaseKey: INVESTOR_PHASES.I11,
    prompt: "How would you describe your firm to a founder?",
    supportingText:
      "A few sentences for your profile. Q can draft it from what you've told it, for you to confirm or change.",
    minLength: 1,
    maxLength: 4000,
  },
  writesTo: [{ targetKey: INVESTOR_PUBLIC_DESCRIPTION_WRITE_TARGET }],
};

function v5Steps(
  steps: readonly OnboardingStepManifest[],
): OnboardingStepManifest[] {
  const out: Omit<OnboardingStepManifest, "sequenceOrder">[] = [];
  for (const step of steps) {
    // The description comes just before their thesis: by then Q has the
    // whole mandate to draft it from.
    if (step.stepKey === INVESTOR_STEPS.additionalContext) {
      out.push(PUBLIC_DESCRIPTION_STEP);
    }
    if (step.stepKey === INVESTOR_STEPS.additionalContext) {
      out.push({
        ...step,
        required: true,
        configuration: {
          ...step.configuration,
          supportingText:
            "Your thesis in your own words. Stored with the mandate for people to read; the structured criteria above stay authoritative.",
        },
      });
      continue;
    }
    out.push(
      INVESTOR_V5_NOW_REQUIRED.has(step.stepKey)
        ? { ...step, required: true }
        : step,
    );
  }
  return out.map((step, sequenceOrder) => ({ ...step, sequenceOrder }));
}

export const INVESTOR_DEFINITION_V5: OnboardingDefinitionManifest = {
  ...INVESTOR_DEFINITION_V4,
  version: INVESTOR_DEFINITION_V5_VERSION,
  steps: v5Steps(INVESTOR_DEFINITION_V4.steps),
};
