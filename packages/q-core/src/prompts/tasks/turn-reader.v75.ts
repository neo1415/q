import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V75_SCHEMA_VERSION,
  TurnReaderV75ResultSchema,
  type TurnReaderV55Variables,
  type TurnReaderV75Result,
} from "../schemas/turn-reader.js";
import { V62_DEEP_WORK } from "./turn-reader.v62.js";
import { TURN_READER_V74 } from "./turn-reader.v74.js";

/**
 * v75 (owner decision 2026-10-31): "Write me an IC memo on Portside" went
 * to the direct answer and came back in ~37 s as a quick profile-only
 * Q_REPORT, because v49 keeps one document off the team job and v62 keeps
 * a memo a document. An investment memo on a company always includes web
 * research -- the researched memo job with Sources, competitors and
 * evidence, the same one an explicit research ask starts. investmentMemo
 * names it by meaning; code routes it to that job. A founder's own deck,
 * one-pager or memo (v62's intent), a short summary of a company and any
 * other document stay on their path. v74 is kept whole; the rule sits
 * after v62's DEEP WORK rule.
 */
export const V75_INVESTMENT_MEMO = `INVESTMENT MEMO: investmentMemo is true when the document they ask for is an investment memo on a company other than their own -- an IC memo, an investment committee memo, a deal memo, or an investment recommendation on whether to invest in that company, written up -- in any words and any language ("write me an IC memo on Portside", "draft an investment committee memo for Kestrel", "I need a deal memo on them", "prépare-moi un mémo d'investissement sur Portside"). Such a memo is always researched work for your team: teamJob is true with it, even though it is one document and even when no research is mentioned. investmentMemo is false for their own company's deck, one-pager or memo, for a short summary, profile, overview or brief of a company ("give me a quick summary of Portside"), for any other document, and for a question about a memo.
`;

if (TURN_READER_V74.template.split(V62_DEEP_WORK).length !== 2) {
  throw new Error(
    "TURN_READER v75 extends v62's DEEP WORK rule, which changed",
  );
}

export const TURN_READER_V75: PromptDefinition<
  TurnReaderV55Variables,
  TurnReaderV75Result
> = {
  ...TURN_READER_V74,
  version: 75,
  status: "ACTIVE",
  changeDescription:
    "Owner decision 2026-10-31 (IC memo on Portside answered as a quick profile-only report): v74 plus INVESTMENT MEMO -- investmentMemo when the document asked for is an investment, IC or deal memo on a company other than their own, by meaning in any language, with teamJob true, so code starts the researched memo job. Their own deck, one-pager or memo, a short summary or brief, and other documents stay as before. Output schema v75 (v74 plus investmentMemo, lenient).",
  effectiveFrom: "2026-10-31",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V75_SCHEMA_VERSION,
    schema: TurnReaderV75ResultSchema,
    onlyWhatApplies: true,
  },
  template: TURN_READER_V74.template.replace(
    V62_DEEP_WORK,
    `${V62_DEEP_WORK}${V75_INVESTMENT_MEMO}`,
  ),
};
