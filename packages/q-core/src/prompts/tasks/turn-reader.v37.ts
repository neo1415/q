import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV7Variables,
  TurnReaderV31Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V36 } from "./turn-reader.v36.js";

/**
 * TURN_READER v37 -- v36 plus one rule (QA run 3af14042, lead 2026-10-03):
 * "Make Ajopot seed deck private to my organisation again" was read as
 * SET_VISIBILITY and prepared "Make your company private". Who may
 * download one of their own decks or documents is set_deck_audience, and
 * who may play their pitch video is set_pitch_sharing, never the company's
 * visibility. Code routes it too (answer.ts recordAudience). Same schema
 * and order as v36; the new words sit in the static prefix.
 */
const V36_FUND_NEVER =
  '("make our fund visible to founders" is set_investor_visibility).';
const V37_FUND_NEVER = `${V36_FUND_NEVER} A deck, document or upload of theirs, named or pointed to, is never SET_VISIBILITY: who may download it is set_deck_audience ("make Ajopot seed deck private to my organisation again" is set_deck_audience with {"deck": "Ajopot seed deck", "audience": "ORGANISATION"}), and who may play their pitch video is set_pitch_sharing.`;

if (TURN_READER_V36.template.split(V36_FUND_NEVER).length !== 2) {
  throw new Error(
    `TURN_READER v37 edits v36 once, which lost: ${V36_FUND_NEVER}`,
  );
}

export const TURN_READER_V37: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV31Result
> = {
  ...TURN_READER_V36,
  version: 37,
  status: "DEPRECATED",
  changeDescription:
    "QA run 3af14042 (v36): a deck, document or upload's audience is set_deck_audience and a pitch video's is set_pitch_sharing, never SET_VISIBILITY. Same schema and order as v36.",
  effectiveFrom: "2026-10-03",
  template: TURN_READER_V36.template.replace(V36_FUND_NEVER, V37_FUND_NEVER),
};
