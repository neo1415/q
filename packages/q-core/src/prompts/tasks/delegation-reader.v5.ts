import type { PromptDefinition } from "../definition.js";
import {
  DELEGATION_READER_UNTRUSTED,
  DelegationReaderV4VariablesSchema,
  type DelegationReaderV3Result,
  type DelegationReaderV4Variables,
} from "../schemas/delegation-reader.js";
import { DELEGATION_READER_V4 } from "./delegation-reader.v4.js";

/**
 * DELEGATION_READER v5 — v4, without over-reading a short answer
 * (HANDOVER §5.3, bench 2026-09-30: an angel's bare "invest" was read as
 * stating the investor type, and "Venture capital fund" was recorded until
 * he corrected it). v4 lets a one-word answer state the step Q asked; this
 * version says what such a word can and cannot state. A concept, never a
 * word list: the reading is still the model's.
 */
const V4_RULE_ANCHOR =
  "- Asking Q to find their own answer from public sources";

const V5_RULES = `- A short answer states only what it names or plainly means. A word that repeats the question's own topic, or answers a different question (why they are here, raise or invest), does not choose among a step's options: it states nothing for that step, and Q asks again. Never fill a type, stage, amount or other choice from what a short answer leaves open.
`;

if (!DELEGATION_READER_V4.template.includes(V4_RULE_ANCHOR)) {
  throw new Error("DELEGATION_READER v5 extends v4, which lost an anchor");
}

export const DELEGATION_READER_V5: PromptDefinition<
  DelegationReaderV4Variables,
  DelegationReaderV3Result
> = {
  ...DELEGATION_READER_V4,
  version: 5,
  status: "ACTIVE",
  changeDescription:
    "HANDOVER §5.3: a short answer states only what it names or plainly means; a word repeating the question's topic or answering another question chooses nothing.",
  effectiveFrom: "2026-10-01",
  variables: {
    schema: DelegationReaderV4VariablesSchema,
    untrusted: [...DELEGATION_READER_UNTRUSTED],
  },
  template: DELEGATION_READER_V4.template.replace(
    V4_RULE_ANCHOR,
    `${V5_RULES}${V4_RULE_ANCHOR}`,
  ),
};
