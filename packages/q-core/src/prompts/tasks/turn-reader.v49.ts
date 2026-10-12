import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V49_SCHEMA_VERSION,
  TurnReaderV49ResultSchema,
  type TurnReaderV7Variables,
  type TurnReaderV49Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V48 } from "./turn-reader.v48.js";

/**
 * TURN_READER v49 -- A JOB FOR Q'S TEAM (lead review 2026-10-12).
 *
 * Live 2026-10-12: a goal of research, a memo, a critique, a revision and
 * founder questions was answered as one brief. A keyword count caught that
 * sentence but not "get your team to investigate Ledgerfold and prepare me
 * for a meeting". The reader now says from meaning when the person hands
 * Q's team a piece of work of several steps; code has the lead Q plan it
 * as one card. It is the same reading, so no model call is added.
 */
export const V48_SAVE_ANCHOR = "SAVE TO OWN PROFILE: ";

export const V49_TEAM_JOB = `TEAM JOB: teamJob is true when they ask you, or your team, to carry out a piece of work for them that takes several steps or more than one specialist and ends in something prepared for them: investigate or research someone and report back, get them ready for a meeting or call, build an investment case, write a memo and have it reviewed, do diligence on a company and draft what to ask, compare and recommend, in any words and any language ("get your team to look into Ledgerfold and prepare me for the meeting", "do the diligence on them and tell me what to ask", "work Kestrel up for me before Thursday", "put the team on this"). It is false for a question you can answer now, however detailed; for one document or one direct request on its own; for taking over a relationship (that is handOver); and for a question about work already running. When teamJob is true, handOver is null.
`;

if (TURN_READER_V48.template.split(V48_SAVE_ANCHOR).length !== 2) {
  throw new Error(
    "TURN_READER v49 inserts before v48's SAVE TO OWN PROFILE rule, which changed",
  );
}

export const TURN_READER_V49: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV49Result
> = {
  ...TURN_READER_V48,
  version: 49,
  status: "ACTIVE",
  changeDescription:
    "Lead review 2026-10-12: teamJob, read from meaning, when the person hands Q's team a piece of work of several steps; code has the lead plan it for approval instead of one in-run answer.",
  effectiveFrom: "2026-10-12",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V49_SCHEMA_VERSION,
    schema: TurnReaderV49ResultSchema,
  },
  template: TURN_READER_V48.template.replace(
    V48_SAVE_ANCHOR,
    `${V49_TEAM_JOB}${V48_SAVE_ANCHOR}`,
  ),
};
