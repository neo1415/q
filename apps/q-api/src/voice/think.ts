import { randomUUID } from "node:crypto";

import type { ServerResponse } from "node:http";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { Logger } from "@capital-q/observability";

import type { VoiceSessionBindings } from "./bindings.js";
import { voiceTokenFingerprint } from "./session-token.js";
import { withoutContinueSignal } from "./navigation.js";
import { sentences } from "./speech.js";
import { createThinkGate, type ThinkGate } from "./think-gate.js";
import type { VoiceSpeaker, VoiceTranscriptTurn } from "./provider.js";
import { turnFailureLine, turnSucceeded } from "./turn-failure.js";
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
  /** When a think may start work (think-gate.ts); a default one otherwise. */
  readonly gate?: ThinkGate | undefined;
};

/** One response stream to the provider; a turn may move to a newer one. */
type ThinkSink = {
  readonly raw: ServerResponse;
  readonly id: string;
  open: boolean;
};

/** The turn answering a line, and the stream it is currently heard on. */
type LiveThink = {
  /** The words it answers, exactly as asked. */
  readonly key: string;
  readonly controller: AbortController;
  sink: ThinkSink;
  done: Promise<void>;
};

function finishSink(sink: ThinkSink): void {
  if (!sink.open) return;
  sink.open = false;
  sink.raw.write(chunk(sink.id, {}, "stop"));
  sink.raw.write("data: [DONE]\n\n");
  sink.raw.end();
}

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

/** Marks this server's own tokenless reachability probe (main.ts). */
export const VOICE_THINK_PROBE_HEADER = "x-capital-q-probe";

export function registerVoiceThinkRoute(
  app: FastifyInstance,
  dependencies: VoiceThinkDependencies,
): void {
  const { bindings, turn, logger } = dependencies;
  /**
   * The think in flight on each line, by voice session.
   *
   * The provider asks again when the person carries on after a pause, with
   * the utterance as it has grown. The older request is then answering a
   * sentence the person had not finished, and if it is still open its
   * words are obsolete: it is ended here, which aborts its turn exactly as
   * the provider dropping it would (hosted, 2026-09-24: five requests for
   * one question, four answered).
   *
   * Except when the newer request asks about exactly the same words: then
   * nothing the turn in flight is saying is obsolete, and it carries on,
   * heard on the newer stream (L1 latency sweep, 2026-10-06: a re-sent
   * question used to restart from nothing, model calls included).
   */
  const inFlight = new Map<string, LiveThink>();
  const gate = dependencies.gate ?? createThinkGate();
  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    const token =
      typeof header === "string" && header.startsWith("Bearer ")
        ? header.slice("Bearer ".length).trim()
        : "";
    // Held here, or restored from the sealed token after a deploy, a
    // restart or on another replica (HARDEN P0, 2026-10-02).
    const restored = token.length === 0 ? null : await bindings.restore(token);
    const bound = restored?.thinkToken === token ? restored : null;
    if (bound === null) {
      // This server's own boot probe (main.ts) asks, tokenless, whether
      // the public origin reaches this route; during a rolling deploy it
      // lands on the old replica. All twelve refusals the founder saw on
      // 2026-10-06 were that probe (presented="", one per deploy), read
      // as a broken voice line. It is still refused -- the header proves
      // nothing and grants nothing -- only logged as what it is.
      if (
        token.length === 0 &&
        request.headers[VOICE_THINK_PROBE_HEADER] === "reachability"
      ) {
        request.log.debug("voice think reachability probe answered");
        return reply.code(401).send({
          type: "about:blank",
          title: "Unauthorized",
          status: 401,
          detail: "No voice session for this request.",
        });
      }
      // Which it is matters: "no session" is a token for a binding that
      // has been released or swept, and the speech provider keeps calling
      // with it for a while after — that was three refused thinks in a
      // second, and a person reading "Thinking" for good. Seen in a log,
      // the difference is between a leaked socket and a genuine intruder.
      /**
       * Fingerprints, not secrets: the first eight characters of the token
       * presented and of each token held. Enough to say "the agent is on
       * an older session than the one we hold" -- which is a different
       * fault from "nothing is held at all" and from a genuine intruder --
       * and not enough to replay anything.
       */
      request.log.warn(
        {
          reason: "NO_BINDING_FOR_TOKEN",
          boundCount: bindings.size(),
          presented: token.length === 0 ? "" : voiceTokenFingerprint(token),
          held: bindings.fingerprints(),
        },
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
      // The browser's cue is not the person's words (navigation.ts).
      const text =
        message.role === "user"
          ? withoutContinueSignal(contentText(message.content))
          : contentText(message.content);
      if (text.length === 0) continue;
      transcript.push({
        role: message.role === "user" ? "user" : "agent",
        content: text,
      });
    }

    const id = `chatcmpl-${randomUUID()}`;
    const line = binding.voiceSessionId;
    const key = JSON.stringify(transcript);
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    raw.write(chunk(id, { role: "assistant" }, null));
    const sink: ThinkSink = { raw, id, open: true };

    const current = inFlight.get(line);
    if (
      current !== undefined &&
      current.key === key &&
      !current.controller.signal.aborted &&
      current.sink.open
    ) {
      // The same words again: the turn in flight answers them here. The
      // older stream is closed cleanly, which is not an interruption.
      const older = current.sink;
      current.sink = sink;
      finishSink(older);
      raw.on("close", () => {
        if (!raw.writableFinished && current.sink === sink) {
          current.controller.abort();
        }
      });
      logger.info(
        { qVoiceSessionId: line },
        "voice think asked again with the same words; the turn in flight answers it",
      );
      await current.done.catch(() => undefined);
      finishSink(sink);
      return reply;
    }

    const controller = new AbortController();
    current?.controller.abort();
    let resolveDone: () => void = () => undefined;
    const live: LiveThink = {
      key,
      controller,
      sink,
      done: new Promise<void>((resolve) => {
        resolveDone = resolve;
      }),
    };
    inFlight.set(line, live);
    // The response closing before it finished is the provider dropping
    // the request: the person spoke over Q. (The request stream's own
    // close fires as soon as its body is read, so it is not the signal.)
    // A stream the turn has moved on from closing is not that.
    raw.on("close", () => {
      if (!raw.writableFinished && live.sink === sink) controller.abort();
    });
    const isOpen = () => live.sink.open && !controller.signal.aborted;
    let wroteContent = false;
    let timedOut = false;
    /**
     * Write to the stream. `force` is for the deadline's own sentence.
     *
     * Once the deadline has spoken, the turn's late words are not wanted:
     * they would arrive after Q has moved on. But the flag that stops
     * them used to stop the deadline's own line too, because it was set
     * before that line was written — so a turn that ran long said "One
     * moment." and then nothing at all, and the person sat looking at a
     * dead line (hosted, 2026-09-22). The deadline now writes past its
     * own guard, and only the turn's late words are dropped.
     */
    const write = (text: string, force = false) => {
      if (!isOpen()) return;
      if (timedOut && !force) return;
      wroteContent = true;
      live.sink.raw.write(chunk(live.sink.id, { content: text }, null));
    };
    // A long turn (research, a document being read) must not look like a
    // dead line to the provider: an empty delta keeps the stream open.
    // Nothing is spoken while Q works. A spoken "One moment." before
    // most answers was a verbal tic the founder rejected (2026-09-27);
    // the stage shows that Q is thinking.
    const keepAlive = setInterval(() => {
      // An empty delta rather than an SSE comment: every OpenAI-shaped
      // parser accepts it, and the provider's is not ours to test.
      if (isOpen()) {
        live.sink.raw.write(chunk(live.sink.id, { content: "" }, null));
      }
    }, KEEP_ALIVE_MS);
    // Our own deadline, ahead of the provider's. The line is written
    // before the turn is cancelled, because cancelling closes writing.
    const deadline = setTimeout(() => {
      if (!isOpen()) {
        return;
      }
      const said = wroteContent ? TURN_CUT_SHORT : TURN_TOO_LONG;
      timedOut = true;
      write(said, true);
      controller.abort();
    }, TURN_DEADLINE_MS);
    const speaker: VoiceSpeaker = {
      providerConversationId: binding.providerConversationId,
      get isOpen() {
        return isOpen();
      },
      speak: async (response) => {
        if (typeof response === "string") {
          // Sentence by sentence even when handed whole (a look-up's
          // answer, an interview reply), as a streamed answer is: the agent
          // asks the voice for what it is given, and one long request is
          // slower to first sound and, past the relay's bound, silent.
          for (const part of sentences(response)) write(`${part} `);
          return;
        }
        for await (const part of response) {
          if (controller.signal.aborted) return;
          write(`${part} `);
        }
      },
      close: () => {
        finishSink(live.sink);
      },
    };
    try {
      // In a burst of re-asks, wait a moment to see whether another
      // follows before creating anything (think-gate.ts).
      const admitted = await gate.admit(line, controller.signal);
      if (admitted !== "DROPPED") {
        await turn(binding, transcript, controller.signal, speaker);
        turnSucceeded(binding);
      }
    } catch (error: unknown) {
      logger.error(
        { err: error, qVoiceSessionId: binding.voiceSessionId },
        "voice think turn failed",
      );
      // A turn we stopped has already said so; do not say it twice. A
      // turn that threw is Q's failure, named as such and never the
      // same way twice running (CQ-QX-005).
      if (!timedOut) {
        write(turnFailureLine(binding, error));
      }
    } finally {
      if (inFlight.get(line) === live) inFlight.delete(line);
      clearInterval(keepAlive);
      clearTimeout(deadline);
      finishSink(live.sink);
      resolveDone();
    }
    return reply;
  };
  app.post(dependencies.path, handler);
  app.post(`${dependencies.path}/chat/completions`, handler);
}
