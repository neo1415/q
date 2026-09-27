import {
  CHAT_PAGE_MAX,
  UtcTimestampSchema,
  type ChatMessageDto,
  type ChatThreadDto,
  type ChatUnreadDto,
  type SendChatMessageRequest,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  ChatAttachmentUnavailableError,
  ChatIdempotencyConflictError,
  ChatNotConnectedError,
  ChatNotFoundError,
} from "./errors.js";
import type {
  ChatAttachmentSnapshot,
  ChatMessageRow,
  ChatSide,
  ChatStore,
} from "./store.js";

/**
 * Relationship chat (R34, CQ-COMM-001; ADR 0019).
 *
 * Every call starts with the same question, answered by the Network
 * context as the caller: is this person a party to this canonical
 * relationship, and for which side? A non-party, an unknown relationship
 * and a malformed id are one answer (not found). Writing additionally needs
 * the relationship to be CONNECTED -- messaging belongs to the Match
 * (Product Specification §6.6.6); reading an existing thread does not, so
 * history never disappears.
 *
 * Messages are append-only. An unsend is a tombstone row that revises the
 * original; the listing folds revisions so a person sees each message as it
 * stands now, with "edited" / "unsent" said plainly.
 */

export type ChatParty = {
  readonly side: ChatSide;
  /** The relationship, as this party sees it, is CONNECTED. */
  readonly connected: boolean;
};

/** Network's per-party view of one relationship; null for a non-party. */
export type ChatPartyResolver = (
  actor: ActorContext,
  relationshipId: string,
) => Promise<ChatParty | null>;

/** The sender organisation's own document, if it has cleared scanning. */
export type ChatDocumentPort = (
  actor: ActorContext,
  documentId: string,
) => Promise<
  | { readonly outcome: "READY"; readonly snapshot: ChatAttachmentSnapshot }
  | { readonly outcome: "NOT_READY" }
  | { readonly outcome: "NOT_FOUND" }
>;

export type ChatServiceDependencies = {
  readonly store: ChatStore;
  readonly parties: ChatPartyResolver;
  readonly documents: ChatDocumentPort;
  readonly newCorrelationId: () => string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_PAGE = 50;
const Q_READ_MAX = 30;
const Q_BODY_MAX = 600;

type Folded = {
  readonly original: ChatMessageRow;
  readonly body: string | null;
  readonly edited: boolean;
  readonly unsent: boolean;
};

/**
 * Fold revisions into their originals, oldest original first. Pure. A
 * revision whose original is not in `rows` is ignored (the store always
 * returns originals with their revisions).
 */
export function foldChatRows(rows: readonly ChatMessageRow[]): Folded[] {
  const ordered = [...rows].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  const byId = new Map<string, Folded>();
  const order: string[] = [];
  for (const row of ordered) {
    if (row.revisesMessageId === null) {
      if (!byId.has(row.id)) {
        byId.set(row.id, {
          original: row,
          body: row.body,
          edited: false,
          unsent: false,
        });
        order.push(row.id);
      }
      continue;
    }
    const current = byId.get(row.revisesMessageId);
    if (current === undefined || current.unsent) continue;
    // Only the original's own sender may revise it (also a DB trigger).
    if (row.senderUserId !== current.original.senderUserId) continue;
    byId.set(
      row.revisesMessageId,
      row.kind === "TOMBSTONE"
        ? { ...current, body: null, unsent: true }
        : { ...current, body: row.body, edited: true },
    );
  }
  return order.flatMap((id) => {
    const folded = byId.get(id);
    return folded === undefined ? [] : [folded];
  });
}

function toDto(folded: Folded, viewerUserId: string): ChatMessageDto {
  const { original } = folded;
  const kind =
    original.kind === "ATTACHMENT" || original.kind === "VOICE_NOTE"
      ? original.kind
      : "TEXT";
  return {
    messageId: original.id,
    side: original.senderSide,
    mine: original.senderUserId === viewerUserId,
    senderName: original.senderName,
    kind,
    body: folded.unsent ? null : folded.body,
    attachment:
      folded.unsent || original.attachment === null
        ? null
        : {
            documentId: original.attachment.documentId,
            title: original.attachment.title,
            mimeType: original.attachment.mimeType,
            sizeBytes: original.attachment.sizeBytes,
          },
    voiceDurationMs: folded.unsent ? null : original.voiceDurationMs,
    edited: folded.edited,
    unsent: folded.unsent,
    viaQ: original.qActionId !== null,
    sentAt: UtcTimestampSchema.parse(original.createdAt.toISOString()),
  };
}

function sameRequest(
  row: ChatMessageRow,
  request: SendChatMessageRequest,
): boolean {
  if (row.kind !== request.kind) return false;
  switch (request.kind) {
    case "TEXT":
      return row.body === request.body;
    case "ATTACHMENT":
      return (
        row.attachment?.documentId === request.documentId &&
        row.body === (request.body ?? null)
      );
    case "VOICE_NOTE":
      return (
        row.attachment?.documentId === request.documentId &&
        row.voiceDurationMs === request.durationMs
      );
  }
}

export type ChatService = ReturnType<typeof createChatService>;

export function createChatService(dependencies: ChatServiceDependencies) {
  const { store, parties, documents } = dependencies;

  const partyOf = async (
    actor: ActorContext,
    relationshipId: string,
  ): Promise<ChatParty> => {
    if (!UUID.test(relationshipId)) throw new ChatNotFoundError();
    const party = await parties(actor, relationshipId).catch(() => null);
    if (party === null) throw new ChatNotFoundError();
    return party;
  };

  const send = async (input: {
    readonly actor: ActorContext;
    readonly relationshipId: string;
    readonly request: SendChatMessageRequest;
    readonly idempotencyKey: string;
    /** Set only by the approved `chat.message.send` executor. */
    readonly qActionId?: string | undefined;
  }): Promise<{
    readonly message: ChatMessageDto;
    readonly deduplicated: boolean;
  }> => {
    const { actor, request } = input;
    if (actor.actorType !== "HUMAN") throw new ChatNotFoundError();
    const party = await partyOf(actor, input.relationshipId);
    if (!party.connected) throw new ChatNotConnectedError();

    let attachment: ChatAttachmentSnapshot | null = null;
    if (request.kind !== "TEXT") {
      const document = await documents(actor, request.documentId).catch(
        () => ({ outcome: "NOT_FOUND" as const }),
      );
      if (document.outcome !== "READY") {
        throw new ChatAttachmentUnavailableError(document.outcome);
      }
      attachment = document.snapshot;
    }

    const { row, deduplicated } = await store.append({
      relationshipId: input.relationshipId,
      senderUserId: actor.userId,
      senderSide: party.side,
      kind: request.kind,
      body:
        request.kind === "VOICE_NOTE" ? null : (request.body ?? null),
      attachment,
      voiceDurationMs: request.kind === "VOICE_NOTE" ? request.durationMs : null,
      revisesMessageId: null,
      qActionId: input.qActionId ?? null,
      idempotencyKey: input.idempotencyKey,
      correlationId: dependencies.newCorrelationId(),
    });
    if (deduplicated && !sameRequest(row, request)) {
      throw new ChatIdempotencyConflictError();
    }
    return {
      message: toDto(
        { original: row, body: row.body, edited: false, unsent: false },
        actor.userId,
      ),
      deduplicated,
    };
  };

  return {
    send,

    thread: async (query: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
      readonly after?: string | undefined;
      readonly limit?: number | undefined;
    }): Promise<ChatThreadDto> => {
      const { actor } = query;
      const party = await partyOf(actor, query.relationshipId);
      const status = party.connected ? "OPEN" : "NOT_CONNECTED";
      const conversation = await store.conversationFor(query.relationshipId);
      const other: ChatSide = party.side === "COMPANY" ? "INVESTOR" : "COMPANY";
      if (conversation === null) {
        return {
          relationshipId: query.relationshipId,
          status,
          messages: [],
          cursor: null,
          counterpartLastReadMessageId: null,
          unread: 0,
        };
      }
      const limit = Math.min(query.limit ?? DEFAULT_PAGE, CHAT_PAGE_MAX);
      let rows: readonly ChatMessageRow[];
      if (query.after === undefined) {
        rows = await store.listRecent(conversation.id, limit);
      } else {
        // A cursor from another thread is simply not found in this one.
        const anchor = UUID.test(query.after)
          ? await store.findMessage(conversation.id, query.after)
          : null;
        rows =
          anchor === null
            ? await store.listRecent(conversation.id, limit)
            : await store.listChangedAfter(conversation.id, anchor.id, limit);
      }
      const [cursor, seen, unread] = await Promise.all([
        store.latestRowId(conversation.id),
        store.lastReadBySide(conversation.id, other),
        store.unreadCount(conversation.id, actor.userId, party.side),
      ]);
      return {
        relationshipId: query.relationshipId,
        status,
        messages: foldChatRows(rows).map((folded) =>
          toDto(folded, actor.userId),
        ),
        cursor,
        counterpartLastReadMessageId: seen,
        unread,
      };
    },

    markRead: async (input: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
      readonly lastReadMessageId: string;
    }): Promise<void> => {
      const party = await partyOf(input.actor, input.relationshipId);
      const conversation = await store.conversationFor(input.relationshipId);
      if (conversation === null) throw new ChatNotFoundError();
      const message = await store.findMessage(
        conversation.id,
        input.lastReadMessageId,
      );
      if (message === null) throw new ChatNotFoundError();
      await store.markRead({
        conversation,
        userId: input.actor.userId,
        side: party.side,
        messageId: message.id,
      });
    },

    unsend: async (input: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
      readonly messageId: string;
      readonly idempotencyKey: string;
    }): Promise<void> => {
      const { actor } = input;
      const party = await partyOf(actor, input.relationshipId);
      const conversation = await store.conversationFor(input.relationshipId);
      if (conversation === null || !UUID.test(input.messageId)) {
        throw new ChatNotFoundError();
      }
      const original = await store.findMessage(conversation.id, input.messageId);
      // Only your own original; the other side's is not found to you.
      if (
        original === null ||
        original.senderUserId !== actor.userId ||
        original.revisesMessageId !== null
      ) {
        throw new ChatNotFoundError();
      }
      await store.append({
        relationshipId: input.relationshipId,
        senderUserId: actor.userId,
        senderSide: party.side,
        kind: "TOMBSTONE",
        body: null,
        attachment: null,
        voiceDurationMs: null,
        revisesMessageId: original.id,
        qActionId: null,
        idempotencyKey: input.idempotencyKey,
        correlationId: dependencies.newCorrelationId(),
      });
    },

    unread: async (actor: ActorContext): Promise<ChatUnreadDto> => {
      if (actor.organisationId === undefined) return { items: [] };
      const items = await store.unreadForOrganisation(
        actor.organisationId,
        actor.userId,
      );
      return { items: items.filter((item) => item.unread > 0) };
    },

    /**
     * What Q may read of a thread, for the person who invoked it: only a
     * party's own thread, the latest messages as they stand now, words
     * bounded. Attachments are named, never opened.
     */
    readForQ: async (query: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
      readonly limit?: number | undefined;
    }): Promise<{
      readonly side: ChatSide;
      readonly connected: boolean;
      readonly messages: readonly {
        readonly from: "YOU" | "YOUR_SIDE" | "OTHER_SIDE";
        readonly senderName: string;
        readonly kind: ChatMessageDto["kind"];
        readonly text: string | null;
        readonly attachmentTitle: string | null;
        readonly sentAt: string;
      }[];
    }> => {
      const { actor } = query;
      const party = await partyOf(actor, query.relationshipId);
      const conversation = await store.conversationFor(query.relationshipId);
      if (conversation === null) {
        return { side: party.side, connected: party.connected, messages: [] };
      }
      const limit = Math.min(query.limit ?? Q_READ_MAX, Q_READ_MAX);
      const folded = foldChatRows(
        await store.listRecent(conversation.id, limit),
      ).filter((message) => !message.unsent);
      return {
        side: party.side,
        connected: party.connected,
        messages: folded.map((message) => ({
          from:
            message.original.senderUserId === actor.userId
              ? "YOU"
              : message.original.senderSide === party.side
                ? "YOUR_SIDE"
                : "OTHER_SIDE",
          senderName: message.original.senderName,
          kind: toDto(message, actor.userId).kind,
          text:
            message.body === null ? null : message.body.slice(0, Q_BODY_MAX),
          attachmentTitle: message.original.attachment?.title ?? null,
          sentAt: message.original.createdAt.toISOString(),
        })),
      };
    },
  };
}
