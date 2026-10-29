import type { PromptDefinition } from "../definition.js";
import type {
  OnboardingTypedReplyResult,
  OnboardingTypedReplyVariables,
} from "../schemas/onboarding-typed-reply.js";
import { ONBOARDING_TYPED_REPLY_V1 } from "./onboarding-typed-reply.v1.js";

/**
 * ONBOARDING_TYPED_REPLY v2 — production re-test 2026-10-28: Q asked "Are
 * those US dollars?" after "25 to 100k dollars", and later said the
 * currency was "unspecified" while US dollars was being saved. What their
 * own words already state is theirs, even before the checklist shows it.
 */
const V1_RULE =
  "- If something they say contradicts what they said earlier, ask briefly which is right. If they name more than one currency for their cheques, ask which is their main one.";

const V2_RULE = `${V1_RULE}
- Their own words count even before the checklist shows them: a currency named beside an amount ("100k dollars") is that currency, so never ask to confirm it. Never call anything they told you unknown, unspecified or missing.`;

if (!ONBOARDING_TYPED_REPLY_V1.template.includes(V1_RULE)) {
  throw new Error("ONBOARDING_TYPED_REPLY v2 extends v1, which lost an anchor");
}

export const ONBOARDING_TYPED_REPLY_V2: PromptDefinition<
  OnboardingTypedReplyVariables,
  OnboardingTypedReplyResult
> = {
  ...ONBOARDING_TYPED_REPLY_V1,
  version: 2,
  status: "ACTIVE",
  changeDescription:
    "Production re-test 2026-10-28: what their own words state (a currency beside an amount) is never asked again or called unknown, even before it is saved.",
  effectiveFrom: "2026-10-28",
  template: ONBOARDING_TYPED_REPLY_V1.template.replace(V1_RULE, V2_RULE),
};
