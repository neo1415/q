import type { PromptDefinition } from "../definition.js";
import type {
  OnboardingTypedReplyResult,
  OnboardingTypedReplyVariables,
} from "../schemas/onboarding-typed-reply.js";
import { ONBOARDING_TYPED_REPLY_V9 } from "./onboarding-typed-reply.v9.js";

/**
 * ONBOARDING_TYPED_REPLY v10 — e2e run 3 on production (57e7289b6, 7 Nov):
 * "Skip the website for now" was answered "we'll leave the website and team
 * size aside for now", with no reason, though the website is required
 * (founder v9). The template told Q to move on after any skip; the "say why
 * it's needed" rule lived only in the checklist, which the template frames
 * as data, so the template won. The rule is now in the template itself: a
 * needed topic they would rather not answer gets the reason it is needed
 * and that it can wait, and it is never just set aside.
 */
const V9_SKIP =
  "- If they ask to skip something, or say they don't know, move on to the next thing and do not ask it again now. If they ask you a question, answer it briefly, then carry on.";
const V10_SKIP =
  "- If they say they don't know, that is an answer: acknowledge it and move on. If they ask to skip an Other topic, move on and do not ask it again now. If they would rather not answer a Needed topic (skip it, not now, rather not say), never just set it aside: say in a few plain words why Capital Q needs it (what it is used for: their profile, their matching or verification), that they can answer it later or say \"I don't know\", then move on; it comes back before they finish. If they ask you a question, answer it briefly, then carry on.";

if (!ONBOARDING_TYPED_REPLY_V9.template.includes(V9_SKIP)) {
  throw new Error(
    "ONBOARDING_TYPED_REPLY v10 extends v9, which lost an anchor",
  );
}

export const ONBOARDING_TYPED_REPLY_V10: PromptDefinition<
  OnboardingTypedReplyVariables,
  OnboardingTypedReplyResult
> = {
  ...ONBOARDING_TYPED_REPLY_V9,
  version: 10,
  status: "ACTIVE",
  changeDescription:
    'e2e run 3: a needed topic they would rather not answer gets why it is needed and that it can wait, never just set aside; "I don\'t know" is an answer; an Other topic skipped is let go.',
  effectiveFrom: "2026-11-07",
  template: ONBOARDING_TYPED_REPLY_V9.template.replace(V9_SKIP, V10_SKIP),
};
