import {
  CHAT_UNREAD_PATH,
  ChatAttachmentAccessDtoSchema,
  RELATIONSHIP_MESSAGE_ATTACHMENT_PATH,
  ChatThreadDtoSchema,
  ChatReportResultDtoSchema,
  ChatUnreadDtoSchema,
  IDEMPOTENCY_KEY_HEADER,
  RELATIONSHIP_CHAT_BLOCK_PATH,
  RELATIONSHIP_CHAT_REPORTS_PATH,
  RELATIONSHIP_CHAT_UNBLOCK_PATH,
  RELATIONSHIP_MESSAGE_UNSEND_PATH,
  RELATIONSHIP_MESSAGES_PATH,
  RELATIONSHIP_MESSAGES_READ_PATH,
  SendChatMessageResultDtoSchema,
  type ReportChatRequest,
  type SendChatMessageRequest,
} from "@capital-q/contracts";

import { readProblemResponse } from "./problem.js";
import { call, type ApiSession } from "./request.js";

/** Relationship chat (R34). The relationship id is input; the API authorises. */

const pathFor = (template: string, relationshipId: string, messageId = "") =>
  template
    .replace(":relationshipId", encodeURIComponent(relationshipId))
    .replace(":messageId", encodeURIComponent(messageId));

export function getChatThread(
  session: ApiSession,
  relationshipId: string,
  after?: string,
) {
  const query =
    after === undefined ? "" : `?after=${encodeURIComponent(after)}`;
  return call(
    session,
    "GET",
    `${pathFor(RELATIONSHIP_MESSAGES_PATH, relationshipId)}${query}`,
    ChatThreadDtoSchema,
  );
}

export function sendChatMessage(
  session: ApiSession,
  relationshipId: string,
  message: SendChatMessageRequest,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    pathFor(RELATIONSHIP_MESSAGES_PATH, relationshipId),
    SendChatMessageResultDtoSchema,
    { body: message, headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } },
  );
}

async function noContent(
  session: ApiSession,
  path: string,
  options: { body?: unknown; headers?: Record<string, string> },
): Promise<void> {
  const doFetch = session.fetch ?? fetch;
  const response = await doFetch(
    `${session.baseUrl.replace(/\/$/, "")}${path}`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${session.accessToken}`,
        ...(session.organisationId === undefined
          ? {}
          : { "x-organisation-id": session.organisationId }),
        ...(options.body === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...options.headers,
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw await readProblemResponse(response);
  }
}

/** `204`: the read cursor moves forward (never back). */
export function markChatRead(
  session: ApiSession,
  relationshipId: string,
  lastReadMessageId: string,
): Promise<void> {
  return noContent(
    session,
    pathFor(RELATIONSHIP_MESSAGES_READ_PATH, relationshipId),
    { body: { lastReadMessageId } },
  );
}

/** `204`: the caller's own message becomes a tombstone. */
export function unsendChatMessage(
  session: ApiSession,
  relationshipId: string,
  messageId: string,
  idempotencyKey: string,
): Promise<void> {
  return noContent(
    session,
    pathFor(RELATIONSHIP_MESSAGE_UNSEND_PATH, relationshipId, messageId),
    { headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } },
  );
}

export function getChatUnread(session: ApiSession) {
  return call(session, "GET", CHAT_UNREAD_PATH, ChatUnreadDtoSchema);
}

/** A one-minute signed read of a shared file or voice note (party only). */
export function getChatAttachment(
  session: ApiSession,
  relationshipId: string,
  messageId: string,
) {
  return call(
    session,
    "GET",
    pathFor(RELATIONSHIP_MESSAGE_ATTACHMENT_PATH, relationshipId, messageId),
    ChatAttachmentAccessDtoSchema,
  );
}

/** `204`: messaging on this relationship stops both ways (R34 safety). */
export function blockChat(
  session: ApiSession,
  relationshipId: string,
  idempotencyKey: string,
): Promise<void> {
  return noContent(session, pathFor(RELATIONSHIP_CHAT_BLOCK_PATH, relationshipId), {
    headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
  });
}

/** `204`: the caller's side lifts its block, if it holds one. */
export function unblockChat(
  session: ApiSession,
  relationshipId: string,
  idempotencyKey: string,
): Promise<void> {
  return noContent(
    session,
    pathFor(RELATIONSHIP_CHAT_UNBLOCK_PATH, relationshipId),
    { headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } },
  );
}

/** A report for Capital Q's integrity review; once per key. */
export function reportChat(
  session: ApiSession,
  relationshipId: string,
  report: ReportChatRequest,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    pathFor(RELATIONSHIP_CHAT_REPORTS_PATH, relationshipId),
    ChatReportResultDtoSchema,
    { body: report, headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } },
  );
}
