import {
  CHAT_UNREAD_PATH,
  ChatThreadDtoSchema,
  ChatUnreadDtoSchema,
  IDEMPOTENCY_KEY_HEADER,
  RELATIONSHIP_MESSAGE_UNSEND_PATH,
  RELATIONSHIP_MESSAGES_PATH,
  RELATIONSHIP_MESSAGES_READ_PATH,
  SendChatMessageResultDtoSchema,
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
