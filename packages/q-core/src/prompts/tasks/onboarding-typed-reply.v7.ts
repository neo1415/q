import type { PromptDefinition } from "../definition.js";
import type {
  OnboardingTypedReplyResult,
  OnboardingTypedReplyVariables,
} from "../schemas/onboarding-typed-reply.js";
import { ONBOARDING_TYPED_REPLY_V6 } from "./onboarding-typed-reply.v6.js";

/**
 * ONBOARDING_TYPED_REPLY v7 — live check 2026-10-31 (production d6f606053,
 * fictional founder "Lobbykylm Lockers" and investor "Nordlicht Saatgut
 * Capital", typed):
 *
 * - "We are raising 1.2 million euros" was said to a question about
 *   traction; two messages later the checklist still showed the raise as
 *   not covered and Q asked "Are you actively raising now?". Anything they
 *   told Q anywhere in the conversation is answered, whatever the
 *   checklist shows.
 * - "Only well-matched inbound please", said unasked, was held for their
 *   yes; Q then asked the inbound question from scratch. A value not
 *   confirmed yet that came from their own words is put to them for their
 *   yes, never asked again.
 */
const ANSWERED =
  "A topic their latest message answered is answered: never ask it, acknowledge it briefly instead, and ask the next topic it did not answer (asking is that topic's id).";
const V7_ANSWERED_LAG = `${ANSWERED} The checklist can lag a message or two behind the conversation: a topic they told you about anywhere in the conversation, even in answer to a different question, is answered whatever the checklist shows; never ask it.`;
const V6_FOUND =
  "- When the checklist says something was found in their documents or public pages, say briefly what was found and ask if it's right; don't ask those things again.";
const V7_FOUND = `${V6_FOUND}
- When the checklist shows a value not confirmed yet that Q found in their own words, never ask that topic from scratch: when you come to it, put that value to them in a few words and ask if you should keep it (asking is its id).`;

for (const anchor of [ANSWERED, V6_FOUND]) {
  if (!ONBOARDING_TYPED_REPLY_V6.template.includes(anchor)) {
    throw new Error(
      "ONBOARDING_TYPED_REPLY v7 extends v6, which lost an anchor",
    );
  }
}

export const ONBOARDING_TYPED_REPLY_V7: PromptDefinition<
  OnboardingTypedReplyVariables,
  OnboardingTypedReplyResult
> = {
  ...ONBOARDING_TYPED_REPLY_V6,
  version: 7,
  status: "ACTIVE",
  changeDescription:
    "Live check 2026-10-31 (d6f606053): a topic told anywhere in the conversation is answered whatever the lagging checklist shows; a held value from their own words is put to them for their yes, never asked from scratch.",
  effectiveFrom: "2026-10-31",
  template: ONBOARDING_TYPED_REPLY_V6.template
    .replace(ANSWERED, V7_ANSWERED_LAG)
    .replace(V6_FOUND, V7_FOUND),
};
