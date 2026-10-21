import { randomBytes, randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import {
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
} from "@capital-q/contracts";

import type { BridgeMessage } from "../composition/rehearsal-video.js";
import type { MeetingFaceService } from "../composition/meeting-face.js";
import type { MeetingFacePageHub } from "../composition/meeting-face-page.js";
import {
  meetingFacePageCsp,
  meetingFacePageHtml,
} from "./meeting-face-page.js";
import { sentences } from "../voice/speech.js";
import { chunk, contentText } from "./rehearsal-video.js";

/**
 * The bridge Q's meeting face calls as its LLM (owner decision 35). It is
 * the provider's route, not a person's: authenticated only by the bearer
 * the Q API issued for that one face session, never a cookie or a user
 * token. It speaks the OpenAI chat-completions stream because that is what
 * the provider sends; nothing behind it is a model (the meeting host
 * decides every line).
 */

export const Q_MEETING_FACE_BRIDGE_BASE_PATH =
  "/v1/q/meetings/face/bridge/:faceSessionId" as const;

export const qMeetingFaceBridgeBasePath = (faceSessionId: string) =>
  Q_MEETING_FACE_BRIDGE_BASE_PATH.replace(
    ":faceSessionId",
    encodeURIComponent(faceSessionId),
  );

const ParamsSchema = z.object({ faceSessionId: z.string().uuid() }).strict();

/** CAMERA mode: the page the note-taker shows as its camera. */
export const Q_MEETING_FACE_PAGE_PATH =
  "/v1/q/meetings/face/page/:meetingId" as const;

export const qMeetingFacePagePath = (meetingId: string) =>
  Q_MEETING_FACE_PAGE_PATH.replace(":meetingId", encodeURIComponent(meetingId));

const PageParamsSchema = z.object({ meetingId: z.string().uuid() }).strict();
const PageQuerySchema = z
  .object({ k: z.string().min(16).max(128) })
  .passthrough();

const BodySchema = z
  .object({
    messages: z
      .array(z.object({ role: z.string().max(40), content: z.unknown() }))
      .max(300),
  })
  .passthrough();

export function registerMeetingFaceRoutes(
  app: FastifyInstance,
  dependencies: {
    readonly face: Pick<MeetingFaceService, "bridge" | "room">;
    /** CAMERA mode only; absent, the page routes do not exist. */
    readonly page?: MeetingFacePageHub | undefined;
  },
): void {
  const page = dependencies.page;
  if (page !== undefined) registerPageRoutes(app, dependencies.face, page);
  app.post(
    `${Q_MEETING_FACE_BRIDGE_BASE_PATH}/chat/completions`,
    { bodyLimit: 512_000 },
    async (request, reply) => {
      const params = ParamsSchema.safeParse(request.params);
      const header = request.headers.authorization;
      const bearer =
        typeof header === "string" && header.startsWith("Bearer ")
          ? header.slice("Bearer ".length).trim()
          : "";
      const body = BodySchema.safeParse(request.body);
      const refuse = (code: "INVALID_REQUEST" | "AUTHENTICATION_REQUIRED") => {
        const problem = createProblemDetails({
          code,
          requestId: request.id,
          detail:
            code === "INVALID_REQUEST"
              ? "Invalid request."
              : "Authentication required.",
        });
        return reply
          .status(problem.status)
          .type(PROBLEM_CONTENT_TYPE)
          .header("Cache-Control", "no-store")
          .send(problem);
      };
      if (!params.success || bearer.length === 0) {
        return refuse("AUTHENTICATION_REQUIRED");
      }
      if (!body.success) return refuse("INVALID_REQUEST");
      const messages: BridgeMessage[] = body.data.messages.map((message) => ({
        role: message.role,
        text: contentText(message.content).slice(0, 8_000),
      }));
      const controller = new AbortController();
      // The provider drops the request when someone speaks over the face.
      reply.raw.on("close", () => {
        if (!reply.raw.writableFinished) controller.abort();
      });
      const result = await dependencies.face.bridge(
        params.data.faceSessionId,
        bearer,
        messages,
        controller.signal,
      );
      if (result.kind === "UNAUTHORISED") {
        return refuse("AUTHENTICATION_REQUIRED");
      }
      if (controller.signal.aborted) return reply;
      const id = `chatcmpl-${randomUUID()}`;
      const model = "capital-q-meeting";
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });
      raw.write(chunk(id, { role: "assistant" }, null, model));
      if (result.kind === "LINE") {
        const parts = sentences(result.text);
        for (const [index, part] of parts.entries()) {
          raw.write(
            chunk(
              id,
              { content: index === parts.length - 1 ? part : `${part} ` },
              null,
              model,
            ),
          );
        }
      } else if (result.kind === "STREAM") {
        // 2026-10-20: the first sentence now, the rest as the host decides
        // it, in the same turn (the face starts speaking at once).
        raw.write(chunk(id, { content: result.first }, null, model));
        for await (const part of result.rest) {
          if (controller.signal.aborted || raw.destroyed) break;
          raw.write(chunk(id, { content: ` ${part}` }, null, model));
        }
        // Spoken over meanwhile: the provider has already gone.
        if (raw.destroyed) return reply;
      }
      raw.write(chunk(id, {}, "stop", model));
      raw.write("data: [DONE]\n\n");
      raw.end();
      return reply;
    },
  );
}

/**
 * Opened only by Recall's browser. The key in the query is derived from the
 * meeting id with a server secret; a wrong or missing key is a 404 so the
 * routes do not confirm that a meeting exists. Never cached, never sent on
 * as a referrer.
 */
function registerPageRoutes(
  app: FastifyInstance,
  face: Pick<MeetingFaceService, "room">,
  hub: MeetingFacePageHub,
): void {
  const allowed = (request: { params: unknown; query: unknown }) => {
    const params = PageParamsSchema.safeParse(request.params);
    const query = PageQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) return null;
    return hub.verify(params.data.meetingId, query.data.k)
      ? params.data.meetingId
      : null;
  };
  const notFound = (reply: FastifyReply, requestId: string) => {
    const problem = createProblemDetails({
      code: "RESOURCE_NOT_FOUND",
      requestId,
      detail: "Not found.",
    });
    return reply
      .status(problem.status)
      .type(PROBLEM_CONTENT_TYPE)
      .header("Cache-Control", "no-store")
      .send(problem);
  };

  app.get(Q_MEETING_FACE_PAGE_PATH, async (request, reply) => {
    if (allowed(request) === null) return notFound(reply, request.id);
    const nonce = randomBytes(16).toString("base64");
    return reply
      .status(200)
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "no-store")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", meetingFacePageCsp(nonce))
      .send(meetingFacePageHtml(nonce));
  });

  app.get(`${Q_MEETING_FACE_PAGE_PATH}/room`, async (request, reply) => {
    const meetingId = allowed(request);
    if (meetingId === null) return notFound(reply, request.id);
    return reply
      .status(200)
      .header("Cache-Control", "no-store")
      .send({ room: face.room(meetingId) });
  });

  app.get(`${Q_MEETING_FACE_PAGE_PATH}/voice`, async (request, reply) => {
    const meetingId = allowed(request);
    if (meetingId === null) return notFound(reply, request.id);
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    raw.write(": open\n\n");
    const stop = hub.listen(meetingId, (voice) => {
      if (!raw.destroyed) raw.write(`data: ${JSON.stringify(voice)}\n\n`);
    });
    // Proxies close an idle stream; a comment line keeps it open.
    const keepAlive = setInterval(() => {
      if (!raw.destroyed) raw.write(": ping\n\n");
    }, 15_000);
    keepAlive.unref();
    raw.on("close", () => {
      clearInterval(keepAlive);
      stop();
    });
    return reply;
  });
}
