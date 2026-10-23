import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V58_SCHEMA_VERSION,
  TurnReaderV58ResultSchema,
  type TurnReaderV55Variables,
  type TurnReaderV58Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V57 } from "./turn-reader.v57.js";

/**
 * v58 (production 2026-10-23): "Yes", said to Q's "Want to dig into its fit
 * details?", was searched and pictured as a company called "Yes" -- the
 * reading said the turn was about someone named, and code guessed who from
 * capital letters. The reader now names the subject itself, by meaning and
 * from the conversation, and code searches and pictures only that. v57 is
 * kept whole; the ABOUT NAMED OTHER rule gains this one.
 */
export const V1_ABOUT_NAMED_OTHER = `ABOUT NAMED OTHER: true when the turn is about a specific company, organisation or person other than the speaker that the words name ("tell me about Acme", "what do you make of Northwind?"); false otherwise, including when they talk about themselves or their own company.
`;

export const V58_NAMED_OTHER = `NAMED OTHER: when aboutNamedOther is true, namedOther is that company, organisation or person: name as it should be searched, spelled properly and in full however it was written or heard ("zino aviation" is "Zino Aviation"), and kind COMPANY for a company or organisation, PERSON for a person. Understand who the turn means from what it says and from the recent turns: a turn that points back ("their team", "what about him?", or a yes to Q's offer about them) means the one it points to. namedOther is null when aboutNamedOther is false, when they mean no one in particular, or when you cannot tell who. It is only ever the name of whom the turn is about: never a word of a reply, an agreement, a greeting or a sound, never their own company, never Capital Q.
`;

/**
 * Lane 4 (shared bump, 2026-10-23): an investor asking which companies to
 * look into, invest in or meet is asking what suits them -- read by meaning,
 * so routing needs no phrase list -- and a FIT ranking against their
 * mandate says so.
 */
export const V36_MANDATE_RELEVANT = `mandateRelevant: true when they tie it to their mandate or to themselves.`;
/**
 * Lane 4 (coordinator's investor journey, 2026-10-23): for an investor a
 * list is ranked by fit unless they ask for name order, which the reader
 * now says (ranking NAME); and "raising a seed round" is read as a wish
 * for companies raising now (raising), never as a word to match.
 */
export const V46_RANKING_OTHERWISE = `TOP when they say top or best without saying on what; NONE otherwise.`;
export const V58_RANKING_NAME = `TOP when they say top or best without saying on what; NAME only when they ask for the list alphabetically or by name; NONE otherwise.`;
export const V46_PREVIOUS_SHOWN = `previous: true when they mean companies Q just showed.`;
export const V58_RAISING = `previous: true when they mean companies Q just showed. raising: true when they ask for companies raising now or with an open round, in any words and any language ("raising a seed round", "currently fundraising"); false otherwise.`;
export const V58_SUITS_THEM = ` Asking which companies they should look at, look into, invest in, consider or meet, or for recommendations or suggestions of companies, is asking what suits them: ranking FIT and mandateRelevant true, whatever the words.`;
export const V36_FIT_ONLY_PREVIOUS = `for FIT only previous, true when they mean the companies Q just showed, as in "which has the strongest fit" right after a list; otherwise null)`;
export const V58_FIT_MANDATE = `for FIT only previous, true when they mean the companies Q just showed, as in "which has the strongest fit" right after a list, and mandateRelevant, true when they ask to rank or score against their mandate or for themselves ("rank them for me", "top three based on my mandate"); otherwise null)`;

for (const rule of [
  V1_ABOUT_NAMED_OTHER,
  V36_MANDATE_RELEVANT,
  V36_FIT_ONLY_PREVIOUS,
  V46_RANKING_OTHERWISE,
  V46_PREVIOUS_SHOWN,
]) {
  if (TURN_READER_V57.template.split(rule).length !== 2) {
    throw new Error(`TURN_READER v58 extends a rule that changed: ${rule}`);
  }
}

export const TURN_READER_V58: PromptDefinition<
  TurnReaderV55Variables,
  TurnReaderV58Result
> = {
  ...TURN_READER_V57,
  version: 58,
  status: "ACTIVE",
  changeDescription:
    "Production 2026-10-23 ('Yes' searched and pictured as a company): v57 plus namedOther {name, kind} -- the company, organisation or person the turn is about, named by the reader from meaning and the recent turns (a yes to an offer about them, 'their team'), null when no one in particular; code searches and pictures only that, never a name guessed from capital letters or word lists. Shared with Lane 4: asking which companies to look into, invest in, consider or meet (or for recommendations) is DISCOVER ranking FIT with mandateRelevant true, and a FIT ranking against their mandate or for themselves carries mandateRelevant true -- by meaning, no phrase lists. Also Lane 4: ranking NAME when they ask for name order (an investor's other lists are ranked by fit), and raising when they ask for companies raising now.",
  effectiveFrom: "2026-10-23",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V58_SCHEMA_VERSION,
    schema: TurnReaderV58ResultSchema,
  },
  template: TURN_READER_V57.template
    .replace(V1_ABOUT_NAMED_OTHER, `${V1_ABOUT_NAMED_OTHER}${V58_NAMED_OTHER}`)
    .replace(V36_MANDATE_RELEVANT, `${V36_MANDATE_RELEVANT}${V58_SUITS_THEM}`)
    .replace(V36_FIT_ONLY_PREVIOUS, V58_FIT_MANDATE)
    .replace(V46_RANKING_OTHERWISE, V58_RANKING_NAME)
    .replace(V46_PREVIOUS_SHOWN, V58_RAISING),
};
