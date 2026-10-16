import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V51_SCHEMA_VERSION,
  TurnReaderV51ResultSchema,
  type TurnReaderV7Variables,
  type TurnReaderV51Result,
} from "../schemas/turn-reader.js";
import { TURN_READER_V50, V50_FIT } from "./turn-reader.v50.js";

/**
 * v51 (lane ml, live 2026-10-16): nextSteps, read from meaning. Code opens
 * an answer with the person's own readiness gaps only when they ask for
 * them; an ADVICE question about anything else (what a SAFE is, whether a
 * valuation is fair) is answered without that list.
 */
export const V51_NEXT_STEPS = `NEXT STEPS: nextSteps is true only when they ask what they themselves should do next, what is missing or holding back their raise, profile or visibility to investors, or how ready they are, in any words and any language ("what should I do next?", "what's missing before investors see us?", "how ready am I?", "ما الخطوة التالية؟"). It is false for every other question, including advice or explanation on a topic ("explain a SAFE", "is USD 2.5m sensible for us?"), questions about other people or companies, and requests to do something.\n`;

export const TURN_READER_V51: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV51Result
> = {
  ...TURN_READER_V50,
  version: 51,
  status: "ACTIVE",
  changeDescription:
    "Lane ml live 2026-10-16: nextSteps, read from meaning, so code's readiness list opens only answers that ask what to do next or how ready they are, not every ADVICE question.",
  effectiveFrom: "2026-10-16",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V51_SCHEMA_VERSION,
    schema: TurnReaderV51ResultSchema,
  },
  template: TURN_READER_V50.template.replace(
    V50_FIT,
    `${V50_FIT}${V51_NEXT_STEPS}`,
  ),
};
