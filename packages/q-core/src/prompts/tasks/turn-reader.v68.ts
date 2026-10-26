import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V68_SCHEMA_VERSION,
  TurnReaderV65ResultSchema,
  type TurnReaderV55Variables,
  type TurnReaderV65Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V67 } from "./turn-reader.v67.js";

/**
 * v68 (coordinator 2026-10-26, the reader's fixed cost): v67's words, and
 *  - a reading writes only the fields that differ from their defaults
 *    (`onlyWhatApplies`): the reader's 3.3 s tracked its ~270 output
 *    tokens at ~10 ms each, ~150 of them fields written at their
 *    defaults, while its 15k input did not move it;
 *  - the page's controls are listed at the end with the other per-turn
 *    inputs, so the rules before them are one cacheable prefix.
 * Same output schema, read back the same: a missing field is its default.
 */
export const V68_CONTROLS_LISTED_BELOW =
  "PAGE CONTROLS: the tabs and sections of the page on their screen now, listed under PAGE CONTROLS below.\n";
export const V68_CONTROLS_BLOCK =
  "PAGE CONTROLS\nOne per line as id (kind, its visible name, state), listed by Capital Q from the page itself:\n{{screenControls}}\n\n";
export const V68_ONLY_WHAT_APPLIES =
  "Write only the fields whose value differs from the default the schema gives; leave out every other field, and Capital Q reads it as that default (null, false, an empty list, ranking NONE, addressedToQ true). addressedToQ false is always written.";

const V67_CONTROLS =
  "PAGE CONTROLS: the tabs and sections of the page on their screen now, one per line as id (kind, its visible name, state), listed by Capital Q from the page itself:\n{{screenControls}}\n";
const MODALITY = "MODALITY: {{modality}}";
const RESPOND =
  "Respond with a single JSON object matching the TurnReaderResult schema.";

for (const part of [V67_CONTROLS, MODALITY, RESPOND]) {
  if (TURN_READER_V67.template.split(part).length !== 2) {
    throw new Error(`TURN_READER v68 rearranges v67, which changed: ${part}`);
  }
}

export const TURN_READER_V68: PromptDefinition<
  TurnReaderV55Variables,
  TurnReaderV65Result
> = {
  ...TURN_READER_V67,
  version: 68,
  status: "ACTIVE",
  changeDescription:
    "Coordinator 2026-10-26 (the reader's fixed cost): v67's rules unchanged; a reading writes only the fields that differ from their defaults (the provider schema requires only kind, confidence and transcript), which Capital Q reads back as those defaults; the page's controls move to the end with the other per-turn inputs, so the rules are one cacheable prefix.",
  effectiveFrom: "2026-10-26",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V68_SCHEMA_VERSION,
    schema: TurnReaderV65ResultSchema,
    onlyWhatApplies: true,
  },
  template: TURN_READER_V67.template
    .replace(V67_CONTROLS, V68_CONTROLS_LISTED_BELOW)
    .replace(MODALITY, `${V68_CONTROLS_BLOCK}${MODALITY}`)
    .replace(RESPOND, `${RESPOND} ${V68_ONLY_WHAT_APPLIES}`),
};
