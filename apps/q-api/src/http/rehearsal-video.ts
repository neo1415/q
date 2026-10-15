import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  createProblemDetails,
  EndRehearsalVideoRequestSchema,
  EndRehearsalVideoResponseSchema,
  PROBLEM_CONTENT_TYPE,
  Q_REHEARSAL_VIDEO_BRIDGE_BASE_PATH,
  Q_REHEARSAL_VIDEO_EVENTS_BASE_PATH,
  Q_REHEARSAL_VIDEO_END_PATH,
  Q_REHEARSAL_VIDEO_INTERVIEWERS_PATH,
  Q_REHEARSAL_VIDEO_PATH,
  RehearsalInterviewersDtoSchema,
  RehearsalVideoSessionDtoSchema,
  StartRehearsalVideoRequestSchema,
  StartRehearsalVideoResponseSchema,
} from "@capital-q/contracts";

import {
  isTavusConnectivityCheck,
  TAVUS_CONNECTIVITY_REPLY,
  type BridgeMessage,
  type BridgeResult,
  type RehearsalVideoService,
} from "../composition/rehearsal-video.js";
import { sentences } from "../voice/speech.js";
import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * Video rehearsals (ADR 0066). The founder's routes are cookie/bearer
 * authenticated like every rehearsal route, and the service answers only
 * for the rehearsal's own founder (someone else's is the same 404 as
 * none). The bridge is the one route the provider calls: authenticated by
 * the per-session bearer the Q API issued for that session alone, never a
 * person's token; it speaks the OpenAI chat-completions stream because
 * that is what the provider sends, and nothing behind it is a second
 * model: each line is the existing rehearsal service's.
 */

export type RehearsalVideoRoutesDependencies = ActorContextDependencies & {
  readonly video: RehearsalVideoService;
};

const RehearsalParamsSchema = z
  .object({ rehearsalId: z.string().uuid() })
  .strict();
const BridgeParamsSchema = z
  .object({ videoSessionId: z.string().uuid() })
  .strict();

const EventParamsSchema = z
  .object({
    videoSessionId: z.string().uuid(),
    token: z.string().min(32).max(128),
  })
  .strict();
/** The provider's callback: only these fields are read. */
const EventBodySchema = z
  .object({
    event_type: z.string().max(80),
    conversation_id: z.string().max(128).optional(),
  })
  .passthrough();

/** What the provider sends; anything beyond messages is ignored. */
const BridgeBodySchema = z
  .object({
    messages: z
      .array(z.object({ role: z.string().max(40), content: z.unknown() }))
      .max(300),
  })
  .passthrough();

type ProblemCode =
  | "RESOURCE_NOT_FOUND"
  | "PERMISSION_DENIED"
  | "RESOURCE_CONFLICT"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "AUTHENTICATION_REQUIRED";

function problem(
  request: FastifyRequest,
  reply: FastifyReply,
  code: ProblemCode,
  detail: string,
) {
  const body = createProblemDetails({ code, requestId: request.id, detail });
  return reply
    .status(body.status)
    .type(PROBLEM_CONTENT_TYPE)
    .header("Cache-Control", "no-store")
    .send(body);
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) =>
        part !== null &&
        typeof part === "object" &&
        typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .join(" ")
      .trim();
  }
  return "";
}

function chunk(
  id: string,
  delta: Record<string, unknown>,
  finish: string | null,
) {
  return `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "capital-q-rehearsal",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
}

export function registerRehearsalVideoRoutes(
  app: FastifyInstance,
  dependencies: RehearsalVideoRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const { video } = dependencies;

  app.get(
    Q_REHEARSAL_VIDEO_INTERVIEWERS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      void reply.header("Cache-Control", "no-store");
      return RehearsalInterviewersDtoSchema.parse(
        await video.interviewers(getActorContext(request)),
      );
    },
  );

  app.get(
    Q_REHEARSAL_VIDEO_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = RehearsalParamsSchema.safeParse(request.params);
      if (!params.success) return reply.callNotFound();
      const session = await video.get(
        getActorContext(request),
        params.data.rehearsalId,
      );
      if (session === null) {
        return problem(request, reply, "RESOURCE_NOT_FOUND", "Not found.");
      }
      void reply.header("Cache-Control", "no-store");
      return RehearsalVideoSessionDtoSchema.parse(session);
    },
  );

  // Idempotent by construction: one session per rehearsal, so a retried
  // start (any Idempotency-Key, or none) answers with the same session.
  app.post(
    Q_REHEARSAL_VIDEO_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = RehearsalParamsSchema.safeParse(request.params);
      if (!params.success) return reply.callNotFound();
      const body = StartRehearsalVideoRequestSchema.safeParse(request.body);
      if (!body.success) {
        return problem(request, reply, "INVALID_REQUEST", "Invalid request.");
      }
      const result = await video.start(
        getActorContext(request),
        params.data.rehearsalId,
        body.data.interviewerId,
      );
      switch (result.kind) {
        case "OK":
          void reply.header("Cache-Control", "no-store");
          return StartRehearsalVideoResponseSchema.parse(result.response);
        case "NOT_FOUND":
          return problem(request, reply, "RESOURCE_NOT_FOUND", "Not found.");
        case "NOT_A_FOUNDER":
          return problem(
            request,
            reply,
            "PERMISSION_DENIED",
            "Video rehearsals require an authorized participant account.",
          );
        case "UNKNOWN_INTERVIEWER":
          return problem(
            request,
            reply,
            "INVALID_REQUEST",
            "That interviewer isn't available.",
          );
        case "FINISHED":
          return problem(
            request,
            reply,
            "RESOURCE_CONFLICT",
            "This rehearsal has finished.",
          );
        case "ALREADY_USED":
          return problem(
            request,
            reply,
            "RESOURCE_CONFLICT",
            "This rehearsal's video call has ended. Carry on by voice.",
          );
      }
    },
  );

  app.post(
    Q_REHEARSAL_VIDEO_END_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = RehearsalParamsSchema.safeParse(request.params);
      if (!params.success) return reply.callNotFound();
      const body = EndRehearsalVideoRequestSchema.safeParse(request.body ?? {});
      if (!body.success) {
        return problem(request, reply, "INVALID_REQUEST", "Invalid request.");
      }
      const result = await video.end(
        getActorContext(request),
        params.data.rehearsalId,
        { continueByVoice: body.data.continueByVoice === true },
      );
      switch (result.kind) {
        case "OK":
          void reply.header("Cache-Control", "no-store");
          return EndRehearsalVideoResponseSchema.parse({
            session: result.session,
            rehearsal: result.rehearsal,
          });
        case "NOT_FOUND":
          return problem(request, reply, "RESOURCE_NOT_FOUND", "Not found.");
        case "PROVIDER_UNAVAILABLE":
          return problem(
            request,
            reply,
            "PROVIDER_UNAVAILABLE",
            "The video provider has not confirmed the call ended. Try again in a moment.",
          );
        case "Q_UNAVAILABLE":
          return problem(
            request,
            reply,
            "PROVIDER_UNAVAILABLE",
            "Q couldn't finish the review just now. Try again in a moment.",
          );
      }
    },
  );

  // The provider's room events. No actor hook: the path secret is the
  // session's own, and an unknown one is the same 404 as any unknown route.
  app.post(
    `${Q_REHEARSAL_VIDEO_EVENTS_BASE_PATH}/:token`,
    { bodyLimit: 64_000 },
    async (request, reply) => {
      const params = EventParamsSchema.safeParse(request.params);
      const body = EventBodySchema.safeParse(request.body);
      if (!params.success)
        return problem(request, reply, "RESOURCE_NOT_FOUND", "Not found.");
      if (!body.success)
        return problem(request, reply, "INVALID_REQUEST", "Invalid request.");
      const result = await video.providerEvent({
        sessionId: params.data.videoSessionId,
        token: params.data.token,
        eventType: body.data.event_type,
        conversationId: body.data.conversation_id ?? null,
      });
      if (result === "UNKNOWN_SESSION")
        return problem(request, reply, "RESOURCE_NOT_FOUND", "Not found.");
      return reply.status(204).header("Cache-Control", "no-store").send();
    },
  );

  // The provider's bridge. No actor hook: the bearer is the session's own.
  app.post(
    `${Q_REHEARSAL_VIDEO_BRIDGE_BASE_PATH}/chat/completions`,
    { bodyLimit: 512_000 },
    async (request, reply) => {
      const params = BridgeParamsSchema.safeParse(request.params);
      const header = request.headers.authorization;
      const bearer =
        typeof header === "string" && header.startsWith("Bearer ")
          ? header.slice("Bearer ".length).trim()
          : "";
      const body = BridgeBodySchema.safeParse(request.body);
      if (!params.success || bearer.length === 0) {
        return problem(
          request,
          reply,
          "AUTHENTICATION_REQUIRED",
          "Authentication required.",
        );
      }
      if (!body.success) {
        return problem(request, reply, "INVALID_REQUEST", "Invalid request.");
      }
      const messages: BridgeMessage[] = body.data.messages.map((message) => ({
        role: message.role,
        text: contentText(message.content).slice(0, 8_000),
      }));
      const controller = new AbortController();
      // The provider drops the request when the founder speaks over the
      // line: the turn is abandoned and the newer words arrive next.
      reply.raw.on("close", () => {
        if (!reply.raw.writableFinished) controller.abort();
      });
      // The provider's own setup probe: answered, never a founder turn.
      const result: BridgeResult = isTavusConnectivityCheck(
        messages.filter((m) => m.role === "user").map((m) => m.text),
      )
        ? { kind: "LINE" as const, text: TAVUS_CONNECTIVITY_REPLY }
        : await video.bridge(
            params.data.videoSessionId,
            bearer,
            messages,
            controller.signal,
          );
      if (result.kind === "UNAUTHORISED") {
        return problem(
          request,
          reply,
          "AUTHENTICATION_REQUIRED",
          "Authentication required.",
        );
      }
      if (controller.signal.aborted) return reply;
      const id = `chatcmpl-${randomUUID()}`;
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });
      raw.write(chunk(id, { role: "assistant" }, null));
      if (result.kind === "LINE") {
        const parts = sentences(result.text);
        for (const [index, part] of parts.entries()) {
          raw.write(
            chunk(
              id,
              { content: index === parts.length - 1 ? part : `${part} ` },
              null,
            ),
          );
        }
      }
      raw.write(chunk(id, {}, "stop"));
      raw.write("data: [DONE]\n\n");
      raw.end();
      return reply;
    },
  );
}
