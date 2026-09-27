/**
 * @capital-q/communication — relationship chat (R34, CQ-COMM-001; ADR 0019).
 *
 * Owns: the 1:1 thread on a canonical relationship, its append-only
 * messages and read cursors. Reaches Network only through its public
 * contract (party resolution is injected; `message_sent` goes through the
 * Network appender) and Evidence only through an injected document port.
 */

export {
  ChatAttachmentUnavailableError,
  ChatIdempotencyConflictError,
  ChatNotConnectedError,
  ChatNotFoundError,
} from "./errors.js";
export {
  createChatService,
  foldChatRows,
  type ChatDocumentPort,
  type ChatParty,
  type ChatPartyResolver,
  type ChatService,
  type ChatServiceDependencies,
} from "./service.js";
export type {
  AppendChatMessageInput,
  ChatAttachmentSnapshot,
  ChatConversation,
  ChatMessageRow,
  ChatRowKind,
  ChatSide,
  ChatStore,
} from "./store.js";
export { createPostgresChatStore } from "./postgres.js";
