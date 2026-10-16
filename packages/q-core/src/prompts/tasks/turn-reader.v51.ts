import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV7Variables,
  TurnReaderV49Result,
} from "../schemas/turn-reader.js";
import { V49_TEAM_JOB } from "./turn-reader.v49.js";
import { TURN_READER_V50 } from "./turn-reader.v50.js";

/**
 * TURN_READER v51 -- A DECISION WITH WORK ATTACHED (wf, live 2026-10-16).
 *
 * "We're going into diligence on Harbourline Cargo next week. Get the team
 * ready." was read as a relationship decision alone: Q offered to record
 * the outcome and the request for preparation was lost. When a turn both
 * states a decision about a relationship and asks for work of several
 * steps, it is a team job; the lead's plan carries the decision as the
 * person's next action, so nothing is recorded instead of the work. Read
 * from meaning, in any words; a decision stated on its own is unchanged.
 */
export const V51_DECISION_WITH_WORK =
  "A turn that states a decision about one of their relationships (moving it into diligence, passing, pausing, investing) and also asks for that kind of work to be prepared or carried out is a team job: teamJob is true. The decision belongs to the work; recording it is offered inside the team's plan, never instead of the work. A decision stated on its own, with no work asked for, is not a team job.\n";

if (TURN_READER_V50.template.split(V49_TEAM_JOB).length !== 2) {
  throw new Error("TURN_READER v51 extends v49's TEAM JOB rule, which changed");
}

export const TURN_READER_V51: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV49Result
> = {
  ...TURN_READER_V50,
  version: 51,
  status: "ACTIVE",
  changeDescription:
    "A turn that states a relationship decision and asks for work of several steps is a team job; the plan offers the decision as a next action instead of recording it in place of the work.",
  effectiveFrom: "2026-10-16",
  template: TURN_READER_V50.template.replace(
    V49_TEAM_JOB,
    `${V49_TEAM_JOB}${V51_DECISION_WITH_WORK}`,
  ),
};
