import { z } from "zod";

import {
  ChatMessageBodySchema,
  QActionTypeSchema,
  UuidSchema,
  type QSubjectRef,
} from "@capital-q/contracts";
import type { ConnectionService } from "@capital-q/network";
import type { Logger } from "@capital-q/observability";
import { defineQAction, type AnyQActionDefinition } from "@capital-q/q-actions";
import { connectionAnswerSummary } from "@capital-q/q-tools";

import type { ChatService } from "@capital-q/communication";

/**
 * An investor's answer to a company's Connection Request, with Q's opening
 * message, as ONE approval (live 2026-10-02, Zino: "accept their connection
 * and send them a message").
 *
 * The answer is the Network context's own respondToConnectionRequest -- the
 * command the Company requests screen calls, with its investor capability,
 * idempotency and history event -- executed as the approver. On acceptance
 * the approved message, word for word, is then posted on the now-connected
 * relationship through the same chat send the person's own Send uses. The
 * answer is bound to the interest id; the message to the relationship the
 * interest belongs to. Approving one company's request can never answer
 * another's.
 *
 * Both steps are idempotent on the action's key, so a retried execution
 * answers once and posts once. If the acceptance succeeds and the message
 * cannot be posted, the result says so (the connection stands).
 */

export const RELATIONSHIP_CONNECTION_REQUEST_RESPOND = QActionTypeSchema.parse(
  "relationship.connection_request.respond",
);

export const ConnectionRequestAnswerPayloadSchema = z
  .object({
    interestId: UuidSchema,
    companyId: UuidSchema,
    relationshipId: UuidSchema,
    /** Shown to the approver; the binding is the interest id. */
    companyName: z.string().trim().min(1).max(200),
    decision: z.enum(["ACCEPTED", "DECLINED"]),
    openingMessage: ChatMessageBodySchema.nullable(),
  })
  .strict()
  .refine(
    (payload) =>
      payload.decision === "ACCEPTED" || payload.openingMessage === null,
    { message: "a declined request carries no message" },
  );
export type ConnectionRequestAnswerPayload = z.infer<
  typeof ConnectionRequestAnswerPayloadSchema
>;

export const ConnectionRequestAnswerResultSchema = z
  .object({
    interestId: UuidSchema,
    decision: z.enum(["ACCEPTED", "DECLINED"]),
    alreadyAnswered: z.boolean(),
    messageSent: z.boolean(),
    /** Why the message was not posted, when it was asked for and was not. */
    messageFailure: z.string().max(64).nullable(),
  })
  .strict();
export type ConnectionRequestAnswerResult = z.infer<
  typeof ConnectionRequestAnswerResultSchema
>;

export function createConnectionRequestAnswerAction(dependencies: {
  readonly connections: Pick<
    ConnectionService,
    "listConnectionRequests" | "respondToConnectionRequest"
  >;
  readonly chat: Pick<ChatService, "send">;
  readonly logger?: Logger | undefined;
}): AnyQActionDefinition {
  const { connections, chat, logger } = dependencies;
  return defineQAction<
    ConnectionRequestAnswerPayload,
    ConnectionRequestAnswerResult
  >({
    actionType: RELATIONSHIP_CONNECTION_REQUEST_RESPOND,
    version: 1,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-api",
    description:
      "Accepts or declines one company's Connection Request (Company requests) to the approver's investor organisation and, on acceptance, posts the approved opening message on that relationship, exactly as approved.",
    payload: ConnectionRequestAnswerPayloadSchema,
    result: ConnectionRequestAnswerResultSchema,
    targets: (payload): readonly QSubjectRef[] => [
      { kind: "COMPANY", companyId: payload.companyId },
    ],
    describe: (payload) => ({
      summary: connectionAnswerSummary(
        payload.companyName,
        payload.decision,
        payload.openingMessage !== null,
      ),
      preview:
        payload.decision === "DECLINED"
          ? `${payload.companyName} will see that your organisation has not taken this forward. No reason is recorded or shared.`
          : payload.openingMessage === null
            ? `You and ${payload.companyName} will be connected. It is not an investment, and nothing else is shared.`
            : `You and ${payload.companyName} will be connected, then this message is sent to them as you:\n\n${payload.openingMessage}`,
    }),
    confirm: (payload, result) =>
      result.alreadyAnswered
        ? `${payload.companyName}'s request had already been answered; nothing changed.`
        : payload.decision === "DECLINED"
          ? `Done. ${payload.companyName}'s request is marked as not taken forward.`
          : payload.openingMessage === null
            ? `Done. You and ${payload.companyName} are connected.`
            : result.messageSent
              ? `Done. You and ${payload.companyName} are connected, and your message was sent.`
              : `You and ${payload.companyName} are connected, but the message wasn't sent (${result.messageFailure ?? "unknown reason"}). I can send it again.`,
    authorize: async (payload, actor) => {
      if (actor.actorType !== "HUMAN") {
        return { outcome: "DENY", code: "NOT_A_PERSON" };
      }
      // Their own inbox, as the screen reads it: the request must be one
      // addressed to THIS person's investor organisation, for this company
      // and relationship.
      const inbox = await connections
        .listConnectionRequests({ actor })
        .catch(() => null);
      if (inbox === null) return { outcome: "DENY", code: "NOT_AVAILABLE" };
      return inbox.some(
        (entry) =>
          entry.interest.id === payload.interestId &&
          entry.interest.companyId === payload.companyId &&
          entry.interest.relationshipId === payload.relationshipId,
      )
        ? { outcome: "ALLOW" }
        : { outcome: "DENY", code: "NOT_AVAILABLE" };
    },
    executor: {
      execute: async (action, context) => {
        const { payload } = action;
        let alreadyAnswered: boolean;
        try {
          const answered = await connections.respondToConnectionRequest({
            actor: context.approver,
            interestId: payload.interestId,
            decision: payload.decision,
            surface: "Q_CONVERSATION",
            idempotencyKey: `q-action:${action.idempotencyKey}`,
            correlationId: context.correlationId,
          });
          alreadyAnswered = answered.deduplicated;
        } catch (error: unknown) {
          logger?.warn(
            { err: error, actionId: action.actionId, attempt: context.attempt },
            "the answer to a connection request was not applied",
          );
          return {
            outcome: "FAILED",
            failureCode: "CONNECTION_ANSWER_REFUSED",
            retryable: false,
          };
        }
        let messageSent = false;
        let messageFailure: string | null = null;
        if (
          payload.decision === "ACCEPTED" &&
          payload.openingMessage !== null
        ) {
          try {
            await chat.send({
              actor: context.approver,
              relationshipId: payload.relationshipId,
              request: { kind: "TEXT", body: payload.openingMessage },
              idempotencyKey: `q-action:${action.idempotencyKey}:message`,
              qActionId: action.actionId,
            });
            messageSent = true;
          } catch (error: unknown) {
            messageFailure =
              error instanceof Error ? error.name.slice(0, 64) : "SEND_FAILED";
            logger?.warn(
              { err: error, actionId: action.actionId },
              "the opening message after an accepted connection was not sent",
            );
          }
        }
        return {
          outcome: "EXECUTED",
          result: {
            interestId: payload.interestId,
            decision: payload.decision,
            alreadyAnswered,
            messageSent,
            messageFailure,
          },
        };
      },
    },
  });
}
