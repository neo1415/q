import { randomUUID } from "node:crypto";

import type {
  ChatConversation,
  ChatMessageRow,
  ChatSide,
  ChatStore,
} from "../store.js";

/**
 * An in-memory ChatStore with the same rules the database enforces:
 * append-only rows, one row per sender idempotency key, a forward-only
 * read cursor, and `message_sent` recorded for originals only.
 */
export type InMemoryChatStore = ChatStore & {
  readonly rows: ChatMessageRow[];
  readonly activity: { relationshipId: string; messageId: string }[];
  /** relationshipId -> party organisations, for unread-by-organisation. */
  readonly parties: Map<string, { company: string; investor: string }>;
  readonly names: Map<string, string>;
};

export function createInMemoryChatStore(
  options: { readonly now?: () => Date } = {},
): InMemoryChatStore {
  let tick = 0;
  const now =
    options.now ?? (() => new Date(Date.UTC(2026, 8, 27, 9, 0, 0, tick++)));
  const conversations = new Map<string, ChatConversation>();
  const rows: ChatMessageRow[] = [];
  const keys = new Map<string, ChatMessageRow>();
  const receipts = new Map<
    string,
    { side: ChatSide; messageId: string; conversationId: string }
  >();
  const activity: { relationshipId: string; messageId: string }[] = [];
  const parties = new Map<string, { company: string; investor: string }>();
  const names = new Map<string, string>();

  const ordered = (conversationId: string) =>
    rows.filter((row) => row.conversationId === conversationId);
  const indexOf = (id: string) => rows.findIndex((row) => row.id === id);
  const withRevisions = (conversationId: string, originals: Set<string>) =>
    ordered(conversationId).filter(
      (row) =>
        originals.has(row.id) ||
        (row.revisesMessageId !== null && originals.has(row.revisesMessageId)),
    );
  const unreadIn = (conversationId: string, userId: string, side: ChatSide) => {
    const receipt = receipts.get(`${conversationId}:${userId}`);
    const from = receipt === undefined ? -1 : indexOf(receipt.messageId);
    return rows.filter(
      (row, index) =>
        row.conversationId === conversationId &&
        row.revisesMessageId === null &&
        row.senderSide !== side &&
        index > from,
    ).length;
  };

  return {
    rows,
    activity,
    parties,
    names,
    conversationFor: (relationshipId) =>
      Promise.resolve(conversations.get(relationshipId) ?? null),
    append: (input) => {
      const key = `${input.senderUserId}:${input.idempotencyKey}`;
      const existing = keys.get(key);
      if (existing !== undefined) {
        return Promise.resolve({ row: existing, deduplicated: true });
      }
      let conversation = conversations.get(input.relationshipId);
      if (conversation === undefined) {
        conversation = {
          id: randomUUID(),
          tenantId: "00000000-0000-4000-8000-00000000aaaa",
          relationshipId: input.relationshipId,
        };
        conversations.set(input.relationshipId, conversation);
      }
      if (input.revisesMessageId !== null) {
        const original = rows.find((row) => row.id === input.revisesMessageId);
        if (
          original === undefined ||
          original.senderUserId !== input.senderUserId ||
          original.conversationId !== conversation.id
        ) {
          return Promise.reject(new Error("revision guard"));
        }
      }
      const row: ChatMessageRow = {
        id: randomUUID(),
        conversationId: conversation.id,
        senderUserId: input.senderUserId,
        senderName: names.get(input.senderUserId) ?? "Someone",
        senderSide: input.senderSide,
        kind: input.kind,
        body: input.body,
        attachment: input.attachment,
        voiceDurationMs: input.voiceDurationMs,
        revisesMessageId: input.revisesMessageId,
        qActionId: input.qActionId,
        createdAt: now(),
      };
      rows.push(row);
      keys.set(key, row);
      if (input.revisesMessageId === null) {
        activity.push({
          relationshipId: input.relationshipId,
          messageId: row.id,
        });
      }
      return Promise.resolve({ row, deduplicated: false });
    },
    findMessage: (conversationId, messageId) =>
      Promise.resolve(
        rows.find(
          (row) =>
            row.id === messageId && row.conversationId === conversationId,
        ) ?? null,
      ),
    findWithRevisions: (conversationId, messageId) =>
      Promise.resolve(withRevisions(conversationId, new Set([messageId]))),
    listRecent: (conversationId, limit) => {
      const originals = ordered(conversationId)
        .filter((row) => row.revisesMessageId === null)
        .slice(-limit)
        .map((row) => row.id);
      return Promise.resolve(withRevisions(conversationId, new Set(originals)));
    },
    listChangedAfter: (conversationId, afterMessageId, limit) => {
      const from = indexOf(afterMessageId);
      const changed = rows
        .filter(
          (row, index) => row.conversationId === conversationId && index > from,
        )
        .slice(0, limit)
        .map((row) => row.revisesMessageId ?? row.id);
      return Promise.resolve(withRevisions(conversationId, new Set(changed)));
    },
    latestRowId: (conversationId) =>
      Promise.resolve(ordered(conversationId).at(-1)?.id ?? null),
    markRead: ({ conversation, userId, side, messageId }) => {
      const key = `${conversation.id}:${userId}`;
      const current = receipts.get(key);
      if (
        current === undefined ||
        indexOf(messageId) > indexOf(current.messageId)
      ) {
        receipts.set(key, {
          side,
          messageId,
          conversationId: conversation.id,
        });
      }
      return Promise.resolve();
    },
    lastReadBySide: (conversationId, side) => {
      let best: string | null = null;
      for (const receipt of receipts.values()) {
        if (receipt.conversationId !== conversationId || receipt.side !== side)
          continue;
        if (best === null || indexOf(receipt.messageId) > indexOf(best)) {
          best = receipt.messageId;
        }
      }
      return Promise.resolve(best);
    },
    unreadCount: (conversationId, userId, side) =>
      Promise.resolve(unreadIn(conversationId, userId, side)),
    unreadForOrganisation: (organisationId, userId) => {
      const out: { relationshipId: string; unread: number }[] = [];
      for (const [relationshipId, conversation] of conversations) {
        const party = parties.get(relationshipId);
        if (party === undefined) continue;
        const side: ChatSide | null =
          party.company === organisationId
            ? "COMPANY"
            : party.investor === organisationId
              ? "INVESTOR"
              : null;
        if (side === null) continue;
        const unread = unreadIn(conversation.id, userId, side);
        if (unread > 0) out.push({ relationshipId, unread });
      }
      return Promise.resolve(out);
    },
  };
}
