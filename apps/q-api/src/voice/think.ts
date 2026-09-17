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

/**
 * The longest a turn may run before this route ends it in Q's own words.
 *
 * The speech provider has a patience of its own for a think that never
 * finishes, and when it runs out first the person gets the provider's
 * failure instead of ours: the line dies and a banner appears. Ending the
 * turn here first means the worst case is a sentence Q says, which the
 * person can answer. Longer than the slowest turn measured (research,
 * about eleven seconds), shorter than a provider is likely to wait.
 */
const TURN_DEADLINE_MS = 20_000;
const TURN_TOO_LONG =
  "That one is taking longer than I want to keep you waiting. Ask me again, or ask me something smaller and I'll build up.";
const TURN_CUT_SHORT =
  "I'm going to stop there, that was taking too long. Ask me again if you want the rest.";

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
      // Which it is matters: "no session" is a token for a binding that
      // has been released or swept, and the speech provider keeps calling
      // with it for a while after — that was three refused thinks in a
      // second, and a person reading "Thinking" for good. Seen in a log,
      // the difference is between a leaked socket and a genuine intruder.
      request.log.warn(
        { reason: "NO_BINDING_FOR_TOKEN", boundCount: bindings.size() },
        "voice think refused",
      );
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
      request.log.warn(
        { reason: "CONNECT_WINDOW_ELAPSED_OR_REPRESENTED" },
        "voice think refused",
      );
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
    let timedOut = false;
    const write = (text: string) => {
      if (!open || controller.signal.aborted) return;
      // Once the deadline has spoken, the turn's own late words are not
      // wanted: they would arrive after Q has already moved on.
      if (timedOut) return;
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
    // Our own deadline, ahead of the provider's. The line is written
    // before the turn is cancelled, because cancelling closes writing.
    const deadline = setTimeout(() => {
      if (!open || controller.signal.aborted) {
        return;
      }
      timedOut = true;
      write(wroteContent ? TURN_CUT_SHORT : TURN_TOO_LONG);
      controller.abort();
    }, TURN_DEADLINE_MS);
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
      // A turn we stopped has already said so; do not say it twice.
      if (!timedOut) {
        write("I couldn't take that just now. Could you say it again?");
      }
    } finally {
      clearInterval(keepAlive);
      clearTimeout(beat);
      clearTimeout(deadline);
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
