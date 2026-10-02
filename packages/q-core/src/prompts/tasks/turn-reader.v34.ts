import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV7Variables,
  TurnReaderV31Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V33 } from "./turn-reader.v33.js";

/**
 * TURN_READER v34 -- v33 with SET_VISIBILITY narrowed to a company (QA
 * parity eval 2026-10-02, run 1ec08a4b: "make our fund visible to founders
 * on Capital Q" was read as SET_VISIBILITY, the company's hand, and the
 * investor was told Q changes who sees a company). A fund's or investor
 * organisation's visibility is the listed app action. Same schema and order
 * as v33; the two edited lines sit in the static prefix.
 */
const V33_SET_VISIBILITY =
  "- SET_VISIBILITY: they want their company seen by investors on Capital Q (network_visible), or no longer seen, private to their own organisation (organisation_private).";
const V34_SET_VISIBILITY =
  "- SET_VISIBILITY: they want their company (a startup, never a fund or investor organisation) seen by investors on Capital Q (network_visible), or no longer seen, private to their own organisation (organisation_private).";
const V33_APP_ACTION_KINDS =
  "(save, unsave, pass or unpass a company; who may play their pitch video)";
const V34_APP_ACTION_KINDS =
  "(save, unsave, pass or unpass a company; who may play their pitch video; who may see their fund or investor organisation)";
const V33_NEVER = '("let investors play my pitch video" is set_pitch_sharing).';
const V34_NEVER =
  '("let investors play my pitch video" is set_pitch_sharing). A fund\'s or investor organisation\'s own visibility is its listed action, never SET_VISIBILITY ("make our fund visible to founders" is set_investor_visibility).';

for (const anchor of [V33_SET_VISIBILITY, V33_APP_ACTION_KINDS, V33_NEVER]) {
  if (TURN_READER_V33.template.split(anchor).length !== 2) {
    throw new Error(`TURN_READER v34 edits v33 once, which lost: ${anchor}`);
  }
}

export const TURN_READER_V34: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV31Result
> = {
  ...TURN_READER_V33,
  version: 34,
  status: "DEPRECATED",
  changeDescription:
    "QA 2026-10-02 (parity run 1ec08a4b): SET_VISIBILITY is a company's only; a fund's or investor organisation's visibility is its app action (set_investor_visibility). Same schema and order as v33.",
  effectiveFrom: "2026-10-02",
  template: TURN_READER_V33.template
    .replace(V33_SET_VISIBILITY, V34_SET_VISIBILITY)
    .replace(V33_APP_ACTION_KINDS, V34_APP_ACTION_KINDS)
    .replace(V33_NEVER, V34_NEVER),
};
