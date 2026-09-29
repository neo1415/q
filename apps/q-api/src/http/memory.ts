import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  Q_MEMORY_FORGET_PATH,
  Q_MEMORY_PATH,
  QMemoryListDtoSchema,
} from "@capital-q/contracts";
import type { MemoryService } from "@capital-q/q-knowledge";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * What Q remembers about the person, for them (ADR 0012; founder live
 * 2026-09-29). Thin: the service scopes every read and write to the
 * actor's own memory, from the session. Forgetting something that is not
 * theirs, or already forgotten, is the same 404.
 */

export type MemoryRoutesDependencies = ActorContextDependencies & {
  readonly memory: Pick<MemoryService, "list" | "forget">;
};

const ForgetParamsSchema = z
  .object({ memoryItemId: z.string().uuid() })
  .strict();

export function registerMemoryRoutes(
  app: FastifyInstance,
  dependencies: MemoryRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);

  app.get(Q_MEMORY_PATH, { onRequest: withContext }, async (request, reply) => {
    const items = await dependencies.memory.list(getActorContext(request));
    void reply.header("Cache-Control", "no-store");
    return QMemoryListDtoSchema.parse({
      items: items.map((item) => ({
        memoryItemId: item.id,
        kind: item.memoryType,
        content: item.content.slice(0, 2_000),
        quote: item.quote === null ? null : item.quote.slice(0, 2_000),
        about: item.subject?.subjectType === "COMPANY" ? "COMPANY" : "YOU",
        learnedAt: item.createdAt,
      })),
    });
  });

  app.post(
    Q_MEMORY_FORGET_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = ForgetParamsSchema.safeParse(request.params);
      if (!params.success) return reply.callNotFound();
      const forgotten = await dependencies.memory.forget({
        actor: getActorContext(request),
        memoryItemId: params.data.memoryItemId,
      });
      if (forgotten === null) return reply.callNotFound();
      return reply.status(204).send();
    },
  );
}
