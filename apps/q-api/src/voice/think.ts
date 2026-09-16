import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { Logger } from "@capital-q/observability";

import type { VoiceSessionBindings } from "./bindings.js";
import type { VoiceSpeaker, VoiceTranscriptTurn } from "./provider.js";
import type { VoiceTurnHandler } from "./turn.js";

/**
 * The think endpoint (CQ-Q-VOICE-001 rework): where the Deepgram Voice
 * Agent brings each transcribed turn. It speaks OpenAI's chat-completions
 * dialect because that is what the provider sends; nothing here is an LLM.
 * The bearer is the per-session secret issued with the session; the
 * conversation it names was bound to a person before the microphone
 * opened. What Q says streams back as sentences; when the person speaks
 * over Q the provider drops the request and the turn's signal aborts.
 */

const BodySchema = z
  .object({
    messages: z
      .array(
        z.object({
          role: z.string(),
          content: z.unknown(),
        }),
      )
      .max(200),
  })
  .passthrough();

/** A stream comment every few seconds while a turn is still working. */
const KEEP_ALIVE_MS = 5_000;
/** If nothing has been said by then, one short beat so the person knows Q is there. */
const SLOW_TURN_BEAT_MS = 6_000;
const SLOW_TURN_BEAT = "One moment.";

export type VoiceThinkDependencies = {
  readonly path: string;
  readonly bindings: VoiceSessionBindings;
  readonly turn: VoiceTurnHandler;
  readonly logger: Logger;
};

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
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
    model: "capital-q",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
}

export function registerVoiceThinkRoute(
  app: FastifyInstance,
  dependencies: VoiceThinkDependencies,
): void {
  const { bindings, turn, logger } = dependencies;
  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    const token =
      typeof header === "string" && header.startsWith("Bearer ")
        ? header.slice("Bearer ".length).trim()
        : "";
    const bound = token.length === 0 ? null : bindings.byThinkToken(token);
    if (bound === null) {
      return reply.code(401).send({
        type: "about:blank",
        title: "Unauthorized",
        status: 401,
        detail: "No voice session for this request.",
      });
    }
    const binding =
      bound.connectedAt === undefined
        ? bindings.connect(bound.providerConversationId)
        : bound;
    if (binding === null) {
      return reply.code(401).send({
        type: "about:blank",
        title: "Unauthorized",
        status: 401,
        detail: "This voice session has expired.",
      });
    }
    const parsed = BodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        type: "about:blank",
        title: "Bad Request",
        status: 400,
        detail: "The think request is not valid.",
      });
    }
    const transcript: VoiceTranscriptTurn[] = [];
    for (const message of parsed.data.messages) {
      if (message.role !== "user" && message.role !== "assistant") continue;
      const text = contentText(message.content);
      if (text.length === 0) continue;
      transcript.push({
        role: message.role === "user" ? "user" : "agent",
        content: text,
      });
    }

    const id = `chatcmpl-${randomUUID()}`;
    const controller = new AbortController();
    reply.hijack();
    const raw = reply.raw;
    // The response closing before it finished is the provider dropping
    // the request: the person spoke over Q. (The request stream's own
    // close fires as soon as its body is read, so it is not the signal.)
    raw.on("close", () => {
      if (!raw.writableFinished) controller.abort();
    });
    raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    raw.write(chunk(id, { role: "assistant" }, null));
    let open = true;
    let wroteContent = false;
    const write = (text: string) => {
      if (!open || controller.signal.aborted) return;
      wroteContent = true;
      raw.write(chunk(id, { content: text }, null));
    };
    // A long turn (research, a document being read) must not look like
    // a dead line to the provider or to the person: a comment keeps the
    // stream open, and a short spoken beat lands before the silence
    // gets awkward. At most one beat per turn; nothing when Q is quick.
    const keepAlive = setInterval(() => {
      // An empty delta rather than an SSE comment: every OpenAI-shaped
      // parser accepts it, and the provider's is not ours to test.
      if (open && !controller.signal.aborted) {
        raw.write(chunk(id, { content: "" }, null));
      }
    }, KEEP_ALIVE_MS);
    const beat = setTimeout(() => {
      if (!wroteContent) write(SLOW_TURN_BEAT);
    }, SLOW_TURN_BEAT_MS);
    const speaker: VoiceSpeaker = {
      providerConversationId: binding.providerConversationId,
      get isOpen() {
        return open && !controller.signal.aborted;
      },
      speak: async (response) => {
        if (typeof response === "string") {
          write(`${response} `);
          return;
        }
        for await (const part of response) {
          if (controller.signal.aborted) return;
          write(`${part} `);
        }
      },
      close: () => {
        open = false;
        raw.end();
      },
    };
    try {
      await turn(binding, transcript, controller.signal, speaker);
    } catch (error: unknown) {
      logger.error(
        { err: error, qVoiceSessionId: binding.voiceSessionId },
        "voice think turn failed",
      );
      write("I couldn't take that just now. Could you say it again?");
    } finally {
      clearInterval(keepAlive);
      clearTimeout(beat);
      if (open) {
        raw.write(chunk(id, {}, "stop"));
        raw.write("data: [DONE]\n\n");
        raw.end();
        open = false;
      }
    }
    return reply;
  };
  app.post(dependencies.path, handler);
  app.post(`${dependencies.path}/chat/completions`, handler);
}
