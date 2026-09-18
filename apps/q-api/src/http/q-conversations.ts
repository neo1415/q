import type { ApplicationIdentityLookup } from "@capital-q/security/postgres";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  CorrelationIdSchema,
  ListQConversationsQuerySchema,
  ListQConversationsResponseSchema,
  parseContract,
  Q_CONVERSATION_ARCHIVE_SUFFIX,
  Q_CONVERSATIONS_PATH,
  QConversationDetailSchema,
  QConversationIdSchema,
  type CorrelationId,
  type QConversationId,
} from "@capital-q/contracts";
import { createCorrelationId } from "@capital-q/observability";
import type { QRuntimeService } from "@capital-q/q-runtime";

import {
  getActorContext,
  requireActorContextHook,
  requireActorContextOrPersonalHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * `/v1/q/conversations` — a person's conversations with Q (ADR 0012).
 *
 * Owner-only, like a run: the actor comes from the verified session and
 * the runtime answers "not found" for anything that is not theirs. The
 * list is cursor-paged by last activity; the detail carries the recent
 * turns and the latest run's handle so a client can pick up a run still
 * in flight. Archiving is the one change, and it is idempotent.
 */

export type QConversationRoutesDependencies = ActorContextDependencies & {
  readonly qRuntime: Pick<
    QRuntimeService,
    "listConversations" | "getConversation" | "archiveConversation"
  >;
  /** As on the run routes: a person with no organisation yet still has conversations. */
  readonly identity?: ApplicationIdentityLookup | undefined;
};

function correlation(): CorrelationId {
  return CorrelationIdSchema.parse(createCorrelationId());
}

function conversationIdParam(request: FastifyRequest): QConversationId {
  const params = request.params as Record<string, unknown>;
  return parseContract(
    QConversationIdSchema,
    params["conversationId"],
    "The conversation identifier is not valid.",
  );
}

export function registerQConversationRoutes(
  app: FastifyInstance,
  dependencies: QConversationRoutesDependencies,
): void {
  const identity = dependencies.identity;
  const withContext =
    identity === undefined
      ? requireActorContextHook(dependencies)
      : requireActorContextOrPersonalHook({ ...dependencies, identity });
  const service = dependencies.qRuntime;
  const conversationPath = `${Q_CONVERSATIONS_PATH}/:conversationId`;

  app.get(
    Q_CONVERSATIONS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const query = parseContract(
        ListQConversationsQuerySchema,
        request.query ?? {},
        "The conversation listing request is not valid.",
      );
      const result = await service.listConversations({
        actor: getActorContext(request),
        limit: query.limit,
        before: query.before,
      });
      return reply.header("Cache-Control", "no-store").send(
        ListQConversationsResponseSchema.parse({
          items: result.items,
          ...(result.nextBefore === undefined
            ? {}
            : { nextBefore: result.nextBefore }),
        }),
      );
    },
  );

  app.get(
    conversationPath,
    { onRequest: withContext },
    async (request, reply) => {
      const result = await service.getConversation({
        actor: getActorContext(request),
        conversationId: conversationIdParam(request),
        correlationId: correlation(),
      });
      return reply
        .header("Cache-Control", "no-store")
        .send(QConversationDetailSchema.parse(result.detail));
    },
  );

  app.post(
    `${conversationPath}${Q_CONVERSATION_ARCHIVE_SUFFIX}`,
    { onRequest: withContext },
    async (request, reply) => {
      await service.archiveConversation({
        actor: getActorContext(request),
        conversationId: conversationIdParam(request),
        correlationId: correlation(),
      });
      return reply.code(204).header("Cache-Control", "no-store").send();
    },
  );
}
