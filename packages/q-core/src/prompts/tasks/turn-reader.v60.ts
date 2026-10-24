import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV55Variables,
  TurnReaderV58Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V59, V59_ACT_ON_IS_NOT_OPEN } from "./turn-reader.v59.js";

/**
 * v60 (QA 2026-10-23, F-36 / F-41 / F-33): three readings, by meaning in
 * any language, added after v59's REFERENCE rule. v59 is kept whole;
 * schema unchanged (v58).
 *
 * - F-36: "افتح صفحة الاكتشاف" ("open Discover") opened a company: a whole
 *   screen of Capital Q's, named in any language, is NAVIGATE to it.
 * - F-41: "Tell me more about the second one" opened its page: asking
 *   about a record Q showed is a question, answered here.
 * - F-33: "Reply to Rift Valley Seed Fund: accept their interest…" was
 *   read as a hand-over: answering an investor's interest in them is not
 *   handing work over.
 */
export const V60_SCREENS_ANY_LANGUAGE = `- A whole screen of Capital Q's own (Discover, Explore, Saved, their pipeline, settings, their documents...) named in any language is tool NAVIGATE to that destination, never a record to open and never a name to search ("افتح صفحة الاكتشاف" is NAVIGATE DISCOVER; "ouvre mes sauvegardes" is NAVIGATE SAVED).
`;
export const V60_ASKING_IS_NOT_OPEN = `- open is null when they ASK about a record rather than ask to see its page: "tell me more about the second one", "what does the first one do?", "and the third?" are questions (kind QUESTION_TO_Q), answered in the conversation; name and shown still say which record it is.
`;
export const V60_ANSWERING_INTEREST = `- Accepting or declining an interest an investor expressed in THEIR company, or replying to say yes to it ("reply to Rift Valley Seed Fund: accept their interest and suggest a call"), is answering that interest, by what it means, in any language: handOver is null and open is null; name is the investor.
`;

if (TURN_READER_V59.template.split(V59_ACT_ON_IS_NOT_OPEN).length !== 2) {
  throw new Error(
    "TURN_READER v60 extends v59's REFERENCE rule, which changed",
  );
}

export const TURN_READER_V60: PromptDefinition<
  TurnReaderV55Variables,
  TurnReaderV58Result
> = {
  ...TURN_READER_V59,
  version: 60,
  status: "DEPRECATED",
  changeDescription:
    "QA 2026-10-23: v59 plus three readings by meaning in any language -- F-36 a whole Capital Q screen named in any language is NAVIGATE to it, never a record; F-41 asking about a record Q showed ('tell me more about the second one') is a question, open null; F-33 accepting or declining an investor's interest in their company is answering it, never a hand-over. Schema unchanged.",
  effectiveFrom: "2026-10-23",
  template: TURN_READER_V59.template.replace(
    V59_ACT_ON_IS_NOT_OPEN,
    `${V59_ACT_ON_IS_NOT_OPEN}${V60_SCREENS_ANY_LANGUAGE}${V60_ASKING_IS_NOT_OPEN}${V60_ANSWERING_INTEREST}`,
  ),
};
