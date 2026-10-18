import type { PromptDefinition } from "../definition.js";
import type {
  TurnReaderV5Result,
  TurnReaderVariables,
} from "../schemas/turn-reader.js";
import { TURN_READER_V5 } from "./turn-reader.v5.js";

/**
 * TURN_READER v6 — v5, with navigation when the choice is left to Q
 * (founder live, 2026-09-26: "take me to another page of your choosing"
 * got "I can't navigate you", while "take me to Discover" worked). A
 * request to be taken somewhere with the destination left to Q is still
 * NAVIGATE; Q chooses the screen most useful from the conversation.
 * Concepts only.
 */
const V5_NAVIGATE_TAIL =
  "Asking what a screen is, or about something on it, is a question, not NAVIGATE.";

const V6_NAVIGATE_TAIL =
  "When they want to be taken somewhere and leave the choice of screen to Capital Q, it is still NAVIGATE: choose the destination most useful for what the conversation is about, and never the screen they are asking to leave. Asking what a screen is, or about something on it, is a question, not NAVIGATE.";

if (!TURN_READER_V5.template.includes(V5_NAVIGATE_TAIL)) {
  throw new Error(
    "TURN_READER v6 extends v5's NAVIGATE rule, and v5 no longer carries it",
  );
}

export const TURN_READER_V6: PromptDefinition<
  TurnReaderVariables,
  TurnReaderV5Result
> = {
  ...TURN_READER_V5,
  version: 6,
  status: "DEPRECATED",
  changeDescription:
    "Founder live: a request to be taken somewhere with the destination left to Q is NAVIGATE, and Q chooses the most useful screen from the conversation.",
  effectiveFrom: "2026-09-26",
  template: TURN_READER_V5.template.replace(V5_NAVIGATE_TAIL, V6_NAVIGATE_TAIL),
};
