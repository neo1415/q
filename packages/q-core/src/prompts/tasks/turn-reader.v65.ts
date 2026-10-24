import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V65_SCHEMA_VERSION,
  TurnReaderV65ResultSchema,
  type TurnReaderV55Variables,
  type TurnReaderV65Result,
} from "../schemas/turn-reader.js";
import { V62_COMPARE } from "./turn-reader.v62.js";
import { TURN_READER_V64 } from "./turn-reader.v64.js";

/**
 * v65 (coordinator 2026-10-24, run beb74547): "Which is better, Anchor or
 * Afyascan?" came back with no compare, so the side-by-side was never
 * drawn (lane 8's #460 holds a phrase fallback until this ships). A choice
 * between named companies, in any words and any language, is compare with
 * their names, read by meaning -- also when it asks which fits them. The
 * live v64 is kept whole; same output schema.
 */
export const V65_CHOICE_IS_COMPARE = `A CHOICE BETWEEN NAMED COMPANIES is compare with their names, in the order said, whatever else the turn is: "which is better, A or B?", "which fits me more, A or B?", "would you pick A or B?", "A or B -- which one?", "should I back A or B?", "¿cuál es mejor, A o B?", "lequel est le meilleur, A ou B ?", "أيهما أفضل، A أم B؟". A question of fit or of which to choose sets compare as well, never instead of it.`;

/**
 * Coordinator 2026-10-24 (replay of the owner's conversation): whether a
 * reply continues Q's question, decides a waiting card, or is new -- and
 * whether a discovery ask is about investors or companies -- are read by
 * meaning here; code's word lists only decide when to wait for this.
 */
export const V65_REPLY_TO = `REPLY TO: replyTo says what this turn answers, by what it means in any words and any language. Q_QUESTION when it answers or continues the question or invitation in Q's last turn: "Want me to find three investors for Halyard?" then "Yes. No, not Halyard. Capital Q" continues it with Capital Q as the subject, and "Tell me which to look into further." then "the second one" picks from that list; a correction inside such a reply ("not X, Y") continues the question with Y and opens no page. WAITING_CARD when it approves, declines or changes a change Q prepared that is waiting for their approval, with card the waiting change it decides, as Q named it (null when it decides all of them or does not say which). NEW when it is a request or question of its own. A yes to Q's question about something else is Q_QUESTION, never WAITING_CARD. Null on a first turn, or when you cannot tell.`;
export const V65_DISCOVER_WHOM = `DISCOVER WHOM: discoverWhom is INVESTORS when they ask to find, list, rank or name investors, funds, VCs, angels or backers, in any words and any language ("just find me three Qatari investors", "who could back us?", "ابحث لي عن ثلاثة مستثمرين قطريين"); COMPANIES when they ask for companies or startups to look at; null when the turn asks neither. Investors asked for are never a company search, whatever country, sector or stage they name.`;

if (TURN_READER_V64.template.split(V62_COMPARE).length !== 2) {
  throw new Error("TURN_READER v65 extends v62's COMPARE rule, which changed");
}

export const TURN_READER_V65: PromptDefinition<
  TurnReaderV55Variables,
  TurnReaderV65Result
> = {
  ...TURN_READER_V64,
  version: 65,
  status: "ACTIVE",
  changeDescription:
    "Coordinator 2026-10-24 (run beb74547): v64 plus A CHOICE BETWEEN NAMED COMPANIES -- 'which is better / fits me more / would you pick, A or B', in any words and any language -- is compare {names} in the order said, also when it asks which fits; a fit question sets compare as well, never instead of it. Also replyTo (Q_QUESTION / WAITING_CARD with the card / NEW) and discoverWhom (INVESTORS / COMPANIES), read by meaning, so code's word lists only decide when to wait for the reading (coordinator 2026-10-24).",
  effectiveFrom: "2026-10-24",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V65_SCHEMA_VERSION,
    schema: TurnReaderV65ResultSchema,
  },
  template: TURN_READER_V64.template.replace(
    V62_COMPARE,
    `${V62_COMPARE.trimEnd()}\n${V65_CHOICE_IS_COMPARE}\n${V65_REPLY_TO}\n${V65_DISCOVER_WHOM}\n`,
  ),
};
