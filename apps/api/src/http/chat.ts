import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  CHAT_UNREAD_PATH,
  ChatAttachmentAccessDtoSchema,
  ChatListQuerySchema,
  ChatThreadDtoSchema,
  ChatUnreadDtoSchema,
  MarkChatReadRequestSchema,
  parseContract,
  RELATIONSHIP_MESSAGE_ATTACHMENT_PATH,
  RELATIONSHIP_MESSAGES_PATH,
  RELATIONSHIP_MESSAGES_READ_PATH,
} from "@capital-q/contracts";
import type { ChatSafetyService, ChatService } from "@capital-q/communication";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * `/v1/relationships/:relationshipId/messages` — relationship chat (R34,
 * CQ-COMM-001; ADR 0019).
 *
 * The relationship id is input; the Communication service asks Network, as
 * the caller, whether this person is a party and for which side. A
 * non-party, an unknown relationship and a malformed id are one 404.
 * Sending is idempotent per person and key, and is refused (409) until the
 * relationship is connected. Attachments name a document the caller's own
 * organisation uploaded through `/v1/documents`; bytes never pass here.
 */

export type ChatRoutesDependencies = ActorContextDependencies & {
  readonly chat: ChatService;
  /** R34 safety: block, unblock and report. Absent: those routes 404. */
  readonly safety?: ChatSafetyService | undefined;
};

function param(request: FastifyRequest, name: string): string {
  const raw = (request.params as Record<string, unknown>)[name];
  return typeof raw === "string" ? raw : "";
}

export function registerChatRoutes(
  app: FastifyInstance,
  dependencies: ChatRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const { chat } = dependencies;

  app.get(
    RELATIONSHIP_MESSAGES_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const query = parseContract(
        ChatListQuerySchema,
        request.query ?? {},
        "The message query is not valid.",
      );
      const thread = await chat.thread({
        actor: getActorContext(request),
        relationshipId: param(request, "relationshipId"),
        after: query.after,
        limit: query.limit,
      });
      void reply.header("Cache-Control", "no-store");
      return ChatThreadDtoSchema.parse(thread);
    },
  );

  app.post(
    RELATIONSHIP_MESSAGES_READ_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const input = parseContract(
        MarkChatReadRequestSchema,
        request.body,
        "The read marker is not valid.",
      );
      await chat.markRead({
        actor: getActorContext(request),
        relationshipId: param(request, "relationshipId"),
        lastReadMessageId: input.lastReadMessageId,
      });
      return reply.status(204).header("Cache-Control", "no-store").send();
    },
  );

  // A one-minute signed read of a shared file or voice note, for a party
  // only. The browser fetches the bytes from storage directly.
  app.get(
    RELATIONSHIP_MESSAGE_ATTACHMENT_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const access = await chat.attachment({
        actor: getActorContext(request),
        relationshipId: param(request, "relationshipId"),
        messageId: param(request, "messageId"),
      });
      void reply.header("Cache-Control", "no-store");
      return ChatAttachmentAccessDtoSchema.parse(access);
    },
  );

  app.get(
    CHAT_UNREAD_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const unread = await chat.unread(getActorContext(request));
      void reply.header("Cache-Control", "no-store");
      return ChatUnreadDtoSchema.parse(unread);
    },
  );
  // Sending, unsending, block, unblock and report are generated from the
  // action registry (ADR 0040, http/app-actions.ts).
}
