import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  createProblemDetails,
  GATEQ_APPLY_VIDEO_END_PATH,
  GATEQ_APPLY_VIDEO_PATH,
  GATEQ_VIDEO_BRIDGE_PATH,
  GateqVideoBridgeBodySchema,
  GateqVideoEndRequestSchema,
  GateqVideoStateDtoSchema,
  PROBLEM_CONTENT_TYPE,
} from "@capital-q/contracts";
import {
  GateqVideoRefusedError,
  IntakeRefusedError,
  type GateqVideoInterview,
  type GateqVideoSessionView,
} from "@capital-q/gateq-intake";

/**
 * The GateQ video interview (directive C3). The applicant's routes take
 * their guest credential exactly as the typed interview's do; anything
 * forged, expired or another application's is the same 404. The bridge is
 * the provider's alone, authenticated by the per-session bearer, and
 * speaks the OpenAI chat-completions stream the provider sends. Nothing
 * behind it is a second model: each line is the canonical GateQ
 * interviewer's reply, recorded as a normal turn with its lineage.
 */
export type GateqVideoRoutesDependencies = {
  readonly video: GateqVideoInterview;
};

const DISCLOSURE =
  "Q is an AI interviewer. This video interview is transcribed into your application; nothing reaches the investor until you review and submit.";

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

const REFUSAL_WORDS: Record<GateqVideoRefusedError["reason"], string> = {
  DISABLED: "Video interviews aren't switched on. You can continue by typing.",
  ALLOWANCE_EXHAUSTED:
    "Your video interviews are used up for now. You can continue by typing.",
  CONCURRENCY_LIMIT:
    "Video interviews are busy right now. You can continue by typing.",
  PROVIDER_UNAVAILABLE:
    "The video room isn't available right now. You can continue by typing.",
};

const dto = (session: GateqVideoSessionView | null) =>
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

export function registerGateqVideoRoutes(
  app: FastifyInstance,
  dependencies: GateqVideoRoutesDependencies,
): void {
  const { video } = dependencies;

  const notFound = (
    error: unknown,
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    if (error instanceof IntakeRefusedError)
      return problem(request, reply, "RESOURCE_NOT_FOUND", "Not found.");
    if (error instanceof GateqVideoRefusedError)
      return problem(
        request,
        reply,
        "RESOURCE_CONFLICT",
        REFUSAL_WORDS[error.reason],
      );
    throw error;
  };

  app.get(GATEQ_APPLY_VIDEO_PATH, async (request, reply) => {
    const token = credential(request);
    try {
      const [available, session, allowance] = await Promise.all([
        video.available(token),
        video.current(token),
        // Wording only: a failed read never hides typing or the session.
        video.allowance(token).catch(() => null),
      ]);
      void reply.header("Cache-Control", "no-store");
      return GateqVideoStateDtoSchema.parse({
        available,
        session: dto(session),
        allowance,
      });
    } catch (error: unknown) {
      return notFound(error, request, reply);
    }
  });

  app.post(GATEQ_APPLY_VIDEO_PATH, async (request, reply) => {
    const token = credential(request);
    try {
      const session = await video.start({
        token,
        correlationId: randomUUID(),
      });
      void reply.header("Cache-Control", "no-store");
      return GateqVideoStateDtoSchema.parse({
        available: true,
        session: dto(session),
      });
    } catch (error: unknown) {
      return notFound(error, request, reply);
    }
  });

  app.post(GATEQ_APPLY_VIDEO_END_PATH, async (request, reply) => {
    const token = credential(request);
    const body = GateqVideoEndRequestSchema.safeParse(request.body);
    if (!body.success)
      return problem(request, reply, "INVALID_REQUEST", "Invalid request.");
    try {
      const session = await video.end({
        token,
        continueByTyping: body.data.continueByTyping,
      });
      void reply.header("Cache-Control", "no-store");
      return GateqVideoStateDtoSchema.parse({
        available: false,
        session: dto(session),
      });
    } catch (error: unknown) {
      return notFound(error, request, reply);
    }
  });

  // The provider's bridge. No guest credential: the bearer is the session's.
  app.post(
    GATEQ_VIDEO_BRIDGE_PATH,
    { bodyLimit: 512_000 },
    async (request, reply) => {
      const bearer = credential(request);
      const body = GateqVideoBridgeBodySchema.safeParse(request.body);
      if (bearer.length === 0)
        return problem(
          request,
          reply,
          "AUTHENTICATION_REQUIRED",
          "Authentication required.",
        );
      if (!body.success)
        return problem(request, reply, "INVALID_REQUEST", "Invalid request.");
      const users = body.data.messages.filter((m) => m.role === "user");
      const last = users.at(-1);
      // The Nth thing the applicant said is the same line on redelivery.
      // A failed turn is spoken as a short retry, never a broken stream;
      // the line was not recorded, so saying it again is the same turn.
      const result = await video
        .bridgeTurn({
          bearer,
          utterance: last === undefined ? "" : contentText(last.content),
          utteranceId: `user-${String(users.length)}`,
          correlationId: randomUUID(),
        })
        .catch(() => ({
          kind: "REPLY" as const,
          reply: "Sorry, I lost that for a second. Could you say it again?",
        }));
      if (result.kind === "UNKNOWN_SESSION")
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
      if (result.kind === "REPLY" && result.reply !== "")
        raw.write(chunk(id, { content: result.reply }, null));
      raw.write(chunk(id, {}, "stop"));
      raw.write("data: [DONE]\n\n");
      raw.end();
      return reply;
    },
  );
}
