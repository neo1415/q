import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  CHAT_UNREAD_PATH,
  ChatAttachmentAccessDtoSchema,
  ChatReportResultDtoSchema,
  ChatListQuerySchema,
  ChatThreadDtoSchema,
  ChatUnreadDtoSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  MarkChatReadRequestSchema,
  parseContract,
  RELATIONSHIP_CHAT_BLOCK_PATH,
  RELATIONSHIP_CHAT_REPORTS_PATH,
  RELATIONSHIP_CHAT_UNBLOCK_PATH,
  RELATIONSHIP_MESSAGE_ATTACHMENT_PATH,
  RELATIONSHIP_MESSAGE_UNSEND_PATH,
  RELATIONSHIP_MESSAGES_PATH,
  RELATIONSHIP_MESSAGES_READ_PATH,
  ReportChatRequestSchema,
  SendChatMessageRequestSchema,
  SendChatMessageResultDtoSchema,
} from "@capital-q/contracts";
import type {
  ChatSafetyService,
  ChatService,
} from "@capital-q/communication";

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

function idempotencyKeyOf(
  request: FastifyRequest,
  detail = "An Idempotency-Key header is required to send a message.",
): string {
  const raw = request.headers[IDEMPOTENCY_KEY_HEADER];
  return parseContract(
    IdempotencyKeyHeaderSchema,
    typeof raw === "string" ? raw : undefined,
    detail,
  );
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
    RELATIONSHIP_MESSAGES_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const idempotencyKey = idempotencyKeyOf(request);
      const input = parseContract(
        SendChatMessageRequestSchema,
        request.body,
        "The message is not valid.",
      );
      const result = await chat.send({
        actor: getActorContext(request),
        relationshipId: param(request, "relationshipId"),
        request: input,
        idempotencyKey,
      });
      void reply
        .status(result.deduplicated ? 200 : 201)
        .header("Cache-Control", "no-store");
      return SendChatMessageResultDtoSchema.parse(result);
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

  app.post(
    RELATIONSHIP_MESSAGE_UNSEND_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const idempotencyKey = idempotencyKeyOf(request);
      await chat.unsend({
        actor: getActorContext(request),
        relationshipId: param(request, "relationshipId"),
        messageId: param(request, "messageId"),
        idempotencyKey,
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

  const { safety } = dependencies;
  if (safety === undefined) return;

  // R34 safety (doc 10): a person blocks or reports for their own side.
  // The other side is never told who blocked; its sends answer 409 with
  // "You can't message this relationship right now".
  app.post(
    RELATIONSHIP_CHAT_BLOCK_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const idempotencyKey = idempotencyKeyOf(
        request,
        "An Idempotency-Key header is required to block.",
      );
      await safety.block({
        actor: getActorContext(request),
        relationshipId: param(request, "relationshipId"),
        idempotencyKey,
      });
      return reply.status(204).header("Cache-Control", "no-store").send();
    },
  );

  app.post(
    RELATIONSHIP_CHAT_UNBLOCK_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      // Lifting is naturally idempotent; the key is still required so a
      // client treats it like every other consequential POST.
      idempotencyKeyOf(request, "An Idempotency-Key header is required to unblock.");
      await safety.unblock({
        actor: getActorContext(request),
        relationshipId: param(request, "relationshipId"),
      });
      return reply.status(204).header("Cache-Control", "no-store").send();
    },
  );

  app.post(
    RELATIONSHIP_CHAT_REPORTS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const idempotencyKey = idempotencyKeyOf(
        request,
        "An Idempotency-Key header is required to report.",
      );
      const input = parseContract(
        ReportChatRequestSchema,
        request.body,
        "The report is not valid.",
      );
      const result = await safety.report({
        actor: getActorContext(request),
        relationshipId: param(request, "relationshipId"),
        request: input,
        idempotencyKey,
      });
      void reply
        .status(result.deduplicated ? 200 : 201)
        .header("Cache-Control", "no-store");
      return ChatReportResultDtoSchema.parse(result);
    },
  );
}
