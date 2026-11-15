import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V76_UNTRUSTED,
  TURN_READER_V89_SCHEMA_VERSION,
  TurnReaderV76VariablesSchema,
  TurnReaderV89ResultSchema,
  type TurnReaderV76Variables,
  type TurnReaderV89Result,
} from "../schemas/turn-reader.js";
import {
  TURN_READER_V88,
  V88_FIT_EXCLUDE_RELATIONSHIPS,
} from "./turn-reader.v88.js";

/**
 * v89 (audit 2026-11-15, RC2). Ranked lists answered by code dropped the
 * condition the person stated: an investor's "only ones with actual
 * revenue", "pre-revenue", "outside my preferred sectors"; a founder's
 * "which would be poor fits" and "leave out the investors I'm already
 * talking to" each got the plain top of the ranking. The one reading now
 * says, by meaning and in any language, which conditions they put on the
 * list (`question.listConditions`). Which items meet them stays code's,
 * from the records, and unknown is never read as "no".
 *
 * One paragraph is added right after v88's LEAVE OUT THEIR OWN; the output
 * schema adds `question.listConditions`. Same single reading, no extra call.
 */
export const V89_LIST_CONDITIONS = `LIST CONDITIONS: on a FIT, DISCOVER_COMPANIES or INVESTOR_PROSPECTS question, write question.listConditions when they put a condition on which companies or investors to list, or ask for the worst rather than the best -- by meaning, in any words and any language; write null when they state none. Each field is null unless they stated it. relationship: "EXCLUDE_IN_CONTACT" when they want ones they are not already in contact with (then also write excludeRelationships true; this holds for a founder's investors too: "which investors fit, leaving out ones I'm already talking to"), "ONLY_IN_CONTACT" when only those they are in contact with ("of the investors I'm talking to, which fit best?"). revenue: "HAS_REVENUE" ("only the ones with actual revenue", "already selling", "paying customers") or "PRE_REVENUE" ("pre-revenue", "not making money yet"). sector, stage, geography: "INSIDE" when they want ones within their mandate on that dimension (for a founder: investors whose published focus matches their company), "OUTSIDE" when outside it ("outside my preferred sectors", "a stage I don't usually do", "outside my regions"; a founder's "investors who don't usually back my sector"). order: "WORST_FIRST" when they ask for the poorest or weakest fits ("which would be poor fits", "the worst matches", "who should I not bother with"), otherwise "BEST_FIRST". Never write a condition they did not state. A named sector, country or stage ("fintech in Kenya") stays where it already goes (discover), not here.`;

if (
  TURN_READER_V88.template.split(V88_FIT_EXCLUDE_RELATIONSHIPS).length !== 2
) {
  throw new Error(
    "TURN_READER v89 follows v88's LEAVE OUT THEIR OWN paragraph, which changed or repeats",
  );
}

export const TURN_READER_V89: PromptDefinition<
  TurnReaderV76Variables,
  TurnReaderV89Result
> = {
  ...TURN_READER_V88,
  version: 89,
  status: "ACTIVE",
  changeDescription:
    "Audit 2026-11-15 RC2 (ranked lists dropped the stated condition: 'only ones with actual revenue', 'outside my preferred sectors', a founder's 'poor fits' and 'leave out ones I'm talking to'): v88 plus one LIST CONDITIONS paragraph -- question.listConditions (relationship, revenue, sector/stage/geography inside or outside, best or worst first) on a FIT, DISCOVER_COMPANIES or INVESTOR_PROSPECTS question, by meaning in any language. Code applies them from the records before ranking; unknown stays unknown. No extra model call.",
  effectiveFrom: "2026-11-15",
  variables: {
    schema: TurnReaderV76VariablesSchema,
    untrusted: [...TURN_READER_V76_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V89_SCHEMA_VERSION,
    schema: TurnReaderV89ResultSchema,
    onlyWhatApplies: true,
  },
  template: TURN_READER_V88.template.replace(
    V88_FIT_EXCLUDE_RELATIONSHIPS,
    `${V88_FIT_EXCLUDE_RELATIONSHIPS}\n${V89_LIST_CONDITIONS}`,
  ),
};
