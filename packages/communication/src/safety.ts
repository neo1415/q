import type {
  ChatReportResultDto,
  ReportChatRequest,
} from "@capital-q/contracts";
import type { TransactionContext } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import {
  ChatIdempotencyConflictError,
  ChatNotFoundError,
  ChatReportReasonError,
} from "./errors.js";
import type { ChatSafetyStore } from "./safety-store.js";
import type { ChatPartyResolver } from "./service.js";
import type { ChatSide } from "./store.js";

/**
 * Block and report on relationship chat (R34 safety; doc 10: messaging
 * without block/report is unsafe).
 *
 * Only a party may block, unblock or report, and only for its own side;
 * the side's organisation comes from the canonical relationship, never
 * from input. A block stops messages in both directions until the side
 * that blocked lifts it. A report goes to Capital Q's integrity review; it
 * changes nothing on the relationship. Each is a person's own explicit
 * action: Q never blocks or reports on inference.
 *
 * Every write is audited (AUDIT, not analytics) in the same transaction.
 * Audit metadata names the reason code and whether a message was named,
 * never the note or any message words.
 */

export type ChatSafetyAuditEntry = {
  readonly actor: ActorContext;
  readonly actionType: "chat.blocked" | "chat.unblocked" | "chat.reported";
  readonly resourceType: "chat_block" | "chat_report";
  readonly resourceId: string;
  readonly relationshipId: string;
  readonly metadata: Readonly<Record<string, string | boolean>>;
};

/** Records one audit entry inside the store's transaction. */
export type ChatSafetyAuditPort = (
  tx: TransactionContext,
  entry: ChatSafetyAuditEntry,
) => Promise<void>;

export type ChatSafetyServiceDependencies = {
  readonly store: ChatSafetyStore;
  readonly parties: ChatPartyResolver;
  readonly audit: ChatSafetyAuditPort;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ChatSafetyService = ReturnType<typeof createChatSafetyService>;

export function createChatSafetyService(
  dependencies: ChatSafetyServiceDependencies,
) {
  const { store, parties, audit } = dependencies;

  /** A person, a party, for its own side. Anything else is not found. */
  const sideOf = async (
    actor: ActorContext,
    relationshipId: string,
  ): Promise<ChatSide> => {
    if (actor.actorType !== "HUMAN" || !UUID.test(relationshipId)) {
      throw new ChatNotFoundError();
    }
    const party = await parties(actor, relationshipId).catch(() => null);
    if (party === null) throw new ChatNotFoundError();
    return party.side;
  };

  return {
    block: async (input: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
      readonly idempotencyKey: string;
    }): Promise<{ readonly deduplicated: boolean }> => {
      const { actor, relationshipId } = input;
      const side = await sideOf(actor, relationshipId);
      const result = await store.block({
        relationshipId,
        side,
        userId: actor.userId,
        idempotencyKey: input.idempotencyKey,
        audit: (tx, blockId) =>
          audit(tx, {
            actor,
            actionType: "chat.blocked",
            resourceType: "chat_block",
            resourceId: blockId,
            relationshipId,
            metadata: { side },
          }),
      });
      if (result.outcome === "KEY_CONFLICT") {
        throw new ChatIdempotencyConflictError();
      }
      return { deduplicated: result.deduplicated };
    },

    unblock: async (input: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
    }): Promise<{ readonly lifted: boolean }> => {
      const { actor, relationshipId } = input;
      const side = await sideOf(actor, relationshipId);
      return store.unblock({
        relationshipId,
        side,
        userId: actor.userId,
        audit: (tx, blockId) =>
          audit(tx, {
            actor,
            actionType: "chat.unblocked",
            resourceType: "chat_block",
            resourceId: blockId,
            relationshipId,
            metadata: { side },
          }),
      });
    },

    report: async (input: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
      readonly request: ReportChatRequest;
      readonly idempotencyKey: string;
    }): Promise<ChatReportResultDto> => {
      const { actor, relationshipId, request } = input;
      const side = await sideOf(actor, relationshipId);
      const messageId = request.messageId ?? null;
      const result = await store.report({
        relationshipId,
        side,
        userId: actor.userId,
        messageId,
        reasonCode: request.reasonCode,
        note: request.note ?? null,
        idempotencyKey: input.idempotencyKey,
        audit: (tx, reportId) =>
          audit(tx, {
            actor,
            actionType: "chat.reported",
            resourceType: "chat_report",
            resourceId: reportId,
            relationshipId,
            metadata: {
              side,
              reasonCode: request.reasonCode,
              namesMessage: messageId !== null,
            },
          }),
      });
      switch (result.outcome) {
        case "REPORTED":
          return {
            reportId: result.reportId,
            status: "OPEN",
            deduplicated: result.deduplicated,
          };
        case "KEY_CONFLICT":
          throw new ChatIdempotencyConflictError();
        case "UNKNOWN_REASON":
          throw new ChatReportReasonError();
        case "MESSAGE_NOT_FOUND":
          throw new ChatNotFoundError();
      }
    },
  };
}
