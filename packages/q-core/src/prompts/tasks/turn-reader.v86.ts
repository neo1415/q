import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V76_UNTRUSTED,
  TURN_READER_V86_SCHEMA_VERSION,
  TurnReaderV76VariablesSchema,
  TurnReaderV86ResultSchema,
  type TurnReaderV76Variables,
  type TurnReaderV86Result,
} from "../schemas/turn-reader.js";
import {
  TURN_READER_V85,
  V85_NAVIGATION_DESTINATION,
} from "./turn-reader.v85.js";

/**
 * v86 (A8, owner directive 13 Nov 2026: rich media must not stay behind).
 * When an investor or founder talks with Q about a company, the answer can
 * show that company's own Capital Q picture, and its pitch when they ask to
 * see it. Whether they asked is read here, by meaning and in any language
 * (`companyMedia.pitch`, `companyMedia.picture`); which company, and whether
 * this reader may see its picture or play its pitch, stay code's.
 *
 * One paragraph is added right after v85's NAVIGATION DESTINATION; the
 * output schema adds `companyMedia`. Same single reading, no extra call.
 */
export const V86_COMPANY_MEDIA = `COMPANY MEDIA: write companyMedia.pitch true when they ask to see, watch or play a company's pitch video, however said and in any language ("show me their pitch", "can I watch Clinicrest's pitch?", "let me see how they present", "play it", "¿puedo ver su vídeo?"); false otherwise -- a question about what a pitch says ("what did they claim in their pitch?") is not a request to watch it, and their own pitch reviewed is not either. Write companyMedia.picture true when the turn asks about a company as a whole -- who they are, what they do, an overview, profile or introduction ("tell me about Ledgerline", "who are these people?"), or companies side by side -- and false for one figure or fact ("what's their MRR?"), small talk, their own records, tasks or documents. Leave companyMedia out when both would be false.`;

if (TURN_READER_V85.template.split(V85_NAVIGATION_DESTINATION).length !== 2) {
  throw new Error(
    "TURN_READER v86 follows v85's NAVIGATION DESTINATION paragraph, which changed or repeats",
  );
}

export const TURN_READER_V86: PromptDefinition<
  TurnReaderV76Variables,
  TurnReaderV86Result
> = {
  ...TURN_READER_V85,
  version: 86,
  status: "ACTIVE",
  changeDescription:
    "A8 (owner directive 13 Nov 2026): v85 plus one COMPANY MEDIA paragraph -- companyMedia.pitch when they ask to see, watch or play a company's pitch video, companyMedia.picture when the turn asks about a company as a whole (overview, profile, 'tell me about X', side by side), read by meaning in any language. Code shows the run's authorised company with its own picture and its pitch only where the reader may see or play them. No extra model call.",
  effectiveFrom: "2026-11-13",
  variables: {
    schema: TurnReaderV76VariablesSchema,
    untrusted: [...TURN_READER_V76_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V86_SCHEMA_VERSION,
    schema: TurnReaderV86ResultSchema,
    onlyWhatApplies: true,
  },
  template: TURN_READER_V85.template.replace(
    V85_NAVIGATION_DESTINATION,
    `${V85_NAVIGATION_DESTINATION}\n${V86_COMPANY_MEDIA}`,
  ),
};
