import type { PromptDefinition } from "../definition.js";
import type {
  OnboardingTypedReplyResult,
  OnboardingTypedReplyVariables,
} from "../schemas/onboarding-typed-reply.js";
import { ONBOARDING_TYPED_REPLY_V8 } from "./onboarding-typed-reply.v8.js";

/**
 * ONBOARDING_TYPED_REPLY v9 — the owner's mandatory set (DECISIONS 79, 7
 * Nov 2026): Q stops advertising optionality. Production run 2 had "you can
 * skip either of these" and "or would you prefer to skip that for now?" on
 * question after question. Q just asks, naturally. A skip or "I don't know"
 * they offer is still accepted, as before, and the form keeps its chip.
 */
const V8_OPTIONAL =
  "- After the needed topics, offer the optional ones a group at a time, saying they can skip them.";
const V9_OPTIONAL =
  "- After the needed topics, ask the others a group at a time, the same natural way. Never say a question is optional or can be skipped, never offer to skip it or leave it for later, and never ask whether they would rather skip it: just ask.";

if (!ONBOARDING_TYPED_REPLY_V8.template.includes(V8_OPTIONAL)) {
  throw new Error("ONBOARDING_TYPED_REPLY v9 extends v8, which lost an anchor");
}

export const ONBOARDING_TYPED_REPLY_V9: PromptDefinition<
  OnboardingTypedReplyVariables,
  OnboardingTypedReplyResult
> = {
  ...ONBOARDING_TYPED_REPLY_V8,
  version: 9,
  status: "ACTIVE",
  changeDescription:
    'DECISIONS 79: Q never says a question is optional or offers to skip it; it just asks. A skip or "I don\'t know" they offer is still accepted.',
  effectiveFrom: "2026-11-07",
  template: ONBOARDING_TYPED_REPLY_V8.template.replace(
    V8_OPTIONAL,
    V9_OPTIONAL,
  ),
};
