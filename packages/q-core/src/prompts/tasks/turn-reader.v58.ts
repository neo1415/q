import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V58_SCHEMA_VERSION,
  TurnReaderV58ResultSchema,
  type TurnReaderV55Variables,
  type TurnReaderV58Result,
} from "../schemas/turn-reader.js";
import { V46_DISCOVER } from "./turn-reader.v46.js";
import { V49_TEAM_JOB } from "./turn-reader.v49.js";
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
export const V58_SUITS_THEM = ` Asking which companies they should look at, look into, invest in, consider or meet, or for recommendations or suggestions of companies, is asking what suits them: ranking FIT and mandateRelevant true, whatever the words.`;
export const V36_FIT_ONLY_PREVIOUS = `for FIT only previous, true when they mean the companies Q just showed, as in "which has the strongest fit" right after a list; otherwise null)`;
export const V58_FIT_MANDATE = `for FIT only previous, true when they mean the companies Q just showed, as in "which has the strongest fit" right after a list, and mandateRelevant, true when they ask to rank or score against their mandate or for themselves ("rank them for me", "top three based on my mandate"); otherwise null)`;

/**
 * Lane 5 (shared bump, owner 2026-10-23, live founder.maji-loop): "help me
 * prepare for a first call with Savanna Seed Partners" became a team job
 * and Q answered with a question about a plan. Being made ready for a call
 * or meeting with one named counterpart is meetingPrep, which Q prepares
 * in the answer; handing the team a job of several steps stays teamJob.
 */
export const V58_MEETING_PREP = `MEETING PREP: meetingPrep is {"counterpart": the name as they said it} when they want you to get them ready for a call, meeting or pitch with one named investor, firm, company or person -- what to expect, what they will ask, how to come across -- in any words and any language ("help me prepare for my first call with Savanna Seed Partners", "brief me before I meet Kestrel", "what should I expect from the Acme call?", "prépare-moi pour mon appel avec Savanna"). Then teamJob is false: you prepare it now, in your answer. It stays teamJob (and meetingPrep is null) only when they hand the work to your team or ask for several steps of work besides ("get your team to research them, write a memo and prepare me"). Otherwise meetingPrep is null.
`;

/**
 * Founder investor matching (shared bump, owner 2026-10-23, live
 * founder.maji-loop): "Which investors should I talk to first, and why?"
 * was read as ADVICE about their own company and answered from the
 * company record alone ("no fit evidence is available"). Which investors a
 * company should approach is its own question kind, read by meaning; code
 * answers it from the investors already interested and the likely fits
 * from what investors publish, never from an investor's private mandate.
 */
export const V58_INVESTOR_PROSPECTS = `- INVESTOR_PROSPECTS: they ask, for their own company or raise, which investors to approach, contact, pitch or talk to first, or which investors fit them, suit them or are most likely to back them, by what it means, in any words and any language ("which investors should I talk to first, and why?", "who should I pitch?", "investors that fit us", "who's most likely to fund this round?", "¿a qué inversores debería contactar?"). Q answers it from the investors on Capital Q and those already in touch with them. Over ADVICE, FIT and DISCOVER_COMPANIES whenever what they ask for is investors for their own company. count: how many investors they asked for; null when they named no number. It is not this kind when they ask about one named investor, or only for investors of a region, nationality or kind ("top three Gulf investors").
`;

for (const rule of [
  V46_DISCOVER,
  V49_TEAM_JOB,
  V1_ABOUT_NAMED_OTHER,
  V36_MANDATE_RELEVANT,
  V36_FIT_ONLY_PREVIOUS,
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
    "Production 2026-10-23 ('Yes' searched and pictured as a company): v57 plus namedOther {name, kind} -- the company, organisation or person the turn is about, named by the reader from meaning and the recent turns (a yes to an offer about them, 'their team'), null when no one in particular; code searches and pictures only that, never a name guessed from capital letters or word lists. Shared with Lane 4: asking which companies to look into, invest in, consider or meet (or for recommendations) is DISCOVER ranking FIT with mandateRelevant true, and a FIT ranking against their mandate or for themselves carries mandateRelevant true -- by meaning, no phrase lists. Shared with Lane 5: being made ready for a call or meeting with one named counterpart is meetingPrep {counterpart} (prepared in the answer, never a team job); handing the team a several-step job stays teamJob. Founder investor matching: which investors a company should approach, talk to first or that fit it is the INVESTOR_PROSPECTS question kind (over ADVICE, FIT and DISCOVER_COMPANIES), answered by code from the investors already interested and network-visible profiles, never an investor's private mandate.",
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
    .replace(V49_TEAM_JOB, `${V49_TEAM_JOB}${V58_MEETING_PREP}`)
    .replace(V46_DISCOVER, `${V46_DISCOVER}${V58_INVESTOR_PROSPECTS}`),
};
