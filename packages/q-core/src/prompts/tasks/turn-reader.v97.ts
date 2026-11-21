import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV76Variables,
  TurnReaderV96Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V96 } from "./turn-reader.v96.js";

/**
 * v97 (HQ-8, conversation audit slice 8: reader diet and cache). Same
 * words, same schema, same reading: only where the fixed text travels.
 *
 * Measured on v96 (21 Nov 2026): the template is 73,791 bytes, of which
 * 72,616 are fixed rules (about 18k tokens) and 1,175 the per-turn tail.
 * v92 already sends the rules as their own instruction, but behind the
 * charter, whose per-person tail (operating mode, communication profile,
 * environment notes, which carry the date and who is asking) differs for
 * every person and turn. A provider's prompt cache matches only an
 * identical prefix, so nothing past the charter's fixed head (about 1.6k
 * tokens) was ever shared, and every reading prefilled the rules afresh.
 *
 * With `sharedInstructions` (as COMPANY_ANALYST v37 does), the charter's
 * fixed head and these rules lead, byte-identical for everyone and marked
 * shared; the charter's per-person tail follows as its own instruction,
 * then the turn. No duplicated or dead instruction was found to remove
 * (no repeated sentence; every field the rules name is in the schema), so
 * no word changed: reading accuracy cannot move.
 */
export const TURN_READER_V97: PromptDefinition<
  TurnReaderV76Variables,
  TurnReaderV96Result
> = {
  ...TURN_READER_V96,
  version: 97,
  status: "ACTIVE",
  changeDescription:
    "HQ-8 (21 Nov 2026, conversation audit slice 8): v96's words and schema unchanged; the charter's fixed head and the reader's ~72.6 KB of fixed rules lead as shared instructions, byte-identical for every person and turn, so the provider's prompt cache covers them (before, the per-person charter tail sat ahead of them and nothing past ~1.6k tokens was shared). No extra model call.",
  effectiveFrom: "2026-11-21",
  sharedInstructions: true,
};
