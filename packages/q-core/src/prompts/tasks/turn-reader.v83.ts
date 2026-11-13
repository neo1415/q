import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V76_UNTRUSTED,
  TURN_READER_V83_SCHEMA_VERSION,
  TurnReaderV76VariablesSchema,
  TurnReaderV83ResultSchema,
  type TurnReaderV76Variables,
  type TurnReaderV83Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V82 } from "./turn-reader.v82.js";

/**
 * v83 (C10, owner directive 13 Nov 2026: semantic intent, not keyword
 * routing). Live on 5af6c8ad3 (investor, one conversation): a chart
 * question moved the page pane to the company's Overview ("I've opened
 * Overview."), "Now do the same for Silo Credit." stored "Overview is
 * ready to open.", and "What stage is Ledgerline at?" stored
 * "Relationship is ready to open." Nobody asked to go anywhere. Whether a
 * turn asks to be taken somewhere was decided by word rules and by the
 * page-move decision on every turn. v83 has the same single reading say
 * it, as a typed navigation intent (GO / OFFER_ONLY / NONE, and negated);
 * code moves the pane only on GO, offers only on OFFER_ONLY, and still
 * decides where and whether the person may open it. No extra model call.
 *
 * One paragraph is added after WHAT WAS ASKED (which holds v82's chart
 * ask), before REFERENCES BY NAME; the output schema adds `navigation` to
 * v82's.
 */
export const V83_NAVIGATION = `NAVIGATION: always write navigation: whether this turn asks to be taken somewhere, read by what they want, in any words and any language. mode GO when they ask to be taken to, or opened onto, a place -- one of Capital Q's screens, a tab, or a record's own page -- as the thing they want ("take me to my pipeline", "go to Discover", "open Clinicrest", "pull up Ledgerline's page", "show me Ledgerline's profile page", "can you bring up my documents?", "abeg carry me go my documents", "llévame a Descubrir", "emmène-moi à mes relations", "افتح صفحة الاكتشاف"). mode OFFER_ONLY when they ask what one of their own screens holds, or ask to see it, without asking to go there ("show me my pipeline", "what's in my data room?", "where's my pipeline?", "what's on my saved list?"): Q answers here and offers the page. mode NONE for everything else, even when a page also shows the answer: a fact, a figure, a status or stage, a chart or a trend, a comparison, an analysis, research, a lookup, a document, an action, a reply, talk ("what stage is Ledgerline at?", "how has Ledgerline's MRR moved since June? Let me see it visually", "now do the same for Silo Credit", "compare these two", "is their burn sustainable?"). "Show me" or "let me see" a figure, a chart, a list of companies or an answer asks for the answer, not a page: NONE. negated is true when they say not to go or open anything ("don't open it, just tell me", "no need to take me there", "stay here and tell me its stage", "sin abrir nada, dime"); mode is then NONE. A turn that asks to go and also asks more ("open Clinicrest and tell me its stage") is GO, and parts holds each ask.`;

/** The paragraph v83's NAVIGATION is placed before (v79's, once). */
export const V83_NAVIGATION_BEFORE = "\nREFERENCES BY NAME: ";

if (TURN_READER_V82.template.split(V83_NAVIGATION_BEFORE).length !== 2) {
  throw new Error(
    "TURN_READER v83 goes before v79's REFERENCES BY NAME, which changed or repeats",
  );
}

export const TURN_READER_V83: PromptDefinition<
  TurnReaderV76Variables,
  TurnReaderV83Result
> = {
  ...TURN_READER_V82,
  version: 83,
  status: "ACTIVE",
  changeDescription:
    "C10 (owner directive 13 Nov 2026, no keyword routing): v82 plus a typed navigation intent read by meaning in the same pass -- navigation.mode GO (asked to be taken somewhere), OFFER_ONLY (asked what one of their own screens holds; answered here, page offered) or NONE (no navigation; the default for facts, charts, comparisons and analysis), and navigation.negated. Code moves only on GO and offers only on OFFER_ONLY; where, and whether they may open it, stay in code. No extra model call.",
  effectiveFrom: "2026-11-13",
  variables: {
    schema: TurnReaderV76VariablesSchema,
    untrusted: [...TURN_READER_V76_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V83_SCHEMA_VERSION,
    schema: TurnReaderV83ResultSchema,
    onlyWhatApplies: true,
  },
  template: TURN_READER_V82.template.replace(
    V83_NAVIGATION_BEFORE,
    `\n${V83_NAVIGATION}${V83_NAVIGATION_BEFORE}`,
  ),
};
