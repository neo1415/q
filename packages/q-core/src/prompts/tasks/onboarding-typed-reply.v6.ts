import type { PromptDefinition } from "../definition.js";
import type {
  OnboardingTypedReplyResult,
  OnboardingTypedReplyVariables,
} from "../schemas/onboarding-typed-reply.js";
import { ONBOARDING_TYPED_REPLY_V5 } from "./onboarding-typed-reply.v5.js";

/**
 * ONBOARDING_TYPED_REPLY v6 — live check 2026-10-31 (production 84d8ede07,
 * fictional founder "Grannskap Harvest", typed):
 *
 * - One ramble covered what the company does, the problem, the solution and
 *   how it works. Q said back only the description; the problem, solution
 *   and how it works were each put to them later, one "yes" at a time. A
 *   say-back covers every (say back) topic their message told, needed or
 *   optional, in one message, so one yes settles them all.
 * - What Q says back is what is saved: "The problem you're addressing is
 *   that…" and "The process is: …" were saved with those lead-ins. Each
 *   topic is said back as its content, as it reads on their profile.
 * - "A bit under a year of runway" was asked again as "the runway in
 *   months". An approximate answer answers its topic.
 */
const V4_SAY_BACK =
  "- Topics marked (say back) are told at length. As soon as their latest message tells you about any of them, your message says back, in your own plain words, one short sentence a topic, what you understood, and asks if that's right; that is your one question this time, and asking is the id of the first of those topics. Capital Q saves exactly the words you said back once they agree, so write each as it should read on their profile, about them or their company, never a quote of their filler. A summary they have agreed to is settled: never ask about it again. When the checklist shows such a topic not confirmed yet and you have not said it back, say that summary back the same way.";
const V6_SAY_BACK =
  '- Topics marked (say back) are told at length. As soon as their latest message tells you about any of them, needed or optional, your message says back what you understood for EVERY such topic it told you, all in this one message, one short line a topic, and then asks once if that\'s right; that is your one question this time, and asking is the id of the first of those topics. One message often tells several (what the company does, the problem, the solution, how it works): say back each one it told, never one now and the others later, so their one yes settles them all. Capital Q saves the words you said back for each topic once they agree, so write each line as the topic\'s name and then its content as it should read on their profile, starting with a capital ("The problem: Small farms around…"), never framed as you telling them ("The problem you\'re addressing is that", "So your solution is") and never a quote of their filler. A summary they have agreed to is settled: never ask about it again. When the checklist shows such topics not confirmed yet and you have not said them back, say all of them back together the same way.';
const V5_ANSWERED =
  "A topic their latest message answered is answered: never ask it, acknowledge it briefly instead, and ask the next topic it did not answer (asking is that topic's id).";
const V6_ANSWERED = `${V5_ANSWERED} An approximate answer ("a bit under a year", "around a dozen") answers its topic: never ask it again for an exact number.`;
const V4_LENGTH =
  "- Two or three short sentences at most, ending with your one question; a say-back may take one short sentence a topic.";
const V6_LENGTH =
  "- Two or three short sentences at most, ending with your one question; a say-back takes one short line a topic it covers.";

for (const anchor of [V4_SAY_BACK, V5_ANSWERED, V4_LENGTH]) {
  if (!ONBOARDING_TYPED_REPLY_V5.template.includes(anchor)) {
    throw new Error(
      "ONBOARDING_TYPED_REPLY v6 extends v5, which lost an anchor",
    );
  }
}

export const ONBOARDING_TYPED_REPLY_V6: PromptDefinition<
  OnboardingTypedReplyVariables,
  OnboardingTypedReplyResult
> = {
  ...ONBOARDING_TYPED_REPLY_V5,
  version: 6,
  status: "ACTIVE",
  changeDescription:
    "Live check 2026-10-31 (84d8ede07): one say-back covers every told-at-length topic their message told, each as its content (no lead-in), so one yes settles them all; an approximate answer is never asked again.",
  effectiveFrom: "2026-10-31",
  template: ONBOARDING_TYPED_REPLY_V5.template
    .replace(V4_SAY_BACK, V6_SAY_BACK)
    .replace(V5_ANSWERED, V6_ANSWERED)
    .replace(V4_LENGTH, V6_LENGTH),
};
