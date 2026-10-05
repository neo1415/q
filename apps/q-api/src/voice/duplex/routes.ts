import type {
  FastifyInstance,
  FastifyReply,
  onRequestHookHandler,
} from "fastify";

import {
  parseContract,
  Q_VOICE_DUPLEX_END_PATH,
  Q_VOICE_DUPLEX_REJOIN_PATH,
  Q_VOICE_DUPLEX_TOOL_PATH,
  Q_VOICE_DUPLEX_USAGE_PATH,
  QVoiceDuplexEndSchema,
  QVoiceDuplexRejoinResultSchema,
  QVoiceDuplexRejoinSchema,
  QVoiceDuplexToolCallSchema,
  QVoiceDuplexToolResultSchema,
  QVoiceDuplexUsageReportSchema,
  QVoiceDuplexUsageResultSchema,
} from "@capital-q/contracts";

import { getActorContext } from "../../security/actor-context.js";
import type { DuplexBroker } from "./broker.js";

/**
 * The full-duplex line's three server routes (DUPLEX). Normal protected
 * requests: the actor comes from the hook, never the body, and a line that
 * is not this person's is the same 404 as a line that does not exist. The
 * browser reads a 404 as "the line is gone" and carries on with the
 * standard voice.
 */

const gone = (reply: FastifyReply) =>
  reply.code(404).send({
    type: "about:blank",
    title: "Not found",
    status: 404,
    detail: "No such voice line.",
  });

export function registerDuplexVoiceRoutes(
  app: FastifyInstance,
  dependencies: {
    readonly broker: DuplexBroker;
    /** The same onRequest hook the other voice routes use. */
    readonly withContext: onRequestHookHandler;
  },
): void {
  const { broker, withContext } = dependencies;
  const actorOf = getActorContext;
  const idOf = (params: unknown) =>
    (params as { voiceSessionId?: string }).voiceSessionId ?? "";

  app.post(
    Q_VOICE_DUPLEX_TOOL_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const call = parseContract(
        QVoiceDuplexToolCallSchema,
        request.body ?? {},
        "That tool call is not valid.",
      );
      // The person spoke over Q and the browser let go: stop the turn.
      const controller = new AbortController();
      reply.raw.once("close", () => {
        if (!reply.raw.writableFinished) controller.abort();
      });
      const result = await broker.tool({
        actor: actorOf(request),
        voiceSessionId: idOf(request.params),
        call,
        signal: controller.signal,
      });
      if (result === null) return gone(reply);
      return reply
        .code(200)
        .header("Cache-Control", "no-store")
        .send(QVoiceDuplexToolResultSchema.parse(result));
    },
  );

  app.post(
    Q_VOICE_DUPLEX_USAGE_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const report = parseContract(
        QVoiceDuplexUsageReportSchema,
        request.body ?? {},
        "That usage report is not valid.",
      );
      const result = await broker.usage({
        actor: actorOf(request),
        voiceSessionId: idOf(request.params),
        report,
      });
      if (result === null) return gone(reply);
      return reply
        .code(200)
        .header("Cache-Control", "no-store")
        .send(QVoiceDuplexUsageResultSchema.parse(result));
    },
  );

  // I1: a dropped line asks for a fresh call instead of falling back.
  app.post(
    Q_VOICE_DUPLEX_REJOIN_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const body = parseContract(
        QVoiceDuplexRejoinSchema,
        request.body ?? {},
        "That is not a reason to rejoin.",
      );
      const result = await broker.rejoin({
        actor: actorOf(request),
        voiceSessionId: idOf(request.params),
        cause: body.cause,
      });
      if (result === null) return gone(reply);
      return reply
        .code(200)
        .header("Cache-Control", "no-store")
        .send(QVoiceDuplexRejoinResultSchema.parse(result));
    },
  );

  app.post(
    Q_VOICE_DUPLEX_END_PATH,
    { onRequest: withContext },
    (request, reply) => {
      const body = parseContract(
        QVoiceDuplexEndSchema,
        request.body ?? {},
        "That is not a reason to end.",
      );
      broker.end({
        actor: actorOf(request),
        voiceSessionId: idOf(request.params),
        reason: body.reason,
        cause: body.cause,
        stats: body.stats,
      });
      // Ending a line that already ended is not an error.
      return reply.code(204).send();
    },
  );
}
