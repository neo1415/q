import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV76Variables,
  TurnReaderV91Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V91 } from "./turn-reader.v91.js";

/**
 * Where v92's fixed rules end: the ACTIONS heading, the first section that
 * carries this turn's data. Everything above it is the same for every
 * reading.
 */
export const V92_RULES_END_BEFORE =
  'ACTIONS\nGrouped by area, each offered one as name (what it does, in a few words); names after "Not available here" are Capital Q actions this conversation does not offer.';

/**
 * v92 (model spend, 18 Nov 2026). The same words, schema and variables as
 * v91; only where its fixed rules travel changes.
 *
 * ai_ops.model_usage, 17-18 Nov: a reading averaged 22.7k input tokens
 * and only 3.7k of them came from the provider's prompt cache. Every hit
 * stopped at the end of the instructions and output schema (~4.6k), even
 * for the same person's next turn a minute later, while the ~14k tokens of
 * fixed rules opening the user message were paid at the uncached rate on
 * every reading. The reading is about 85% of the turn's classification
 * spend. The rules now go as instructions beside the charter, so a warm
 * cache holds them; this turn's actions, page, state, turns and words stay
 * the user message, fenced as before.
 */
export const TURN_READER_V92: PromptDefinition<
  TurnReaderV76Variables,
  TurnReaderV91Result
> = {
  ...TURN_READER_V91,
  version: 92,
  status: "ACTIVE",
  changeDescription:
    "Model spend 18 Nov 2026 (ai_ops.model_usage: ~22.7k input tokens a reading, the cache stopping at the instructions and schema, ~4.6k): v91 unchanged in words, schema and variables; its fixed rules, everything before the ACTIONS section, are sent as instructions beside the charter so the provider's prompt cache holds them from turn to turn. This turn's data stays the fenced user message. No extra model call.",
  effectiveFrom: "2026-11-18",
  rulesEndBefore: V92_RULES_END_BEFORE,
};
