import type { PromptDefinition } from "../definition.js";
import {
  DELEGATION_READER_UNTRUSTED,
  DelegationReaderV4VariablesSchema,
  type DelegationReaderV3Result,
  type DelegationReaderV4Variables,
} from "../schemas/delegation-reader.js";
import { DELEGATION_READER_V5 } from "./delegation-reader.v5.js";

/**
 * DELEGATION_READER v6 — v5, with a decline read whether or not the step
 * is required (live 2026-10-28, investor ca3626ab: "skip that one" to the
 * discovery-mode question, a required step, was read as declining
 * nothing; the acting model then set aside the wrong step, and the same
 * question came back after "hold on, my dog is barking"). The reader
 * reports what their words do; the journey decides what a decline of a
 * required step means (it stays open, and is listed when they finish).
 */
const V5_DECLINE_RULE =
  "- Declined: the optional steps they decline to answer — they say they have no preference, nothing applies, or they would rather not say — as their answer, not as a question. Required steps are never declined.";

const V6_DECLINE_RULE =
  "- Declined: the steps they decline to answer for now — they say they have no preference, nothing applies, they would rather not say, or to skip or leave it for now — as their answer, not as a question. A required step can be declined for now too: report it; the journey decides what that means.";

if (!DELEGATION_READER_V5.template.includes(V5_DECLINE_RULE)) {
  throw new Error("DELEGATION_READER v6 extends v5, which lost an anchor");
}

export const DELEGATION_READER_V6: PromptDefinition<
  DelegationReaderV4Variables,
  DelegationReaderV3Result
> = {
  ...DELEGATION_READER_V5,
  version: 6,
  status: "DEPRECATED",
  changeDescription:
    "Typed onboarding 2026-10-28 (D5): a decline is read for a required step too; the journey, not the reader, decides what it means.",
  effectiveFrom: "2026-10-28",
  variables: {
    schema: DelegationReaderV4VariablesSchema,
    untrusted: [...DELEGATION_READER_UNTRUSTED],
  },
  template: DELEGATION_READER_V5.template.replace(
    V5_DECLINE_RULE,
    V6_DECLINE_RULE,
  ),
};
