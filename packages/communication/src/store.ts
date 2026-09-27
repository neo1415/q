/**
 * The communication store port (R34). The service owns every rule; the
 * store persists rows and answers narrow questions about one thread. It is
 * implemented over the privileged server connection, so it never decides
 * who may read what -- the service has already decided the caller is a
 * party before any of these run.
 */

export type ChatSide = "COMPANY" | "INVESTOR";
export type ChatRowKind =
  | "TEXT"
  | "ATTACHMENT"
  | "VOICE_NOTE"
  | "EDIT"
  | "TOMBSTONE";

export type ChatAttachmentSnapshot = {
  readonly documentId: string;
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
  readonly append: (
    input: AppendChatMessageInput,
  ) => Promise<{ readonly row: ChatMessageRow; readonly deduplicated: boolean }>;
  readonly findMessage: (
    conversationId: string,
    messageId: string,
  ) => Promise<ChatMessageRow | null>;
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
  /** Unread counts on every thread of one party organisation, for one reader. */
  readonly unreadForOrganisation: (
    organisationId: string,
    userId: string,
  ) => Promise<
    readonly { readonly relationshipId: string; readonly unread: number }[]
  >;
};
