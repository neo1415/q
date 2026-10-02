import { z } from "zod";

import {
  QActionTypeSchema,
  UuidSchema,
  type QSubjectRef,
} from "@capital-q/contracts";
import type { ConnectionService } from "@capital-q/network";
import type { Logger } from "@capital-q/observability";
import { defineQAction, type AnyQActionDefinition } from "@capital-q/q-actions";

/**
 * A founder's Connection Request to one investor organisation, prepared by
 * Q and sent on approval (action parity 2026-10-02).
 *
 * Execution is the Network context's own requestConnection -- the command
 * the investor page's Send request calls, with its founder capability,
 * reachability rule (the investor takes requests) and idempotency --
 * executed as the approver. The approval binds to the investor id; the
 * name is shown to the approver only.
 */

export const RELATIONSHIP_CONNECTION_REQUEST_SEND = QActionTypeSchema.parse(
  "relationship.connection_request.send",
);

export const ConnectionRequestSendPayloadSchema = z
  .object({
    investorOrganisationId: UuidSchema,
    /** Shown to the approver; the binding is the id. */
    investorName: z.string().trim().min(1).max(200),
  })
  .strict();
export type ConnectionRequestSendPayload = z.infer<
  typeof ConnectionRequestSendPayloadSchema
>;

export const ConnectionRequestSendResultSchema = z
  .object({
    interestId: UuidSchema,
    alreadySent: z.boolean(),
  })
  .strict();
export type ConnectionRequestSendResult = z.infer<
  typeof ConnectionRequestSendResultSchema
>;

export function createConnectionRequestSendAction(dependencies: {
  readonly connections: Pick<
    ConnectionService,
    "connectionStatus" | "requestConnection"
  >;
  readonly logger?: Logger | undefined;
}): AnyQActionDefinition {
  const { connections, logger } = dependencies;
  return defineQAction<
    ConnectionRequestSendPayload,
    ConnectionRequestSendResult
  >({
    actionType: RELATIONSHIP_CONNECTION_REQUEST_SEND,
    version: 1,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-api",
    description:
      "Sends the approver's company's Connection Request to one investor organisation, exactly as Send request on the investor's page.",
    payload: ConnectionRequestSendPayloadSchema,
    result: ConnectionRequestSendResultSchema,
    targets: (payload): readonly QSubjectRef[] => [
      {
        kind: "INVESTOR_ORGANISATION",
        investorOrganisationId: payload.investorOrganisationId,
      },
    ],
    describe: (payload) => ({
      summary: `Send ${payload.investorName} a Connection Request`,
      preview: `${payload.investorName} will receive your company's Connection Request and can accept or decline it. It is not an investment, and nothing private is shared.`,
    }),
    confirm: (payload, result) =>
      result.alreadySent
        ? `Your request to ${payload.investorName} was already sent; nothing changed.`
        : `Done. Your Connection Request is with ${payload.investorName}.`,
    authorize: async (payload, actor) => {
      if (actor.actorType !== "HUMAN") {
        return { outcome: "DENY", code: "NOT_A_PERSON" };
      }
      // The page's own check, as the approver: a founder of a company,
      // an investor that takes requests, none already open.
      const status = await connections
        .connectionStatus({
          actor,
          investorOrganisationId: payload.investorOrganisationId,
        })
        .catch(() => null);
      return status?.canRequest === true
        ? { outcome: "ALLOW" }
        : { outcome: "DENY", code: "NOT_AVAILABLE" };
    },
    executor: {
      execute: async (action, context) => {
        try {
          const sent = await connections.requestConnection({
            actor: context.approver,
            investorOrganisationId: action.payload.investorOrganisationId,
            idempotencyKey: `q-action:${action.idempotencyKey}`,
            correlationId: context.correlationId,
          });
          return {
            outcome: "EXECUTED",
            result: {
              interestId: sent.interest.id,
              alreadySent: sent.deduplicated,
            },
          };
        } catch (error: unknown) {
          logger?.warn(
            { err: error, actionId: action.actionId, attempt: context.attempt },
            "a connection request was not sent",
          );
          return {
            outcome: "FAILED",
            failureCode: "CONNECTION_REQUEST_REFUSED",
            retryable: false,
          };
        }
      },
    },
  });
}
