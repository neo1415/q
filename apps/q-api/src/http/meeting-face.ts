import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
} from "@capital-q/contracts";

import type { BridgeMessage } from "../composition/rehearsal-video.js";
import type { MeetingFaceService } from "../composition/meeting-face.js";
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

const BodySchema = z
  .object({
    messages: z
      .array(z.object({ role: z.string().max(40), content: z.unknown() }))
      .max(300),
  })
  .passthrough();

export function registerMeetingFaceRoutes(
  app: FastifyInstance,
  dependencies: { readonly face: MeetingFaceService },
): void {
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
      }
      raw.write(chunk(id, {}, "stop", model));
      raw.write("data: [DONE]\n\n");
      raw.end();
      return reply;
    },
  );
}
