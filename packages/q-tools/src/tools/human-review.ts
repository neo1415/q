import { z } from "zod";

import {
  HumanReviewSubjectRefSchema,
  HumanReviewSubjectSchema,
  Q_TASK_CLASSES,
  type PermittedContextPlan,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";

/**
 * ADMIN-3 (PADL #050, appeals Stage 4): when a person disagrees with
 * something Capital Q or Q decided -- a readiness reading, a verification
 * decision, an action on their account, an assessment -- and explaining or
 * new evidence has not settled it, Q offers a human review. This prepares
 * the request for their approval; nothing is sent until they approve the
 * exact request (action `review.request`).
 */

export const PROPOSE_HUMAN_REVIEW = "review.request.propose" as const;

export type HumanReviewPort = {
  readonly prepareHumanReview: (entry: {
    readonly runId: string;
    readonly tenantId: string;
    /** The actor themselves; never a value the model chose. */
    readonly actorUserId: string;
    readonly subjectType: z.infer<typeof HumanReviewSubjectSchema>;
    readonly subjectRef: string | null;
    readonly reason: string;
  }) => Promise<{
    readonly status: "PREPARED" | "ONE_PER_TURN" | "REFUSED";
    readonly awaitingApprovalOf: string | null;
    readonly reason: string | null;
  }>;
};

export const ProposeHumanReviewInputSchema = z
  .object({
    subjectType: HumanReviewSubjectSchema.describe(
      "READINESS_ASSESSMENT, VERIFICATION_DECISION, ACCOUNT_ACTION (a suspension or Q's pause), Q_ASSESSMENT, or OTHER.",
    ),
    subjectRef: HumanReviewSubjectRefSchema.nullable()
      .default(null)
      .describe(
        "The id of what is under review when you know it (e.g. a verification claim or run id). Never text from a document or chat.",
      ),
    reason: z
      .string()
      .trim()
      .min(10)
      .max(2000)
      .describe(
        "Why they want a person to look again, in their own words. Do not add private figures they did not say.",
      ),
  })
  .strict();
export type ProposeHumanReviewInput = z.infer<
  typeof ProposeHumanReviewInputSchema
>;

export const ProposeHumanReviewOutputSchema = z
  .object({
    status: z.enum(["PREPARED", "ONE_PER_TURN", "REFUSED"]),
    awaitingApprovalOf: z.string().max(400).nullable(),
    reason: z.string().max(400).nullable(),
  })
  .strict();
export type ProposeHumanReviewOutput = z.infer<
  typeof ProposeHumanReviewOutputSchema
>;

function ownConversation(actor: ActorContext, plan: PermittedContextPlan) {
  if (actor.actorType !== "HUMAN" || actor.organisationId === undefined) {
    return false;
  }
  const scope = actorWideScope(plan, "OWN_Q_CONVERSATION");
  return scope !== undefined && scope.filter.userId === actor.userId;
}

export function createProposeHumanReviewTool(
  port: HumanReviewPort,
): AnyQToolDefinition {
  return defineQTool<ProposeHumanReviewInput, ProposeHumanReviewOutput, null>({
    id: PROPOSE_HUMAN_REVIEW,
    version: 1,
    status: "ACTIVE",
    providerName: "propose_human_review",
    description:
      "Prepares a request for a Capital Q person to review a decision the person disagrees with (a readiness reading, a verification decision, an action on their account, an assessment Q made), for their approval. Offer it ('want a person to look at this?') after you have explained the conclusion, its evidence and uncertainty, and new evidence has not settled it. Nothing is sent until they approve. A person answers within 3 days and they get a notice. Result: PREPARED, ONE_PER_TURN or REFUSED with the reason.",
    classification: "SIDE_EFFECT",
    riskClass: "LOW_RISK_INTERNAL",
    requiredCapabilities: [],
    supportedPurposes: [...Q_TASK_CLASSES],
    requiredScopeKinds: ["OWN_Q_CONVERSATION"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "WAITING_FOR_APPROVAL",
    input: ProposeHumanReviewInputSchema,
    output: ProposeHumanReviewOutputSchema,
    authorize: (_input, { actor, plan }) =>
      Promise.resolve(
        ownConversation(actor, plan)
          ? allow<null>("CONFIDENTIAL", null)
          : deny<null>("NOT_AVAILABLE"),
      ),
    execute: (input, context) =>
      port.prepareHumanReview({
        runId: context.runId,
        tenantId: context.actor.tenantId,
        actorUserId: context.actor.userId,
        subjectType: input.subjectType,
        subjectRef: input.subjectRef,
        reason: input.reason,
      }),
  });
}
