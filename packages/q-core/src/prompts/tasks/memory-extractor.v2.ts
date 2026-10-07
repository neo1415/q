import type { PromptDefinition } from "../definition.js";
import {
  MEMORY_EXTRACTOR_SCHEMA_NAME,
  MEMORY_EXTRACTOR_V2_SCHEMA_VERSION,
  MemoryExtractorResultV2Schema,
  type MemoryExtractorResultV2,
  type MemoryExtractorVariables,
} from "../schemas/memory-extractor.js";
import { MEMORY_EXTRACTOR_V1 } from "./memory-extractor.v1.js";

/**
 * MEMORY_EXTRACTOR v2 -- v1 plus SMALL_TALK (ADR 0062, Q room R7: "bring
 * back something remembered from earlier small talk"). Same variables and
 * rules; one more kind, each with the short question Q may ask about it
 * later. The Write Gate keeps it personal-private for 90 days and recall
 * never hands it to a prompt; only the silence ladder brings it back.
 */
const FACT_ABOUT_COMPANY_LINE = `     FACT_ABOUT_COMPANY — a durable fact they state about their own company that is not already a recorded profile field ("we have two co-founders", "we sell to insurers").`;
const SMALL_TALK_LINE = `${FACT_ABOUT_COMPANY_LINE}
     SMALL_TALK — something they mention in passing about their own life that a colleague would ask about next time ("I'm off to Lagos on Friday", "my daughter has her exams this week"). Only their own plans, trips, events and interests; never health, money, religion, politics or anything about a named other person.`;
const QUOTE_LINE = `   - quote: the person's exact words this rests on, copied from a USER turn. Never Q's words, never a paraphrase.`;
const FOLLOW_UP_LINE = `${QUOTE_LINE}
   - followUp: for SMALL_TALK only, the one short, warm question Q could ask about it later, under 12 words ("how was Lagos?", "how did the exams go?"); null for every other type.`;
const NOT_A_MOOD = `- Not a passing figure, a question they asked, a mood, a joke, or anything they were plainly not stating about themselves ("suppose we had 2 million").`;
const NOT_A_MOOD_V2 = `- Not a passing figure, a question they asked, a mood, a joke, or anything they were plainly not stating about themselves ("suppose we had 2 million"). SMALL_TALK is the only kind for life outside work, and at most one per turn.`;

for (const anchor of [FACT_ABOUT_COMPANY_LINE, QUOTE_LINE, NOT_A_MOOD]) {
  if (MEMORY_EXTRACTOR_V1.template.split(anchor).length !== 2) {
    throw new Error("MEMORY_EXTRACTOR v2 extends v1 once per anchor");
  }
}

export const MEMORY_EXTRACTOR_V2: PromptDefinition<
  MemoryExtractorVariables,
  MemoryExtractorResultV2
> = {
  ...MEMORY_EXTRACTOR_V1,
  version: 2,
  status: "ACTIVE",
  changeDescription:
    "ADR 0062 (Q room R7): SMALL_TALK items (life mentioned in passing, with one short follow-up question), for the silence ladder's remembered thread. Personal-private, 90 days, never recalled into prompts.",
  effectiveFrom: "2026-10-06",
  output: {
    kind: "STRUCTURED",
    schemaName: MEMORY_EXTRACTOR_SCHEMA_NAME,
    schemaVersion: MEMORY_EXTRACTOR_V2_SCHEMA_VERSION,
    schema: MemoryExtractorResultV2Schema,
  },
  template: MEMORY_EXTRACTOR_V1.template
    .replace(FACT_ABOUT_COMPANY_LINE, SMALL_TALK_LINE)
    .replace(QUOTE_LINE, FOLLOW_UP_LINE)
    .replace(NOT_A_MOOD, NOT_A_MOOD_V2),
};
