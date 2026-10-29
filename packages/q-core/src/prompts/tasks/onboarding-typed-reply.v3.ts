import type { PromptDefinition } from "../definition.js";
import type {
  OnboardingTypedReplyResult,
  OnboardingTypedReplyVariables,
} from "../schemas/onboarding-typed-reply.js";
import { ONBOARDING_TYPED_REPLY_V2 } from "./onboarding-typed-reply.v2.js";

/**
 * ONBOARDING_TYPED_REPLY v3 — live 2026-10-29: every typed reply said
 * asking=null. The checklist carried no ids, and the template's own
 * example answer showed "asking": null, which the model copied. A paused
 * setup then reopened on the wrong question (team size instead of the
 * full-time question it had asked three times). The checklist now carries
 * each topic's id (typed only), and asking is required whenever the reply
 * asks something.
 */
const V2_ASKING =
  "- asking: the stepKey of the checklist topic your question asks, or null.";
const V3_ASKING =
  "- asking: whenever your message asks about a checklist topic, the id shown beside that topic (for example F2.full_time); null only when your message asks nothing from the checklist. Ids are for this field only: never write an id in your message.";
const V2_EXAMPLE =
  'Respond with a single JSON object {"reply": "...", "asking": null, "readBack": false}.';
const V3_EXAMPLE =
  'Respond with a single JSON object {"reply": "...", "asking": "<the id of the topic your question asks, or null>", "readBack": false}.';

for (const anchor of [V2_ASKING, V2_EXAMPLE]) {
  if (!ONBOARDING_TYPED_REPLY_V2.template.includes(anchor)) {
    throw new Error(
      "ONBOARDING_TYPED_REPLY v3 extends v2, which lost an anchor",
    );
  }
}

export const ONBOARDING_TYPED_REPLY_V3: PromptDefinition<
  OnboardingTypedReplyVariables,
  OnboardingTypedReplyResult
> = {
  ...ONBOARDING_TYPED_REPLY_V2,
  version: 3,
  status: "ACTIVE",
  changeDescription:
    "Live 2026-10-29: the reply names the checklist id its question asks (ids now shown, the null example removed), so a reopened setup asks the question that was open.",
  effectiveFrom: "2026-10-29",
  template: ONBOARDING_TYPED_REPLY_V2.template
    .replace(V2_ASKING, V3_ASKING)
    .replace(V2_EXAMPLE, V3_EXAMPLE),
};
