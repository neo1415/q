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
 * Accept or decline an investor's interest, by Q (CQ-NET-011).
 *
 * The same command the founder's inbox calls -- the Network context's
 * `respondToInterest`, with its company-membership check, capability,
 * idempotency record, history event on the one canonical relationship,
 * match (for an acceptance) and outbox -- reached through the Approval
 * Engine: prepared, approved by a company member against this exact
 * interest and answer, executed as that approver. Q gains nothing because
 * it prepared it, and the answer is bound: approving "accept" can never
 * execute "decline".
 *
 * No message is sent and no reason is recorded (CQ-COMM-001 is deferred).
 */

export const RELATIONSHIP_INTEREST_RESPOND = QActionTypeSchema.parse(
  "relationship.interest.respond",
);

export const RespondToInterestPayloadSchema = z
  .object({
    interestId: UuidSchema,
    /** The company whose inbox holds the interest: the action's target. */
    companyId: UuidSchema,
    decision: z.enum(["ACCEPTED", "DECLINED"]),
    /** Shown to the approver; the binding is the interest id. */
    investorName: z.string().trim().min(1).max(200),
  })
  .strict();
export type RespondToInterestPayload = z.infer<
  typeof RespondToInterestPayloadSchema
>;

export const RespondToInterestResultSchema = z
  .object({
    interestId: UuidSchema,
    decision: z.enum(["ACCEPTED", "DECLINED"]),
    connectionId: UuidSchema.nullable(),
    alreadyAnswered: z.boolean(),
  })
  .strict();
export type RespondToInterestResult = z.infer<
  typeof RespondToInterestResultSchema
>;

export function createRespondToInterestAction(dependencies: {
  readonly interests: InterestService;
  readonly logger?: Logger | undefined;
}): AnyQActionDefinition {
  const { interests, logger } = dependencies;
  return defineQAction<RespondToInterestPayload, RespondToInterestResult>({
    actionType: RELATIONSHIP_INTEREST_RESPOND,
    version: 1,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-api",
    description:
      "Accepts or declines one investor organisation's interest in the approver's company, exactly as approved, through the Network context's answer command.",
    payload: RespondToInterestPayloadSchema,
    result: RespondToInterestResultSchema,
    targets: (payload): readonly QSubjectRef[] => [
      { kind: "COMPANY", companyId: payload.companyId },
    ],
    // Doc 17 §85: institutional, never "It's a match!".
    describe: (payload) =>
      payload.decision === "ACCEPTED"
        ? {
            summary: `Accept ${payload.investorName}'s interest`,
            preview: `Both sides will have agreed to connect: ${payload.investorName} will see that your company accepted. It is not an investment, and nothing else is shared.`,
          }
        : {
            summary: `Decline ${payload.investorName}'s interest`,
            preview: `${payload.investorName} will see that your company has not taken this forward. No reason is recorded or shared.`,
          },
    confirm: (payload, result) =>
      result.alreadyAnswered
        ? `That interest from ${payload.investorName} had already been answered; nothing changed.`
        : payload.decision === "ACCEPTED"
          ? `Done. You and ${payload.investorName} are connected.`
          : `Done. ${payload.investorName}'s interest is marked as not taken forward.`,
    authorize: async (payload, actor) => {
      if (actor.actorType !== "HUMAN") {
        return { outcome: "DENY", code: "NOT_A_PERSON" };
      }
      // The command's own question, plus the binding: the interest must be
      // in THIS company's inbox, so an approval shown for one company can
      // never answer another's.
      const may = await interests.mayRespondToInterest({
        actor,
        interestId: payload.interestId,
      });
      if (!may) return { outcome: "DENY", code: "NOT_AVAILABLE" };
      const inbox = await interests
        .listIncomingInterest({ actor, companyId: payload.companyId })
        .catch(() => []);
      return inbox.some((entry) => entry.interest.id === payload.interestId)
        ? { outcome: "ALLOW" }
        : { outcome: "DENY", code: "NOT_AVAILABLE" };
    },
    executor: {
      execute: async (action, context) => {
        try {
          const result = await interests.respondToInterest({
            actor: context.approver,
            interestId: action.payload.interestId,
            decision: action.payload.decision,
            surface: "Q_CONVERSATION",
            idempotencyKey: `q-action:${action.idempotencyKey}`,
            correlationId: context.correlationId,
          });
          return {
            outcome: "EXECUTED",
            result: {
              interestId: result.interest.id,
              decision: action.payload.decision,
              connectionId: result.interest.connection?.id ?? null,
              alreadyAnswered: result.deduplicated,
            },
          };
        } catch (error: unknown) {
          logger?.warn(
            { err: error, actionId: action.actionId, attempt: context.attempt },
            "the answer to an interest was not applied",
          );
          return {
            outcome: "FAILED",
            failureCode: "INTEREST_ANSWER_REFUSED",
            retryable: false,
          };
        }
      },
    },
  });
}
