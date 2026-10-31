import type { OnboardingDefinitionManifest } from "@capital-q/onboarding";

import { DEPLOYMENT_STATUS_OPTIONS, INVESTOR_STEPS } from "./investor-v1.js";
import { INVESTOR_DEFINITION_V2 } from "./investor-v2.js";

/**
 * Investor Definition v3 -- v2 with "Not sure yet" on whether they are
 * deploying capital (live re-check 2026-10-31, coordinator decision per
 * CLAUDE.md: unknown is a valid state).
 *
 * The step is required and had four states only. An investor said "I don't
 * know honestly, the partners haven't decided"; Q offered to change it to
 * undecided, they said "Yes, please.", and with no option to hold that the
 * words "Yes, please." were kept as the deployment status. v3 adds one
 * option, `not_sure`. It is an answer (the step is settled), never a
 * deployment state: the write target leaves the organisation's deployment
 * state unknown (null), never paused or active.
 *
 * Nothing else changes: every v2 step key, branch and mapping is the same,
 * so an answer valid in v2 is valid in v3. v2 stays published and
 * immutable; sessions pinned to it keep running it.
 */
export const INVESTOR_DEFINITION_V3_VERSION = 3 as const;

/** The option a step offers for "not decided / do not know" (an answer, never a value). */
export const NOT_SURE_OPTION_KEY = "not_sure" as const;

/** v1's four deployment states, then "Not sure yet". */
export const DEPLOYMENT_STATUS_OPTIONS_V3 = [
  ...DEPLOYMENT_STATUS_OPTIONS,
  {
    optionKey: NOT_SURE_OPTION_KEY,
    label: "Not sure yet",
    description: "Not decided; change it any time.",
  },
] as const;

export const INVESTOR_DEFINITION_V3: OnboardingDefinitionManifest = {
  ...INVESTOR_DEFINITION_V2,
  version: INVESTOR_DEFINITION_V3_VERSION,
  steps: INVESTOR_DEFINITION_V2.steps.map((step) =>
    step.stepKey === INVESTOR_STEPS.deploymentStatus &&
    step.configuration.stepType === "single_select"
      ? {
          ...step,
          configuration: {
            ...step.configuration,
            options: [...DEPLOYMENT_STATUS_OPTIONS_V3],
          },
        }
      : step,
  ),
};
