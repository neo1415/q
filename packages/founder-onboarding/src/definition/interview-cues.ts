import type { InterviewCues } from "@capital-q/onboarding";

import { FOUNDER_STEPS } from "./founder-v1.js";

/**
 * Where a founder's figures live in a sentence (CQ-Q-VOICE-001 A §8):
 * "we're raising $1.5m" answers the raise amount; "a team of 12" the team
 * size. A figure with none of these words nearby is not assigned to any
 * step — Q's reading may still propose it, and the person confirms.
 */
export const FOUNDER_INTERVIEW_CUES: InterviewCues = {
  [FOUNDER_STEPS.targetAmount]: {
    kind: "FIGURE",
    cues: [
      "raising",
      "raise",
      "round",
      "looking for",
      "looking to raise",
      "seeking",
      "want to raise",
      "hoping to raise",
    ],
  },
  [FOUNDER_STEPS.teamSize]: {
    kind: "FIGURE",
    cues: [
      "people",
      "employees",
      "staff",
      "team of",
      "headcount",
      "person team",
    ],
  },
  [FOUNDER_STEPS.founderCount]: {
    kind: "FIGURE",
    cues: ["founders", "co-founders", "cofounders", "of us"],
  },
};
