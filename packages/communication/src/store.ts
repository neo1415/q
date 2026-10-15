/**
 * The communication store port (R34). The service owns every rule; the
 * store persists rows and answers narrow questions about one thread. It is
 * implemented over the privileged server connection, so it never decides
 * who may read what -- the service has already decided the caller is a
 * party before any of these run.
 */

export type ChatSide = "COMPANY" | "INVESTOR";
export type ChatRowKind =
  "TEXT" | "ATTACHMENT" | "VOICE_NOTE" | "EDIT" | "TOMBSTONE";

export type ChatAttachmentSnapshot = {
  readonly documentId: string;
  /** The exact version shared, in the sender's (document-owning) tenant. */
  readonly documentVersionId: string;
  readonly documentTenantId: string;
  readonly title: string;
  readonly mimeType: string;
  readonly sizeBytes: number | null;
};

export type ChatMessageRow = {
  readonly id: string;
  readonly conversationId: string;
  readonly senderUserId: string;
  readonly senderName: string;
  readonly senderSide: ChatSide;
  readonly kind: ChatRowKind;
  readonly body: string | null;
  readonly attachment: ChatAttachmentSnapshot | null;
  readonly voiceDurationMs: number | null;
  readonly revisesMessageId: string | null;
  readonly qActionId: string | null;
  /** AUTO (ADR 0030): sent by Q under a delegation or errand. */
  readonly qDelegationId?: string | null | undefined;
  /** AUTO: the Q-to-Q envelope (cq.q2q/1), as stored; parse before use. */
  readonly qEnvelope?: unknown;
  readonly createdAt: Date;
};

export type ChatConversation = {
  readonly id: string;
  readonly tenantId: string;
  readonly relationshipId: string;
};

export type AppendChatMessageInput = {
  readonly relationshipId: string;
  readonly senderUserId: string;
  readonly senderSide: ChatSide;
  readonly kind: ChatRowKind;
  readonly body: string | null;
  readonly attachment: ChatAttachmentSnapshot | null;
  readonly voiceDurationMs: number | null;
  readonly revisesMessageId: string | null;
  readonly qActionId: string | null;
  /** AUTO (ADR 0030): set only by Q's delegated work and errands. */
  readonly qDelegationId?: string | null | undefined;
  readonly qEnvelope?: Readonly<Record<string, unknown>> | null | undefined;
  readonly idempotencyKey: string;
  readonly correlationId: string;
};

export type ChatStore = {
  readonly conversationFor: (
    relationshipId: string,
  ) => Promise<ChatConversation | null>;
  /**
   * One transaction: the thread (created on first use), the message, and --
   * for an original -- `message_sent` on the relationship. A repeat of the
   * sender's idempotency key returns the stored row, `deduplicated`.
   */
  readonly append: (input: AppendChatMessageInput) => Promise<{
    readonly row: ChatMessageRow;
    readonly deduplicated: boolean;
  }>;
  readonly findMessage: (
    conversationId: string,
    messageId: string,
  ) => Promise<ChatMessageRow | null>;
  /** One original and all of its revisions, oldest first. */
  readonly findWithRevisions: (
    conversationId: string,
    messageId: string,
  ) => Promise<readonly ChatMessageRow[]>;
  /** The newest `limit` originals and every revision of them, oldest first. */
  readonly listRecent: (
    conversationId: string,
    limit: number,
  ) => Promise<readonly ChatMessageRow[]>;
  /**
   * Rows after the cursor (up to `limit`), plus the originals they revise
   * and every revision of those, oldest first.
   */
  readonly listChangedAfter: (
    conversationId: string,
    afterMessageId: string,
    limit: number,
  ) => Promise<readonly ChatMessageRow[]>;
  /** The newest row id of the thread (any kind), for the cursor. */
  readonly latestRowId: (conversationId: string) => Promise<string | null>;
  /** Forward-only: an older message never moves the cursor back. */
  readonly markRead: (input: {
    readonly conversation: ChatConversation;
    readonly userId: string;
    readonly side: ChatSide;
    readonly messageId: string;
  }) => Promise<void>;
  /** The furthest message any reader on `side` has read. */
  readonly lastReadBySide: (
    conversationId: string,
    side: ChatSide,
  ) => Promise<string | null>;
  /** Originals from the other side after the person's own cursor. */
  readonly unreadCount: (
    conversationId: string,
    userId: string,
    side: ChatSide,
  ) => Promise<number>;
  /**
   * The sides holding an active block on this relationship (R34 safety).
   * Empty when messaging is not blocked.
   */
  readonly activeBlockSides: (
    relationshipId: string,
  ) => Promise<readonly ChatSide[]>;
  /**
   * R1 batching: for each listed relationship where `organisationId` is a
   * party, that organisation's side and the newest few originals from each
   * side with their revisions, in one read. A relationship where it is not
   * a party is absent. Optional: narrow fakes need not carry it.
   */
  readonly recentForRelationships?: (
    organisationId: string,
    relationshipIds: readonly string[],
  ) => Promise<
    readonly {
      readonly relationshipId: string;
      readonly side: ChatSide;
      readonly rows: readonly ChatMessageRow[];
    }[]
  >;
  /** Unread counts on every thread of one party organisation, for one reader. */
  readonly unreadForOrganisation: (
    organisationId: string,
    userId: string,
  ) => Promise<
    readonly { readonly relationshipId: string; readonly unread: number }[]
  >;
};
