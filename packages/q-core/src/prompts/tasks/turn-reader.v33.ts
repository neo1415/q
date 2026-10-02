import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV7Variables,
  TurnReaderV31Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V32, TURN_READER_V32_ACTIONS } from "./turn-reader.v32.js";

/**
 * TURN_READER v33 -- v32 reordered for the provider's prompt cache (lead
 * 2026-10-02: the reader runs on every turn; OpenAI reuses an identical
 * prefix of 1024 tokens or more). Every per-turn value now comes last:
 * the action groups, the modality, the recent turns and what was said. The
 * words are v32's; only where the values sit changed. Same schema as v31.
 */
const ACTIONS_HEAD =
  "OTHER ACTIONS CAPITAL Q TAKES IN THIS CONVERSATION (trusted; built from what this run can do)\n";
const V32_ACTIONS_BLOCK = `${ACTIONS_HEAD}${TURN_READER_V32_ACTIONS}\n`;
const V33_ACTIONS_POINTER =
  "OTHER ACTIONS CAPITAL Q TAKES IN THIS CONVERSATION are listed near the end, under ACTIONS (trusted; built from what this run can do).\n";
const V32_TRANSCRIPT = "TRANSCRIPT (modality {{modality}}):";
const V33_TRANSCRIPT = "TRANSCRIPT (modality: see MODALITY near the end):";
const V32_TAIL = "RECENT TURNS\n{{recentTurns}}";
export const TURN_READER_V33_TAIL = `ACTIONS\n${TURN_READER_V32_ACTIONS}\n\nMODALITY: {{modality}}\n\nRECENT TURNS\n{{recentTurns}}`;

for (const anchor of [V32_ACTIONS_BLOCK, V32_TRANSCRIPT, V32_TAIL]) {
  if (!TURN_READER_V32.template.includes(anchor)) {
    throw new Error(`TURN_READER v33 reorders v32, which lost: ${anchor}`);
  }
}

export const TURN_READER_V33: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV31Result
> = {
  ...TURN_READER_V32,
  version: 33,
  status: "DEPRECATED",
  changeDescription:
    "Lead 2026-10-02 (speed): every per-turn value last (action groups, modality, recent turns, the words), so the static instructions form one cacheable prefix. Same words and schema as v32.",
  effectiveFrom: "2026-10-02",
  template: TURN_READER_V32.template
    .replace(V32_ACTIONS_BLOCK, V33_ACTIONS_POINTER)
    .replace(V32_TRANSCRIPT, V33_TRANSCRIPT)
    .replace(V32_TAIL, TURN_READER_V33_TAIL),
};
