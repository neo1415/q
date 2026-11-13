import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V76_UNTRUSTED,
  TURN_READER_V84_SCHEMA_VERSION,
  TurnReaderV76VariablesSchema,
  TurnReaderV84ResultSchema,
  type TurnReaderV76Variables,
  type TurnReaderV84Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V83, V83_NAVIGATION } from "./turn-reader.v83.js";

/**
 * v84 (owner correction 13 Nov 2026, C10). v83 read navigation as GO /
 * OFFER_ONLY / NONE, so most ordinary workspace turns became NONE and Q
 * stopped bringing the page the conversation is about into the adjacent
 * pane -- contextual navigation the owner values. v84 adds CONTEXT: the
 * conversation turned to something a Capital Q page holds and that page
 * beside it would materially help (a topic or task transition, not a mere
 * mention). Code hands CONTEXT to the existing page-move decision and all
 * its guards; GO moves at once; OFFER_ONLY offers; NONE or negated moves
 * and offers nothing. No extra model call.
 *
 * v83's NAVIGATION paragraph is replaced whole; the output schema's
 * navigation.mode adds CONTEXT.
 */
export const V84_NAVIGATION = `NAVIGATION: always write navigation: whether this turn should change the page shown beside the conversation, read by what they want and by where the conversation is going, in any words and any language. mode GO when they ask to be taken to, or opened onto, a place -- one of Capital Q's screens, a tab, or a record's own page or one of its sections -- as the thing they want ("take me to my pipeline", "go to Discover", "open Clinicrest", "pull up Ledgerline's page", "show me Clinicrest's deck", "can you bring up my documents?", "abeg carry me go my documents", "llévame a Descubrir", "emmène-moi à mes relations", "افتح صفحة الاكتشاف"). mode CONTEXT when, without asking to go anywhere, the conversation has now turned to something one of Capital Q's pages holds -- their pipeline or deals, one investor or company relationship, a company's profile or one part of it (its team, deck, data room, financials), a deal room, their Daily -- and having that page beside the conversation would materially help what they are doing now: a new topic or task, not a passing mention ("which of my deals are stalled?", "who should I follow up with this week?", "let's go through where things stand with Savanna Seed", "talk me through Clinicrest's team", "what's still missing from Ledgerline's data room?"). A follow-up about the subject already being worked on is CONTEXT too; code keeps the page that is already there. mode OFFER_ONLY when a page could help but the answer belongs here in the conversation: they ask what one of their own screens holds or to see it without asking to go there ("show me my pipeline", "what's in my data room?", "where's my pipeline?", "what's on my saved list?"), or a short fact a page also shows ("what stage is Ledgerline at?" may be OFFER_ONLY or NONE). mode NONE when the answer is best given inline: an ordinary question or definition, a single fact or figure, a chart, graph, table or document drawn or shown in the conversation, a comparison, an analysis, research on the public web or the news, a reply, thanks or small talk ("what is a SAFE?", "how has Ledgerline's MRR moved since June? Let me see it visually", "now do the same for Silo Credit", "compare these two on burn", "what's the press saying about Ledgerline?", "thanks"). "Show me" or "let me see" a figure, a chart, a list of companies or an answer asks for the answer, not a page: NONE. negated is true when they say not to move, go or open anything, or to stay ("don't open it, just tell me", "don't move the page", "stay here", "no need to take me there", "sin abrir nada, dime"); mode is then NONE. A turn that asks to go and also asks more ("open Clinicrest and tell me its stage") is GO, and parts holds each ask.`;

if (TURN_READER_V83.template.split(V83_NAVIGATION).length !== 2) {
  throw new Error(
    "TURN_READER v84 replaces v83's NAVIGATION paragraph, which changed or repeats",
  );
}

export const TURN_READER_V84: PromptDefinition<
  TurnReaderV76Variables,
  TurnReaderV84Result
> = {
  ...TURN_READER_V83,
  version: 84,
  status: "ACTIVE",
  changeDescription:
    "C10 owner correction (13 Nov 2026): v83 with its NAVIGATION paragraph replaced -- navigation.mode adds CONTEXT (the conversation turned to something a Capital Q page holds and that page beside it would materially help), so contextual workspace navigation is kept: code hands CONTEXT to the existing page-move decision and its guards, moves at once on GO, offers on OFFER_ONLY, and moves and offers nothing on NONE or negated. No extra model call.",
  effectiveFrom: "2026-11-13",
  variables: {
    schema: TurnReaderV76VariablesSchema,
    untrusted: [...TURN_READER_V76_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V84_SCHEMA_VERSION,
    schema: TurnReaderV84ResultSchema,
    onlyWhatApplies: true,
  },
  template: TURN_READER_V83.template.replace(V83_NAVIGATION, V84_NAVIGATION),
};
