import type { PromptDefinition } from "../definition.js";
import type {
  OnboardingTypedReplyResult,
  OnboardingTypedReplyVariables,
} from "../schemas/onboarding-typed-reply.js";
import { ONBOARDING_TYPED_REPLY_V7 } from "./onboarding-typed-reply.v7.js";

/**
 * ONBOARDING_TYPED_REPLY v8 — onboarding P1-1 (DECISIONS 77; approved by
 * the integration owner): Q judges when to summarise, and never summarises
 * every time. A clear answer (typed or spoken, any length) is kept in their
 * own words with only filler removed (ONBOARDING_TRANSCRIPT_READER v14), so
 * it is acknowledged, never said back. A rambling one is said back for
 * their yes, as before, and so is every summary waiting for it (not
 * confirmed yet). An answer already saved needs no say-back.
 */
const V7_SAY_BACK_START =
  "- Topics marked (say back) are told at length. As soon as their latest message tells you about any of them, needed or optional, your message says back what you understood for EVERY such topic it told you,";
const V8_SAY_BACK_START =
  "- Topics marked (say back) are told at length, and Capital Q judges how each was told. A clear answer, typed or spoken, whatever its length, is kept in their own words with only filler removed: never say it back, acknowledge it briefly and go on. When their latest message told any of them in a rambling way (repeating itself, backtracking, wandering), needed or optional, your message says back what you understood for EVERY such topic it told you,";
const V7_SAY_BACK_END =
  "When the checklist shows such topics not confirmed yet and you have not said them back, say all of them back together the same way.";
const V8_SAY_BACK_END = `${V7_SAY_BACK_END} A summary not confirmed yet always waits for their yes; an answer already saved needs no say-back.`;

for (const anchor of [V7_SAY_BACK_START, V7_SAY_BACK_END]) {
  if (!ONBOARDING_TYPED_REPLY_V7.template.includes(anchor)) {
    throw new Error(
      "ONBOARDING_TYPED_REPLY v8 extends v7, which lost an anchor",
    );
  }
}

export const ONBOARDING_TYPED_REPLY_V8: PromptDefinition<
  OnboardingTypedReplyVariables,
  OnboardingTypedReplyResult
> = {
  ...ONBOARDING_TYPED_REPLY_V7,
  version: 8,
  status: "ACTIVE",
  changeDescription:
    "Onboarding P1-1 (DECISIONS 77): a clear long answer is kept in their words and never said back; only a rambling one, or a summary not confirmed yet, is said back for their yes.",
  effectiveFrom: "2026-11-07",
  template: ONBOARDING_TYPED_REPLY_V7.template
    .replace(V7_SAY_BACK_START, V8_SAY_BACK_START)
    .replace(V7_SAY_BACK_END, V8_SAY_BACK_END),
};
