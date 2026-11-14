import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  createProblemDetails,
  GATEQ_APPLY_VOICE_END_PATH,
  GATEQ_APPLY_VOICE_PATH,
  GATEQ_VOICE_BRIDGE_PATH,
  GateqVideoBridgeBodySchema,
  GateqVoiceEndRequestSchema,
  GateqVoiceStartRequestSchema,
  GateqVoiceStateDtoSchema,
  PROBLEM_CONTENT_TYPE,
} from "@capital-q/contracts";
import {
  GATEQ_VOICE_CLOSED_LINE,
  GATEQ_VOICE_RETRY_LINE,
  GateqVoiceRefusedError,
  IntakeRefusedError,
  type GateqVoiceInterview,
  type GateqVoiceSessionView,
} from "@capital-q/gateq-intake";

/**
 * The GateQ voice-only interview (directive 2026-11-14 item 4). The
 * applicant's routes take their guest credential exactly as the typed
 * interview's do: anything forged, expired or another application's is
 * the same 404. The bridge is the speech provider's alone, authenticated
 * by the per-line bearer, and speaks the OpenAI chat-completions stream
 * the provider's think step expects. Nothing behind it is a second model:
 * each reply is the canonical GateQ interviewer's, recorded as a normal
 * turn with channel "voice".
 */
export type GateqVoiceRoutesDependencies = {
  readonly voice: GateqVoiceInterview;
};

const DISCLOSURE =
  "Q is an AI interviewer. This voice interview is transcribed into your application; nothing reaches the investor until you review and submit.";

/** An empty delta keeps the provider's think call open while Q works. */
const KEEP_ALIVE_MS = 4_000;

function credential(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (typeof header !== "string") return "";
  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" ? (value ?? "") : "";
}

function problem(
  request: FastifyRequest,
  reply: FastifyReply,
  code:
    | "RESOURCE_NOT_FOUND"
    | "RESOURCE_CONFLICT"
    | "INVALID_REQUEST"
    | "AUTHENTICATION_REQUIRED",
  detail: string,
) {
  const body = createProblemDetails({ code, requestId: request.id, detail });
  return reply
    .status(body.status)
    .type(PROBLEM_CONTENT_TYPE)
    .header("Cache-Control", "no-store")
    .send(body);
}

const REFUSAL_WORDS: Record<GateqVoiceRefusedError["reason"], string> = {
  DISABLED: "Voice interviews aren't switched on. You can continue by typing.",
  ALLOWANCE_EXHAUSTED:
    "This application's voice sessions are used up. You can continue by typing.",
  CONCURRENCY_LIMIT:
    "Voice interviews are busy right now. You can continue by typing.",
  PROVIDER_UNAVAILABLE:
    "The voice line isn't available right now. You can continue by typing.",
};

const dto = (session: GateqVoiceSessionView | null) =>
  session === null ? null : { ...session, disclosure: DISCLOSURE };

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((part: unknown) =>
        part !== null &&
        typeof part === "object" &&
        typeof Reflect.get(part, "text") === "string"
          ? String(Reflect.get(part, "text"))
          : "",
      )
      .join(" ");
  return "";
}

const chunk = (
  id: string,
  delta: Record<string, unknown>,
  finish: string | null,
) =>
  `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "capital-q-gateq-interview",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;

export function registerGateqVoiceRoutes(
  app: FastifyInstance,
  dependencies: GateqVoiceRoutesDependencies,
): void {
  const { voice } = dependencies;

  const refused = (
    error: unknown,
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    if (error instanceof IntakeRefusedError)
      return problem(request, reply, "RESOURCE_NOT_FOUND", "Not found.");
    if (error instanceof GateqVoiceRefusedError)
      return problem(
        request,
        reply,
        "RESOURCE_CONFLICT",
        REFUSAL_WORDS[error.reason],
      );
    throw error;
  };

  app.get(GATEQ_APPLY_VOICE_PATH, async (request, reply) => {
    const token = credential(request);
    try {
      const [availability, session] = await Promise.all([
        voice.availability(token),
        voice.current(token),
      ]);
      void reply.header("Cache-Control", "no-store");
      return GateqVoiceStateDtoSchema.parse({
        available: availability.available,
        session: dto(session),
        unavailableReason: availability.reason,
        perApplication: voice.perApplication,
        remaining: availability.remaining,
      });
    } catch (error: unknown) {
      return refused(error, request, reply);
    }
  });

  app.post(GATEQ_APPLY_VOICE_PATH, async (request, reply) => {
    const token = credential(request);
    const body = GateqVoiceStartRequestSchema.safeParse(request.body ?? {});
    if (!body.success)
      return problem(request, reply, "INVALID_REQUEST", "Invalid request.");
    try {
      const opened = await voice.start({
        token,
        correlationId: randomUUID(),
        ...(body.data.locale === undefined ? {} : { locale: body.data.locale }),
      });
      const after = await voice.availability(token).catch(() => null);
      // The line credential is short-lived and for this browser only.
      void reply.header("Cache-Control", "no-store");
      return GateqVoiceStateDtoSchema.parse({
        available: true,
        session: dto(opened.session),
        unavailableReason: null,
        perApplication: voice.perApplication,
        remaining: after?.remaining ?? 0,
        line:
          opened.line.provider === "deepgram"
            ? { ...opened.line, agent: { ...opened.line.agent } }
            : { ...opened.line },
      });
    } catch (error: unknown) {
      return refused(error, request, reply);
    }
  });

  app.post(GATEQ_APPLY_VOICE_END_PATH, async (request, reply) => {
    const token = credential(request);
    const body = GateqVoiceEndRequestSchema.safeParse(request.body);
    if (!body.success)
      return problem(request, reply, "INVALID_REQUEST", "Invalid request.");
    try {
      const session = await voice.end({
        token,
        continueByTyping: body.data.continueByTyping,
      });
      const after = await voice.availability(token).catch(() => null);
      void reply.header("Cache-Control", "no-store");
      return GateqVoiceStateDtoSchema.parse({
        available: after?.available ?? false,
        session: dto(session),
        unavailableReason: after?.reason ?? null,
        perApplication: voice.perApplication,
        remaining: after?.remaining ?? 0,
      });
    } catch (error: unknown) {
      return refused(error, request, reply);
    }
  });

  // The provider's think call. No guest credential: the bearer is the line's.
  app.post(
    `${GATEQ_VOICE_BRIDGE_PATH}/chat/completions`,
    { bodyLimit: 512_000 },
    async (request, reply) => {
      const bearer = credential(request);
      if (bearer.length === 0)
        return problem(
          request,
          reply,
          "AUTHENTICATION_REQUIRED",
          "Authentication required.",
        );
      const body = GateqVideoBridgeBodySchema.safeParse(request.body);
      if (!body.success)
        return problem(request, reply, "INVALID_REQUEST", "Invalid request.");
      const users = body.data.messages.filter((m) => m.role === "user");
      const last = users.at(-1);
      // Authenticate before the stream opens, so a stranger gets a 401,
      // never an open stream.
      if (!(await voice.knowsLine(bearer)))
        return problem(
          request,
          reply,
          "AUTHENTICATION_REQUIRED",
          "Authentication required.",
        );
      const id = `chatcmpl-${randomUUID()}`;
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });
      raw.write(chunk(id, { role: "assistant" }, null));
      const keepAlive = setInterval(() => {
        if (!raw.writableEnded) raw.write(chunk(id, { content: "" }, null));
      }, KEEP_ALIVE_MS);
      // A failed turn is spoken as a short retry, never a broken stream: the
      // line was not recorded, so saying it again is the same turn.
      const result = await voice
        .bridgeTurn({
          bearer,
          utterance: last === undefined ? "" : contentText(last.content),
          // The Nth thing heard on this line is the same turn on redelivery.
          utteranceId: `user-${String(users.length)}`,
          correlationId: randomUUID(),
        })
        .catch(() => ({
          kind: "REPLY" as const,
          reply: GATEQ_VOICE_RETRY_LINE,
        }));
      clearInterval(keepAlive);
      const said =
        result.kind === "REPLY"
          ? result.reply
          : result.kind === "CLOSED"
            ? GATEQ_VOICE_CLOSED_LINE
            : "";
      if (said !== "") raw.write(chunk(id, { content: said }, null));
      raw.write(chunk(id, {}, "stop"));
      raw.write("data: [DONE]\n\n");
      raw.end();
      return reply;
    },
  );
}
