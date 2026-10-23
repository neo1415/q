import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V61_SCHEMA_VERSION,
  TurnReaderV61ResultSchema,
  type TurnReaderV55Variables,
  type TurnReaderV61Result,
} from "../schemas/turn-reader.js";
import { V49_TEAM_JOB } from "./turn-reader.v49.js";
import { TURN_READER_V60 } from "./turn-reader.v60.js";

/**
 * v61 (owner QA 2026-10-23, QO-07): investor Zino said "Write me a
 * 12-month plan" and Q answered with a paragraph and "want me to?"; the
 * document came only after "yes", 85 s later, generic. v49's TEAM JOB rule
 * says one document on its own is not a team job, so a plan -- one
 * document, but real analysis work -- was answered in the turn. Now, by
 * meaning in any language: analysis or strategy work that ends in a
 * document for them (a plan, a market study, a strategy, a competitive
 * analysis) is teamJob, so it starts at once; and a yes to work Q offered
 * or they asked for just before is that same work (workFromEarlier), whose
 * words code carries. v60 is kept whole.
 */
export const V61_DEEP_WORK = `DEEP WORK: analysis or strategy work that ends in a document for them -- a plan of any kind (a 12-month plan, a growth plan, a fundraising or investment plan, a go-to-market or expansion plan), a market study or sizing, a competitive analysis, a strategy or a recommendation with its reasoning written up -- is a team job even when it is one document and even when no research is mentioned ("write me a 12-month plan", "put together a growth strategy for us", "I need a market study for Lagos"): teamJob is true. Their own deck, one-pager or memo, a short summary, and a question you can answer in the conversation stay as before.
WORK FROM EARLIER: workFromEarlier is true when this turn hands over work that was asked for or offered in the last few turns without restating it -- a yes to your own offer to prepare it ("yes", "go ahead", "please do", "oui, vas-y"), or "do that" after they described it; then teamJob is whatever that earlier work is. Otherwise workFromEarlier is false.
`;

if (TURN_READER_V60.template.split(V49_TEAM_JOB).length !== 2) {
  throw new Error("TURN_READER v61 extends v49's TEAM JOB rule, which changed");
}

export const TURN_READER_V61: PromptDefinition<
  TurnReaderV55Variables,
  TurnReaderV61Result
> = {
  ...TURN_READER_V60,
  version: 61,
  status: "ACTIVE",
  changeDescription:
    "Owner QA 2026-10-23 (QO-07): v60 plus DEEP WORK -- analysis or strategy work ending in a document for them (a plan, a market study, a strategy, a competitive analysis) is teamJob even as one document, so it starts at once -- and workFromEarlier, true when the turn hands over work asked for or offered just before ('yes, go ahead'); code carries those earlier words of theirs as the job's goal. By meaning, any language.",
  effectiveFrom: "2026-10-23",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V61_SCHEMA_VERSION,
    schema: TurnReaderV61ResultSchema,
  },
  template: TURN_READER_V60.template.replace(
    V49_TEAM_JOB,
    `${V49_TEAM_JOB}${V61_DEEP_WORK}`,
  ),
};
