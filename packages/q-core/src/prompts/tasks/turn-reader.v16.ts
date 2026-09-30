import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV7Variables,
  TurnReaderV15Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V15 } from "./turn-reader.v15.js";

/**
 * TURN_READER v16 -- v15, plus: a named record is not a screen (founder
 * live 2026-09-30). "Open my chat with Yamfield Agro" was read as
 * NAVIGATE to Relationships, so the person landed on the list instead of
 * the chat. Navigation to a whole screen is only for a screen asked for by
 * itself; when a particular company, investor, person or chat is named, the
 * reader leaves it to the run, whose tools open that record.
 */
export const TURN_READER_V16_RECORDS = `NAMED RECORDS: NAVIGATE is only for a whole screen asked for by itself ("take me to Discover", "open my relationships"). When the words name a particular company, investor, person, chat, call or document to open or look at ("open my chat with X", "show me X's page", "take me to the call with X"), do not return NAVIGATE: leave it to the answer, which opens that record.
`;

const V15_TRANSCRIPT_ANCHOR = "TRANSCRIPT (modality {{modality}}):";

if (!TURN_READER_V15.template.includes(V15_TRANSCRIPT_ANCHOR)) {
  throw new Error(
    "TURN_READER v16 adds its line before v15's transcript line, which v15 lost",
  );
}

export const TURN_READER_V16: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV15Result
> = {
  ...TURN_READER_V15,
  version: 16,
  status: "ACTIVE",
  changeDescription:
    "Founder live 2026-09-30: a named company, person or chat is not a whole screen; the reader leaves it to the run, which opens that record, instead of navigating to the list.",
  effectiveFrom: "2026-09-30",
  template: TURN_READER_V15.template.replace(
    V15_TRANSCRIPT_ANCHOR,
    `${TURN_READER_V16_RECORDS}${V15_TRANSCRIPT_ANCHOR}`,
  ),
};
