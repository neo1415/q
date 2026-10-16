import type { PromptDefinition } from "../definition.js";
import {
  TURN_READER_SCHEMA_NAME,
  TURN_READER_V52_SCHEMA_VERSION,
  TurnReaderV52ResultSchema,
  type TurnReaderV7Variables,
  type TurnReaderV52Result,
} from "../schemas/turn-reader.js";
import { V50_FIT } from "./turn-reader.v50.js";
import { TURN_READER_V51 } from "./turn-reader.v51.js";

/**
 * v52 (lane ml, live 2026-10-16): nextSteps, read from meaning, on top of
 * v51's decision-with-work rule. Code opens an answer with the person's own
 * readiness gaps only when they ask for them; an ADVICE question about
 * anything else (what a SAFE is, whether a valuation is fair) is answered
 * without that list.
 */
export const V52_NEXT_STEPS = `NEXT STEPS: nextSteps is true only when they ask what they themselves should do next, what is missing or holding back their raise, profile or visibility to investors, or how ready they are, in any words and any language ("what should I do next?", "what's missing before investors see us?", "how ready am I?", "ما الخطوة التالية؟"). It is false for every other question, including advice or explanation on a topic ("explain a SAFE", "is USD 2.5m sensible for us?"), questions about other people or companies, and requests to do something.\n`;

if (TURN_READER_V51.template.split(V50_FIT).length !== 2) {
  throw new Error("TURN_READER v52 extends v50's FIT rule, which changed");
}

export const TURN_READER_V52: PromptDefinition<
  TurnReaderV7Variables,
  TurnReaderV52Result
> = {
  ...TURN_READER_V51,
  version: 52,
  status: "ACTIVE",
  changeDescription:
    "Lane ml live 2026-10-16: nextSteps, read from meaning, so code's readiness list opens only answers that ask what to do next or how ready they are, not every ADVICE question. v51's rules unchanged.",
  effectiveFrom: "2026-10-16",
  output: {
    kind: "STRUCTURED",
    schemaName: TURN_READER_SCHEMA_NAME,
    schemaVersion: TURN_READER_V52_SCHEMA_VERSION,
    schema: TurnReaderV52ResultSchema,
  },
  template: TURN_READER_V51.template.replace(
    V50_FIT,
    `${V50_FIT}${V52_NEXT_STEPS}`,
  ),
};
