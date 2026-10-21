import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  Q_MEMORY_CORRECT_PATH,
  Q_MEMORY_FORGET_PATH,
  Q_MEMORY_LEARNING_PATH,
  Q_MEMORY_PATH,
  QMemoryCorrectionRequestSchema,
  QMemoryListDtoSchema,
  QPreferenceLearningChoiceRequestSchema,
  QPreferenceLearningDtoSchema,
} from "@capital-q/contracts";
import {
  MEMORY_QUOTE_MAX,
  type MemoryItem,
  type MemoryService,
  type PreferenceLearningConsent,
} from "@capital-q/q-knowledge";

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
  /** `remember` absent: no correction route (Forget still works). */
  readonly memory: Pick<MemoryService, "list" | "forget"> &
    Partial<Pick<MemoryService, "remember">>;
  /** Lane ob1: consent to learn how they like to work. Absent: no routes. */
  readonly learningConsent?: PreferenceLearningConsent | undefined;
};

/**
 * How Q came to know it, in the person's terms: their own quoted words,
 * their correction, or Q's reading of how they work (no quote kept).
 */
function originOf(item: MemoryItem): "SAID" | "CORRECTED" | "LEARNED" {
  if (item.memoryType === "correction") return "CORRECTED";
  return item.quote === null ? "LEARNED" : "SAID";
}

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
        origin: originOf(item),
        forgetsAt: item.validTo,
      })),
    });
  });

  const consent = dependencies.learningConsent;
  if (consent !== undefined) {
    // The caller's own decision, in their current workspace: the actor
    // is the session's, never the request's.
    app.get(
      Q_MEMORY_LEARNING_PATH,
      { onRequest: withContext },
      async (request, reply) => {
        void reply.header("Cache-Control", "no-store");
        return QPreferenceLearningDtoSchema.parse(
          await consent.state(getActorContext(request)),
        );
      },
    );
    // Safe to repeat: the same choice sets the same thing.
    app.post(
      Q_MEMORY_LEARNING_PATH,
      { onRequest: withContext },
      async (request, reply) => {
        const body = QPreferenceLearningChoiceRequestSchema.safeParse(
          request.body,
        );
        if (!body.success) {
          return reply.status(400).send({
            type: "about:blank",
            title: "Invalid request",
            status: 400,
            detail: "The choice is not valid.",
          });
        }
        void reply.header("Cache-Control", "no-store");
        return QPreferenceLearningDtoSchema.parse(
          await consent.decide(
            getActorContext(request),
            body.data.choice,
            body.data.via,
          ),
        );
      },
    );
  }

  const remember = dependencies.memory.remember;
  if (remember !== undefined) {
    // A correction is the person's own words, so it goes through the same
    // Write Gate as anything they tell Q: the words are the quote, checked
    // against what they typed. The new item takes the old one's type and
    // key, so the gate supersedes the old one: it stays in history, marked
    // superseded, and is never deleted.
    app.post(
      Q_MEMORY_CORRECT_PATH,
      { onRequest: withContext },
      async (request, reply) => {
        const params = ForgetParamsSchema.safeParse(request.params);
        if (!params.success) return reply.callNotFound();
        const body = QMemoryCorrectionRequestSchema.safeParse(request.body);
        if (!body.success) {
          return reply.status(400).send({
            type: "about:blank",
            title: "Invalid request",
            status: 400,
            detail: "Say what Q should remember, in a few words.",
          });
        }
        const actor = getActorContext(request);
        // Only the actor's own live memory: the list is theirs by session.
        const item = (await dependencies.memory.list(actor)).find(
          (candidate) => candidate.id === params.data.memoryItemId,
        );
        if (item === undefined) return reply.callNotFound();
        const content = body.data.content;
        const result = await remember({
          actor,
          candidate: {
            memoryType: item.memoryType,
            memoryKey: item.memoryKey,
            content,
            quote: content.slice(0, MEMORY_QUOTE_MAX),
            subject: item.subject,
            structuredValue: item.structuredValue,
          },
          writeMode: "USER_CONFIRMED",
          userTurns: [content],
          source: { conversationId: null, runId: null },
        });
        if (result.outcome === "REFUSED") {
          return reply.status(422).send({
            type: "about:blank",
            title: "Not remembered",
            status: 422,
            detail:
              result.reason === "SENSITIVE_CONTENT"
                ? "Q doesn't keep passwords, account numbers or ID numbers."
                : "That couldn't be remembered. Try different words.",
          });
        }
        void reply.header("Cache-Control", "no-store");
        return reply.status(204).send();
      },
    );
  }

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
