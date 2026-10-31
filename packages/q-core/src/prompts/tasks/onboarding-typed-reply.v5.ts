import type { PromptDefinition } from "../definition.js";
import type {
  OnboardingTypedReplyResult,
  OnboardingTypedReplyVariables,
} from "../schemas/onboarding-typed-reply.js";
import { ONBOARDING_TYPED_REPLY_V4 } from "./onboarding-typed-reply.v4.js";

/**
 * ONBOARDING_TYPED_REPLY v5 — live final re-check 2026-10-31 (production
 * 68ab54317): waiting for the reading of their words before Q replied made
 * typed turns 12 s at the median (commit 323789973). Q replies at once
 * again, so the checklist is the record from BEFORE their latest message:
 * what that message just answered still shows as not covered. The reply
 * model reads their message itself; a topic it answered is not asked.
 * (Code also follows up when the reading lands after a reply asked a topic
 * the same words had answered: typed-onboarding.ts.)
 */
const V4_READ_ALL =
  "- Read everything they wrote: one message often covers several things. Never ask about something they already told you in this conversation, or that the checklist shows as saved or still saving.";
const V5_READ_ALL = `${V4_READ_ALL}
- The checklist is the record from before their latest message: what that message just told you is saved after you reply, so it may still show as not covered. A topic their latest message answered is answered: never ask it, acknowledge it briefly instead, and ask the next topic it did not answer (asking is that topic's id).`;

if (!ONBOARDING_TYPED_REPLY_V4.template.includes(V4_READ_ALL)) {
  throw new Error("ONBOARDING_TYPED_REPLY v5 extends v4, which lost an anchor");
}

export const ONBOARDING_TYPED_REPLY_V5: PromptDefinition<
  OnboardingTypedReplyVariables,
  OnboardingTypedReplyResult
> = {
  ...ONBOARDING_TYPED_REPLY_V4,
  version: 5,
  status: "ACTIVE",
  changeDescription:
    "Live final re-check 2026-10-31 (68ab54317): Q replies without waiting for the reading, so the checklist predates their latest message; a topic that message answered is acknowledged, never asked.",
  effectiveFrom: "2026-10-31",
  template: ONBOARDING_TYPED_REPLY_V4.template.replace(
    V4_READ_ALL,
    V5_READ_ALL,
  ),
};
