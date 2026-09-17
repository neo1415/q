import type { PromptDefinition } from "../definition.js";
import {
  INTERVIEW_CONDUCTOR_V3_UNTRUSTED,
  InterviewConductorV3VariablesSchema,
  type InterviewConductorResult,
  type InterviewConductorV3Variables,
} from "../schemas/interview-conductor.js";
import { INTERVIEW_CONDUCTOR_V2 } from "./interview-conductor.v2.js";

/**
 * INTERVIEW_CONDUCTOR v3 — v2 plus what Capital Q remembers (ADR 0012).
 *
 * The interview met the same person twice and did not know it: a name
 * they had corrected, a pronunciation they had taught, a preference they
 * had stated, all gone at the next session. One section carries them
 * in, rendered from their own recorded words and fenced as data.
 */
const ANCHOR = "RECENT TURNS\n{{recentTurns}}";

const MEMORY_SECTION = `WHAT CAPITAL Q REMEMBERS ABOUT THIS PERSON (from their own earlier words; honour it, do not recite it)
{{memory}}
`;

if (!INTERVIEW_CONDUCTOR_V2.template.includes(ANCHOR)) {
  throw new Error(
    "INTERVIEW_CONDUCTOR v3 derives from v2's template, and v2 no longer carries the section it extends",
  );
}

export const INTERVIEW_CONDUCTOR_V3: PromptDefinition<
  InterviewConductorV3Variables,
  InterviewConductorResult
> = {
  ...INTERVIEW_CONDUCTOR_V2,
  version: 3,
  status: "ACTIVE",
  changeDescription:
    "ADR 0012: what Capital Q remembers about the person (address, pronunciations, corrections, stated facts) is rendered into the interview as untrusted memory.",
  effectiveFrom: "2026-09-17",
  variables: {
    schema: InterviewConductorV3VariablesSchema,
    untrusted: [...INTERVIEW_CONDUCTOR_V3_UNTRUSTED],
  },
  template: INTERVIEW_CONDUCTOR_V2.template.replace(
    ANCHOR,
    `${MEMORY_SECTION}${ANCHOR}`,
  ),
};
