import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V56_SCHEMA_VERSION,
  TurnReaderV56ResultSchema,
  type TurnReaderV55Variables,
  type TurnReaderV56Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V55, V55_SCREEN_CONTROLS } from "./turn-reader.v55.js";

/**
 * v56 (production 2026-10-17, conversation 4f07dae7): after Q showed the
 * top three (Ledgerfold, Basketari, Brancheon Works), "give me three new
 * companies that fit my mandate" came back with Ledgerfold and Basketari
 * again. v55 is kept whole; the FIT question gains `excludeShown`, read by
 * meaning in any words and any language (the owner forbids phrase lists),
 * and code leaves the companies already shown out of the same
 * deterministic fit ranking.
 */
export const V56_FIT_EXCLUDE_SHOWN = `FIT, NEW ONES: excludeShown is true on a FIT question when they ask for companies other than the ones Q already showed in this conversation (see SHOWN), by what it means, in any words and any language ("give me three new companies that fit my mandate", "different ones", "anything else?", "who else fits?", "show me more", "any others?", "d'autres entreprises ?", "¿alguna otra?"). Such a turn after Q showed companies for their mandate is a FIT question even when it names no companies and no mandate. Its count is the number they ask for now; when they name none, the count of the earlier fit ask in SHOWN. Its text is their words, or the earlier fit ask's words when this turn only asks for more. excludeShown is false when they ask about the companies already shown (rank them, compare those, the second one), when nothing was shown yet, and for every other question kind.
`;

if (TURN_READER_V55.template.split(V55_SCREEN_CONTROLS).length !== 2) {
  throw new Error(
    "TURN_READER v56 extends v55's PAGE CONTROLS rule, which changed",
  );
}

export const TURN_READER_V56: PromptDefinition<
  TurnReaderV55Variables,
  TurnReaderV56Result
> = {
  ...TURN_READER_V55,
  version: 56,
  status: "DEPRECATED",
  changeDescription:
    "Production 2026-10-17 (conversation 4f07dae7): v55 plus excludeShown on a FIT question -- they want companies other than those Q already showed in this conversation (new, other, more, different, anything else, who else), read by meaning in any language; code leaves the shown companies out of the same deterministic fit ranking.",
  effectiveFrom: "2026-10-17",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V56_SCHEMA_VERSION,
    schema: TurnReaderV56ResultSchema,
  },
  template: TURN_READER_V55.template.replace(
    V55_SCREEN_CONTROLS,
    `${V55_SCREEN_CONTROLS}${V56_FIT_EXCLUDE_SHOWN}`,
  ),
};
