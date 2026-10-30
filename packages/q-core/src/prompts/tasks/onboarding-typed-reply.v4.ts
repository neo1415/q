import type { PromptDefinition } from "../definition.js";
import type {
  OnboardingTypedReplyResult,
  OnboardingTypedReplyVariables,
} from "../schemas/onboarding-typed-reply.js";
import { ONBOARDING_TYPED_REPLY_V3 } from "./onboarding-typed-reply.v3.js";

/**
 * ONBOARDING_TYPED_REPLY v4 — live 2026-10-30 (production 92a12534c,
 * Granary): a founder typed a long answer about what the company does and
 * how it makes money; Q replied "That gives me a clear picture" and moved
 * on to the raise. Nothing was said back, the summary appeared only as a
 * card beside the conversation, and the raw words were later saved. The
 * agreed behaviour (owner 2026-10-17, "NEM Insurance"): a long answer is
 * said back in Q's words at once, they confirm, and what they confirmed is
 * what is saved. The reading of their agreement stays the transcript
 * reader's, by meaning.
 */
const V3_FOUND =
  "- When the checklist says something was found in their documents or public pages, say briefly what was found and ask if it's right; don't ask those things again.";
const V4_FOUND = `${V3_FOUND}
- Topics marked (say back) are told at length. As soon as their latest message tells you about any of them, your message says back, in your own plain words, one short sentence a topic, what you understood, and asks if that's right; that is your one question this time, and asking is the id of the first of those topics. Capital Q saves exactly the words you said back once they agree, so write each as it should read on their profile, about them or their company, never a quote of their filler. A summary they have agreed to is settled: never ask about it again. When the checklist shows such a topic not confirmed yet and you have not said it back, say that summary back the same way.`;
const V3_LENGTH =
  "- Two or three short sentences at most, ending with your one question.";
const V4_LENGTH =
  "- Two or three short sentences at most, ending with your one question; a say-back may take one short sentence a topic.";

for (const anchor of [V3_FOUND, V3_LENGTH]) {
  if (!ONBOARDING_TYPED_REPLY_V3.template.includes(anchor)) {
    throw new Error(
      "ONBOARDING_TYPED_REPLY v4 extends v3, which lost an anchor",
    );
  }
}

export const ONBOARDING_TYPED_REPLY_V4: PromptDefinition<
  OnboardingTypedReplyVariables,
  OnboardingTypedReplyResult
> = {
  ...ONBOARDING_TYPED_REPLY_V3,
  version: 4,
  status: "ACTIVE",
  changeDescription:
    "Live 2026-10-30 (Granary): a long answer (say back topics) is said back in Q's words at once for their yes, and what they agree to is what is saved.",
  effectiveFrom: "2026-10-30",
  template: ONBOARDING_TYPED_REPLY_V3.template
    .replace(V3_FOUND, V4_FOUND)
    .replace(V3_LENGTH, V4_LENGTH),
};
