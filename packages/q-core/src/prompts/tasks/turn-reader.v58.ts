import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V58_SCHEMA_VERSION,
  TurnReaderV58ResultSchema,
  type TurnReaderV55Variables,
  type TurnReaderV58Result,
} from "../schemas/turn-reader.js";
import { V46_DISCOVER } from "./turn-reader.v46.js";
import { TURN_READER_V57 } from "./turn-reader.v57.js";

/**
 * v58 (owner, 2026-10-23): a founder's "Which investors should I talk to
 * first, and why?" was read as ADVICE about their own company, answered
 * from the company record alone, and Q said no fit evidence was available.
 * Which investors a company should approach is its own question kind,
 * INVESTOR_PROSPECTS, read by meaning in any words and language; code then
 * answers it from the investors' network-visible profiles and the
 * investors already in touch with them. v57 is kept whole; the question
 * kinds gain this one, beside DISCOVER_COMPANIES; its output schema is v56's
 * with that kind added (TurnReaderV58ResultSchema).
 */
export const V58_INVESTOR_PROSPECTS = `- INVESTOR_PROSPECTS: they ask, for their own company or raise, which investors to approach, contact, pitch or talk to first, or which investors fit them, suit them or are most likely to back them, by what it means, in any words and any language ("which investors should I talk to first, and why?", "who should I pitch?", "investors that fit us", "who's most likely to fund this round?", "¿a qué inversores debería contactar?"). Q answers it from the investors on Capital Q and those already in touch with them. Over ADVICE, FIT and DISCOVER_COMPANIES whenever what they ask for is investors for their own company. count: how many investors they asked for; null when they named no number. It is not this kind when they ask about one named investor, or only for investors of a region, nationality or kind ("top three Gulf investors").
`;

if (TURN_READER_V57.template.split(V46_DISCOVER).length !== 2) {
  throw new Error(
    "TURN_READER v58 extends v46's DISCOVER_COMPANIES rule, which changed",
  );
}

export const TURN_READER_V58: PromptDefinition<
  TurnReaderV55Variables,
  TurnReaderV58Result
> = {
  ...TURN_READER_V57,
  version: 58,
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V58_SCHEMA_VERSION,
    schema: TurnReaderV58ResultSchema,
  },
  status: "ACTIVE",
  changeDescription:
    "Founder investor matching (owner 2026-10-23): v57 plus the INVESTOR_PROSPECTS question kind -- which investors a company should approach or which fit it, read by meaning in any language, over ADVICE, FIT and DISCOVER_COMPANIES; answered by code from network-visible investor profiles and the investors already in touch. Output: v56's schema with that kind.",
  effectiveFrom: "2026-10-23",
  template: TURN_READER_V57.template.replace(
    V46_DISCOVER,
    `${V46_DISCOVER}${V58_INVESTOR_PROSPECTS}`,
  ),
};
