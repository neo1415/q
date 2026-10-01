import type { PromptDefinition } from "../definition.js";
import {
  RehearsalTurnV5VariablesSchema,
  type RehearsalTurnV4Result,
  type RehearsalTurnV5Variables,
} from "../schemas/rehearsal.js";
import { INVESTOR_TWIN_TURN_V4 } from "./investor-twin-turn.v4.js";

const V4 = INVESTOR_TWIN_TURN_V4.template;

const FOUNDER_V4 =
  "- As a FOUNDER: pitch and answer like them, from the persona and their pitch material; answer the investor's questions (ANSWER), defend under pressure, ask the investor your own questions about the fund, process and terms.";
const FOUNDER_V5 =
  "- As a FOUNDER: you came to win this investor's money. Pitch and answer like them, from the persona and their pitch material; answer the investor's questions (ANSWER), persuade, defend under pressure with respect. Your own questions about the fund, process and terms are fair and come later, once you have answered theirs -- never as if they must justify their interest to you, unless WHO HOLDS THE LEVERAGE says this person is forward.";

const CLOSE_V4 =
  "- Keep going until the meeting reaches a natural end, then CLOSE";
const CLOSE_V5 = `- WHO HOLDS THE LEVERAGE (composed by code): {{stance}}
- When you CLOSE angry, cold or upset, the line is your goodbye in that emotion -- a sentence or two said the way you feel (curt, cold, or raised), then you leave. Never a neutral sign-off after a heated meeting.
${CLOSE_V4}`;

/**
 * INVESTOR_TWIN_TURN v5 -- v4, plus who holds the leverage (code-composed
 * from the roles and the persona's forwardness) and an in-character goodbye
 * when the meeting ends in anger (founder live test 2026-10-01, rehearsal
 * bc85199e: the played founder asked the investor "why are you
 * interested?" as if it held the leverage).
 */
export const INVESTOR_TWIN_TURN_V5: PromptDefinition<
  RehearsalTurnV5Variables,
  RehearsalTurnV4Result
> = {
  ...INVESTOR_TWIN_TURN_V4,
  version: 5,
  status: "DEPRECATED",
  changeDescription:
    "Founder live test 2026-10-01: a code-composed stance says who holds the leverage (a founder pitching is the weaker party unless known to be forward); an angry or cold close is a goodbye in that emotion.",
  effectiveFrom: "2026-10-01",
  variables: {
    ...INVESTOR_TWIN_TURN_V4.variables,
    schema: RehearsalTurnV5VariablesSchema,
  },
  template: V4.replace(FOUNDER_V4, FOUNDER_V5).replace(CLOSE_V4, CLOSE_V5),
};
