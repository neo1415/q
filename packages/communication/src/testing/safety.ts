import { randomUUID } from "node:crypto";

import type { TransactionContext } from "@capital-q/database";

import type { ChatSafetyStore } from "../safety-store.js";
import type { ChatSide } from "../store.js";
import type { InMemoryChatStore } from "./index.js";

/**
 * An in-memory ChatSafetyStore with the database's rules: one active block
 * per side (shared with the chat store, so sending is refused while it
 * holds), one row per person and key, reasons from reference data, and a
 * reported message must be the other side's original on this thread.
 */
export type InMemoryChatSafetyStore = ChatSafetyStore & {
  readonly blockRows: {
    id: string;
    relationshipId: string;
    side: ChatSide;
    userId: string;
    key: string;
    liftedBy: string | null;
  }[];
  readonly reports: {
    id: string;
    relationshipId: string;
    side: ChatSide;
    userId: string;
    messageId: string | null;
    reasonCode: string;
    note: string | null;
    key: string;
  }[];
  /** Resource ids passed to the audit hook, in order. */
  readonly audited: string[];
};

const REASONS = new Set([
  "SPAM",
  "HARASSMENT",
  "INAPPROPRIATE",
  "MISLEADING",
  "SCAM",
  "PRIVACY",
  "OTHER",
]);

const tx = { sql: undefined as never } satisfies TransactionContext;

export function createInMemoryChatSafetyStore(
  chat: InMemoryChatStore,
): InMemoryChatSafetyStore {
  const blockRows: InMemoryChatSafetyStore["blockRows"] = [];
  const reports: InMemoryChatSafetyStore["reports"] = [];
  const audited: string[] = [];

  const sync = (relationshipId: string) => {
    chat.blocks.set(
      relationshipId,
      new Set(
        blockRows
          .filter((row) => row.relationshipId === relationshipId && row.liftedBy === null)
          .map((row) => row.side),
      ),
    );
  };

  return {
    blockRows,
    reports,
    audited,
    block: async (input) => {
      const byKey = blockRows.find(
        (row) => row.userId === input.userId && row.key === input.idempotencyKey,
      );
      if (byKey !== undefined) {
        return byKey.relationshipId === input.relationshipId
          ? { outcome: "BLOCKED", blockId: byKey.id, deduplicated: true }
          : { outcome: "KEY_CONFLICT" };
      }
      const active = blockRows.find(
        (row) =>
          row.relationshipId === input.relationshipId &&
          row.side === input.side &&
          row.liftedBy === null,
      );
      if (active !== undefined) {
        return { outcome: "BLOCKED", blockId: active.id, deduplicated: true };
      }
      const id = randomUUID();
      blockRows.push({
        id,
        relationshipId: input.relationshipId,
        side: input.side,
        userId: input.userId,
        key: input.idempotencyKey,
        liftedBy: null,
      });
      sync(input.relationshipId);
      await input.audit(tx, id);
      audited.push(id);
      return { outcome: "BLOCKED", blockId: id, deduplicated: false };
    },
    unblock: async (input) => {
      const active = blockRows.find(
        (row) =>
          row.relationshipId === input.relationshipId &&
          row.side === input.side &&
          row.liftedBy === null,
      );
      if (active === undefined) return { lifted: false };
      active.liftedBy = input.userId;
      sync(input.relationshipId);
      await input.audit(tx, active.id);
      audited.push(active.id);
      return { lifted: true };
    },
    report: async (input) => {
      const byKey = reports.find(
        (row) => row.userId === input.userId && row.key === input.idempotencyKey,
      );
      if (byKey !== undefined) {
        return byKey.relationshipId === input.relationshipId &&
          byKey.messageId === input.messageId &&
          byKey.reasonCode === input.reasonCode &&
          byKey.note === input.note
          ? { outcome: "REPORTED", reportId: byKey.id, deduplicated: true }
          : { outcome: "KEY_CONFLICT" };
      }
      if (!REASONS.has(input.reasonCode)) return { outcome: "UNKNOWN_REASON" };
      if (input.messageId !== null) {
        const conversation = await chat.conversationFor(input.relationshipId);
        const message = chat.rows.find(
          (row) =>
            row.id === input.messageId &&
            row.conversationId === conversation?.id &&
            row.revisesMessageId === null &&
            row.senderSide !== input.side,
        );
        if (message === undefined) return { outcome: "MESSAGE_NOT_FOUND" };
      }
      const id = randomUUID();
      reports.push({
        id,
        relationshipId: input.relationshipId,
        side: input.side,
        userId: input.userId,
        messageId: input.messageId,
        reasonCode: input.reasonCode,
        note: input.note,
        key: input.idempotencyKey,
      });
      await input.audit(tx, id);
      audited.push(id);
      return { outcome: "REPORTED", reportId: id, deduplicated: false };
    },
  };
}
