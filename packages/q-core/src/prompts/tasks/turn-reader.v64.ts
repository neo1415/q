import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V64_SCHEMA_VERSION,
  TurnReaderV64ResultSchema,
  type TurnReaderV55Variables,
  type TurnReaderV64Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V63 } from "./turn-reader.v63.js";

/**
 * v64 (QA F-98, live 2026-10-24): "Let us rehearse my call with Savanna
 * Seed Partners" (a founder) was read as meetingPrep and answered with the
 * prep brief again instead of opening the rehearsal. REFERENCE open gains
 * REHEARSAL, by meaning in any language, and the MEETING PREP rule says
 * rehearsing is not preparing. Folded in by the reader owner: "my
 * pipeline" by meaning (below). The live v63 is kept whole.
 */
export const V40_LAST_OPEN_KIND = "or PITCH, a company's pitch video.";
export const V64_REHEARSAL_OPEN = `or PITCH, a company's pitch video; or REHEARSAL, when they ask to rehearse, practise or role-play a meeting, call or pitch with that investor, company or person, played by Q, by what it means in any words and any language ("let us rehearse my call with Savanna Seed Partners", "practise the Kestrel meeting with me", "can we role-play my pitch to Acme?", "on répète mon appel avec Savanna ?"); name is whom they would meet.`;

export const V58_MEETING_PREP_THEN =
  "Then teamJob is false: you prepare it now, in your answer.";
export const V64_REHEARSE_IS_NOT_PREP = `${V58_MEETING_PREP_THEN} Rehearsing, practising or role-playing that call or meeting with them is not meetingPrep: it is REFERENCE open REHEARSAL with their name, and meetingPrep is null.`;

/**
 * Coordinator 2026-10-24 (docs/ai-handoff/TURN-READER-V64-NOTES.md): an
 * investor's "Show my pipeline" was answered with their capital
 * commitments. "My pipeline" is the relationships pipeline for everyone,
 * decided by meaning: to see it is NAVIGATE CRM_PIPELINE, a question about
 * it is about the pipeline -- never capital, compare or fit. The code hint
 * ("show my X" as a page request) stays only the fast path.
 */
export const V62_FOUNDER_PIPELINE =
  'A founder\'s "pipeline" or "fundraising pipeline" is their investor relationships pipeline, never the Capital page.';
export const V64_MY_PIPELINE = `Anyone's "my pipeline" (a founder's or an investor's) is their relationships by stage, the CRM pipeline, never the Capital page and never only their capital or commitments: to see it ("show my pipeline", "open my pipeline", "my pipeline") is tool NAVIGATE with destination CRM_PIPELINE; a question about it ("what does my pipeline look like this month?", "show my pipeline by stage", "how many are in diligence?") is a question about the pipeline, not NAVIGATE, never compare and never fit. Capital is what they say capital, commitments or what they committed means ("what have I committed?" is about capital). Comparing companies in it is compare.`;

for (const rule of [
  V40_LAST_OPEN_KIND,
  V58_MEETING_PREP_THEN,
  V62_FOUNDER_PIPELINE,
]) {
  if (TURN_READER_V63.template.split(rule).length !== 2) {
    throw new Error(`TURN_READER v64 extends a rule that changed: ${rule}`);
  }
}

export const TURN_READER_V64: PromptDefinition<
  TurnReaderV55Variables,
  TurnReaderV64Result
> = {
  ...TURN_READER_V63,
  version: 64,
  status: "ACTIVE",
  changeDescription:
    "QA F-98 (live 2026-10-24): v63 plus REFERENCE open REHEARSAL -- they ask to rehearse, practise or role-play a meeting, call or pitch with one named investor, company or person, by meaning in any language -- and the MEETING PREP rule says rehearsing is not preparing (meetingPrep null). Code opens the rehearsal through open_page. Also: anyone's 'my pipeline' is the CRM relationships pipeline by meaning -- to see it is NAVIGATE CRM_PIPELINE, a question about it is about the pipeline, never capital, compare or fit (coordinator 2026-10-24).",
  effectiveFrom: "2026-10-24",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V64_SCHEMA_VERSION,
    schema: TurnReaderV64ResultSchema,
  },
  template: TURN_READER_V63.template
    .replace(V40_LAST_OPEN_KIND, V64_REHEARSAL_OPEN)
    .replace(V58_MEETING_PREP_THEN, V64_REHEARSE_IS_NOT_PREP)
    .replace(
      V62_FOUNDER_PIPELINE,
      `${V62_FOUNDER_PIPELINE} ${V64_MY_PIPELINE}`,
    ),
};
