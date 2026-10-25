import type { InterviewCues } from "@capital-q/onboarding";

import { INVESTOR_STEPS } from "./investor-v1.js";

/**
 * Where an investor's figures and exclusions live in a sentence
 * (CQ-Q-VOICE-001 A §12): "$250k to $1m" is the cheque range; "typically
 * $500k" the typical cheque; a red flag mentioned in any way ("we never
 * invest in gambling", "hardware isn't our thing") is a question with two
 * real answers — never show, or rank lower — because the only route to a
 * hard exclusion is the investor's own answer.
 */
export const INVESTOR_INTERVIEW_CUES: InterviewCues = {
  [INVESTOR_STEPS.chequeMin]: {
    kind: "FIGURE_RANGE",
    highStepKey: INVESTOR_STEPS.chequeMax,
  },
  [INVESTOR_STEPS.chequeTypical]: {
    kind: "FIGURE",
    cues: [
      "typically",
      "typical",
      "usually",
      "sweet spot",
      "on average",
      "average cheque",
    ],
  },
  [INVESTOR_STEPS.hardExclusions]: {
    kind: "EXCLUSION",
    softStepKey: INVESTOR_STEPS.avoid,
  },
};

/**
 * The mandate's exclusion steps by what they mean (owner 2026-10-25): a
 * hard step hides what it names, and only a declared absolute ("we never
 * invest in X", in any wording) belongs there; the soft step ranks lower
 * and holds a preference. Which one their words meant is read by meaning,
 * never matched by words; when the reading and a write disagree, Q asks.
 */
export const INVESTOR_HARD_EXCLUSION_STEPS: readonly string[] = [
  INVESTOR_STEPS.hardExclusions,
  INVESTOR_STEPS.sectorExclusions,
];
export const INVESTOR_SOFT_EXCLUSION_STEPS: readonly string[] = [
  INVESTOR_STEPS.avoid,
];
