import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_UNTRUSTED,
  TURN_READER_V3_SCHEMA_VERSION,
  TurnReaderV3ResultSchema,
  TurnReaderVariablesSchema,
  type TurnReaderV3Result,
  type TurnReaderVariables,
} from "../schemas/turn-reader.js";
import {
  TURN_READER_V2,
  TURN_READER_V2_TOOL_SECTION,
} from "./turn-reader.v2.js";

/**
 * TURN_READER v3 — v2, plus producing a document as one of Q's own hands
 * (CQ-QACT-002, ADR 0011).
 *
 * Live, a founder asked about eight times for a PDF pitch deck on Zino
 * Aviation from public sources. Each time Q explained what such a deck
 * would contain and produced nothing: v2 told the reader that preparing a
 * document was not a tool, so nothing in the reading ever said "do this".
 * v3 reads the request as PREPARE_DOCUMENT, with the company as the person
 * named it, including "just give me the PDF" after they named it earlier.
 * Code does the research, composition, rendering and filing; the reading
 * decides none of that.
 */
const V3_TOOL_SECTION = `TOOL (for TOOL_REQUEST only; otherwise null). Set it only when the request is one of these; any other request (change a profile detail, look something up and just tell them) is null here:
- NAVIGATE: they want to be taken to one of Capital Q's own screens. destination: HOME (home, the start), PROFILE (their own profile or details), CAPITAL (their raise, fundraising, capital), DISCOVER (discover, the feed, companies to look at), COMPANY_VISIBILITY (their company's visibility or discovery settings). All other parameters null. Asking what a screen is, or about something on it, is a question, not NAVIGATE.
- SET_VISIBILITY: they want their company seen by investors on Capital Q (network_visible), or no longer seen, private to their own organisation (organisation_private). All other parameters null. Wanting to be seen is not a request for a document, a deck or a pitch.
- PREPARE_DOCUMENT: they want Capital Q to produce a document now: documentType PITCH_DECK (a deck, slides, a pitch, a PDF deck) or INVESTMENT_BRIEF (a brief, a one-pager, a write-up). subjectName: the company it is about, as they named it in this message or, when they now say "the deck", "just give me the PDF", "do it", in the recent turns; null only when it is plainly their own company. It is PREPARE_DOCUMENT, and the kind is TOOL_REQUEST, even when they ask for it to be built from public or online information, when they ask for a sample or a draft, and when they are impatient. Asking what a document would contain, or how Q makes one, is a question, not this. Changing a document Q already made is not this. All other parameters null.

`;

if (!TURN_READER_V2.template.includes(TURN_READER_V2_TOOL_SECTION)) {
  throw new Error(
    "TURN_READER v3 rewrites v2's tool section, and v2 no longer carries it",
  );
}

export const TURN_READER_V3: PromptDefinition<
  TurnReaderVariables,
  TurnReaderV3Result
> = {
  ...TURN_READER_V2,
  version: 3,
  status: "DEPRECATED",
  changeDescription:
    "CQ-QACT-002: PREPARE_DOCUMENT is one of Q's own hands — a request to produce a pitch deck or brief now, with the company as the person named it (in this turn or the recent ones) — so Capital Q researches, composes, renders and files it instead of describing what it would contain.",
  effectiveFrom: "2026-09-25",
  variables: {
    schema: TurnReaderVariablesSchema,
    untrusted: [...TURN_READER_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V3_SCHEMA_VERSION,
    schema: TurnReaderV3ResultSchema,
  },
  template: TURN_READER_V2.template.replace(
    TURN_READER_V2_TOOL_SECTION,
    V3_TOOL_SECTION,
  ),
};
