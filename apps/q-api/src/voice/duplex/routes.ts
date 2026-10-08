import type {
  FastifyInstance,
  FastifyReply,
  onRequestHookHandler,
} from "fastify";

import {
  parseContract,
  Q_VOICE_DUPLEX_END_PATH,
  Q_VOICE_DUPLEX_HEARD_PATH,
  Q_VOICE_DUPLEX_NARRATION_PATH,
  Q_VOICE_DUPLEX_SAID_PATH,
  Q_VOICE_DUPLEX_REJOIN_PATH,
  Q_VOICE_DUPLEX_TOOL_PATH,
  Q_VOICE_DUPLEX_USAGE_PATH,
  QVoiceDuplexEndSchema,
  QVoiceDuplexHeardResultSchema,
  QVoiceDuplexHeardSchema,
  QVoiceDuplexSaidSchema,
  QVoiceDuplexNarrationRequestSchema,
  QVoiceDuplexNarrationResultSchema,
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

  // VOICE-BRAIN: a finished turn of the person's; the server decides who
  // answers it, and runs Q for a substantive one.
  app.post(
    Q_VOICE_DUPLEX_HEARD_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const heard = parseContract(
        QVoiceDuplexHeardSchema,
        request.body ?? {},
        "That turn is not valid.",
      );
      const controller = new AbortController();
      reply.raw.once("close", () => {
        if (!reply.raw.writableFinished) controller.abort();
      });
      const result = await broker.heard({
        actor: actorOf(request),
        voiceSessionId: idOf(request.params),
        heard,
        signal: controller.signal,
      });
      if (result === null) return gone(reply);
      return reply
        .code(200)
        .header("Cache-Control", "no-store")
        .send(QVoiceDuplexHeardResultSchema.parse(result));
    },
  );

  // VOICE-BRAIN: what the voice said, for the line's transcript.
  app.post(
    Q_VOICE_DUPLEX_SAID_PATH,
    { onRequest: withContext },
    (request, reply) => {
      const said = parseContract(
        QVoiceDuplexSaidSchema,
        request.body ?? {},
        "That is not something said.",
      );
      const known = broker.said({
        actor: actorOf(request),
        voiceSessionId: idOf(request.params),
        said,
      });
      if (!known) return gone(reply);
      return reply.code(204).send();
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

  // ADR 0062: the silence ladder's beats while ask_q works (long poll).
  app.post(
    Q_VOICE_DUPLEX_NARRATION_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const body = parseContract(
        QVoiceDuplexNarrationRequestSchema,
        request.body ?? {},
        "That narration request is not valid.",
      );
      const controller = new AbortController();
      reply.raw.once("close", () => {
        if (!reply.raw.writableFinished) controller.abort();
      });
      const result = await broker.narration({
        actor: actorOf(request),
        voiceSessionId: idOf(request.params),
        after: body.after,
        signal: controller.signal,
      });
      if (result === null) return gone(reply);
      return reply
        .code(200)
        .header("Cache-Control", "no-store")
        .send(QVoiceDuplexNarrationResultSchema.parse(result));
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
