import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V62_SCHEMA_VERSION,
  TurnReaderV62ResultSchema,
  type TurnReaderV55Variables,
  type TurnReaderV62Result,
} from "../schemas/turn-reader.js";
import { V49_TEAM_JOB } from "./turn-reader.v49.js";
import { TURN_READER_V61, V61_BOARD_ASK } from "./turn-reader.v61.js";

/**
 * v62 (analyst lane QO-07, owner QA as Zino, 2026-10-23): "Write me a
 * 12-month plan" was answered in the turn with "want me to?", because the
 * v49 TEAM JOB rule keeps one document off the job path. A plan is one
 * document but it is analysis work: it reaches the job path, which starts
 * it at once. And a "yes" to work Q offered (or "do that" after they
 * described it) hands that earlier work over: workFromEarlier. v61 is kept
 * whole; both rules sit after the TEAM JOB rule, read by meaning in any
 * language.
 */
export const V62_DEEP_WORK = `DEEP WORK: analysis or strategy work that ends in a document for them -- a plan of any kind (a 12-month plan, a growth plan, a fundraising or investment plan, a go-to-market or expansion plan), a market study or sizing, a competitive analysis, a strategy or a recommendation with its reasoning written up -- is a team job even when it is one document and even when no research is mentioned ("write me a 12-month plan", "put together a growth strategy for us", "I need a market study for Lagos", "fais-moi une étude de marché pour Lagos"): teamJob is true. Their own deck, one-pager or memo, a short summary, and a question you can answer in the conversation stay as before.
`;
export const V62_WORK_FROM_EARLIER = `WORK FROM EARLIER: workFromEarlier is true when this turn hands over work that was asked for or offered in the last few turns without restating it -- a yes to your own offer to prepare it ("yes", "go ahead", "please do", "oui, vas-y"), or "do that" after they described it; then teamJob is whatever that earlier work is. A yes to an offer to SEND something to someone is not deep work. Otherwise workFromEarlier is false.
`;

/**
 * Work-board lane (2026-10-24, #388 merged): their board is also a screen,
 * the Board tab under Work at /board. Opening it is NAVIGATE BOARD; asking
 * Q to keep or work on something there stays boardAsk.
 */
export const V62_BOARD_SCREEN = `- Their own work board as a screen to open ("open my board", "take me to my board", "show me my work board", "ouvre mon tableau") is tool NAVIGATE with destination BOARD; asking you to keep, break down or work on something there is boardAsk, not NAVIGATE.
`;

if (TURN_READER_V61.template.split(V61_BOARD_ASK).length !== 2) {
  throw new Error(
    "TURN_READER v62 extends v61's BOARD ASK rule, which changed",
  );
}

if (TURN_READER_V61.template.split(V49_TEAM_JOB).length !== 2) {
  throw new Error("TURN_READER v62 extends v49's TEAM JOB rule, which changed");
}

export const TURN_READER_V62: PromptDefinition<
  TurnReaderV55Variables,
  TurnReaderV62Result
> = {
  ...TURN_READER_V61,
  version: 62,
  status: "ACTIVE",
  changeDescription:
    "Analyst lane QO-07 2026-10-23: v61 plus DEEP WORK (analysis or strategy work ending in a document -- a plan of any kind, a market study, a competitive analysis, a written-up strategy -- is teamJob even as one document) and workFromEarlier (a yes or 'do that' handing over work asked for or offered in the last few turns; lenient); and their work board as a screen is NAVIGATE BOARD (work-board lane, /board). Read by meaning in any language.",
  effectiveFrom: "2026-10-24",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V62_SCHEMA_VERSION,
    schema: TurnReaderV62ResultSchema,
  },
  template: TURN_READER_V61.template
    .replace(
      V49_TEAM_JOB,
      `${V49_TEAM_JOB}${V62_DEEP_WORK}${V62_WORK_FROM_EARLIER}`,
    )
    .replace(V61_BOARD_ASK, `${V61_BOARD_ASK}${V62_BOARD_SCREEN}`),
};
