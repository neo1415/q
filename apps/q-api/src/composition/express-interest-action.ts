import { z } from "zod";

import {
  QActionTypeSchema,
  UuidSchema,
  type QSubjectRef,
} from "@capital-q/contracts";
import type { InterestService } from "@capital-q/network";
import type { Logger } from "@capital-q/observability";
import { defineQAction, type AnyQActionDefinition } from "@capital-q/q-actions";

/**
 * Express Interest, by Q (CQ-NET-010).
 *
 * The same command the feed's button calls — the Network context's
 * `expressInterest`, with its own capability check, visibility rule,
 * idempotency record, canonical relationship, history event and outbox —
 * reached through the Approval Engine: prepared, recommended, approved by
 * the person against this exact company, executed under the approver's
 * authority. Q gains nothing because it prepared it.
 *
 * The execution's idempotency key is the approved action's own, so a
 * retried execution of one approval is one interest, and an interest
 * already expressed from the feed is the same no-op here.
 *
 * Interest ≠ Match: nothing here connects, matches or messages anyone.
 */

export const RELATIONSHIP_INTEREST_EXPRESS = QActionTypeSchema.parse(
  "relationship.interest.express",
);

export const ExpressInterestPayloadSchema = z
  .object({
    companyId: UuidSchema,
    /** Shown to the approver; the binding is the id. */
    companyName: z.string().trim().min(1).max(200),
  })
  .strict();
export type ExpressInterestPayload = z.infer<
  typeof ExpressInterestPayloadSchema
>;

export const ExpressInterestResultSchema = z
  .object({
    interestId: UuidSchema,
    relationshipId: UuidSchema,
    alreadyExpressed: z.boolean(),
  })
  .strict();
export type ExpressInterestResult = z.infer<typeof ExpressInterestResultSchema>;

export function createExpressInterestAction(dependencies: {
  readonly interests: InterestService;
  readonly logger?: Logger | undefined;
}): AnyQActionDefinition {
  const { interests, logger } = dependencies;
  return defineQAction<ExpressInterestPayload, ExpressInterestResult>({
    actionType: RELATIONSHIP_INTEREST_EXPRESS,
    version: 1,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-api",
    description:
      "Expresses the approver's investor organisation's interest in one company, exactly as approved, through the Network context's Express Interest command.",
    payload: ExpressInterestPayloadSchema,
    result: ExpressInterestResultSchema,
    targets: (payload): readonly QSubjectRef[] => [
      { kind: "COMPANY", companyId: payload.companyId },
    ],
    // Doc 17 §70: what it means, and that it is not a commitment.
    describe: (payload) => ({
      summary: `Express interest in ${payload.companyName}`,
      preview: `This tells ${payload.companyName}'s founders your organisation would like to explore the company. It is not a commitment to invest, and it does not connect you or share anything else.`,
    }),
    confirm: (payload, result) =>
      result.alreadyExpressed
        ? `Your organisation had already expressed interest in ${payload.companyName}; nothing new was sent.`
        : `Done. Your organisation's interest in ${payload.companyName} is recorded.`,
    authorize: async (payload, actor) => {
      if (actor.actorType !== "HUMAN") {
        return { outcome: "DENY", code: "NOT_A_PERSON" };
      }
      // The command's own question, asked without writing: investor
      // organisation, capability and visibility. Every "no" is one answer.
      return (await interests.mayExpressInterest({
        actor,
        companyId: payload.companyId,
      }))
        ? { outcome: "ALLOW" }
        : { outcome: "DENY", code: "NOT_AVAILABLE" };
    },
    executor: {
      execute: async (action, context) => {
        try {
          const result = await interests.expressInterest({
            actor: context.approver,
            companyId: action.payload.companyId,
            surface: "Q_CONVERSATION",
            idempotencyKey: `q-action:${action.idempotencyKey}`,
            correlationId: context.correlationId,
          });
          return {
            outcome: "EXECUTED",
            result: {
              interestId: result.interest.id,
              relationshipId: result.interest.relationshipId,
              alreadyExpressed: result.deduplicated,
            },
          };
        } catch (error: unknown) {
          logger?.warn(
            { err: error, actionId: action.actionId, attempt: context.attempt },
            "express interest was not applied",
          );
          return {
            outcome: "FAILED",
            failureCode: "INTEREST_REFUSED",
            retryable: false,
          };
        }
      },
    },
  });
}
