import { randomUUID } from "node:crypto";

import {
  GATEQ_VOICE_CLOSED_LINE,
  GATEQ_VOICE_RETRY_LINE,
  type GateqVoiceInterview,
} from "@capital-q/gateq-intake";

/**
 * The GateQ voice interview's side of a dial-back speech provider (Q's
 * ElevenLabs Speech Engine). Provider-free: the adapter hands this what
 * the engine heard, and this hands back the canonical interviewer's
 * words. Every heard line is the SAME bridge turn the think endpoint
 * makes (`conversation.turn` with channel "voice"), so statements,
 * corrections and coverage land exactly as a typed turn's would.
 *
 * Interruption: the engine aborts `signal` when the person speaks again
 * before Q answers. Whatever was in flight is not spoken. A turn already
 * handed to the interviewer still completes and is recorded (it is the
 * person's own line, and recording is one transaction that cannot be
 * half-undone); the next line is answered after it, in order, so the
 * interviewer sees both.
 */

export type GateqDialBackSpeaker = {
  readonly speak: (text: string) => Promise<void>;
  readonly close: () => void;
};

export type GateqDialBackTranscriptTurn = {
  readonly role: "user" | "agent";
  readonly content: string;
};

export type GateqDialBackHandlers = {
  readonly onInit: (
    providerConversationId: string,
    speaker: GateqDialBackSpeaker,
  ) => void;
  readonly onTranscript: (
    providerConversationId: string,
    transcript: readonly GateqDialBackTranscriptTurn[],
    signal: AbortSignal,
    speaker: GateqDialBackSpeaker,
  ) => void;
  readonly onEnded: (providerConversationId: string) => void;
};

type Logger = {
  readonly warn: (object: Record<string, unknown>, message: string) => void;
};

export function createGateqDialBackHandlers(deps: {
  readonly voice: Pick<GateqVoiceInterview, "dialBackOpened" | "dialBackTurn">;
  readonly logger?: Logger | undefined;
}): GateqDialBackHandlers & {
  /** Resolves once every turn in flight has settled (tests, shutdown). */
  readonly settled: () => Promise<void>;
} {
  /** One conversation's turns run in order: a line waits for the last. */
  const queues = new Map<string, Promise<void>>();
  const enqueue = (id: string, work: () => Promise<void>) => {
    const next = (queues.get(id) ?? Promise.resolve())
      .then(work)
      .catch(() => undefined);
    queues.set(id, next);
    void next.then(() => {
      if (queues.get(id) === next) queues.delete(id);
    });
  };
  const speakSafely = async (speaker: GateqDialBackSpeaker, text: string) => {
    try {
      await speaker.speak(text);
    } catch {
      // A line that closed while Q answered: nothing more to say.
    }
  };

  return {
    onInit: (id, speaker) => {
      enqueue(id, async () => {
        const open = await deps.voice.dialBackOpened(id).catch(() => false);
        if (!open) {
          // Not issued by this server, ended, or past its end.
          deps.logger?.warn({}, "gateq voice: dial-back refused, no live line");
          speaker.close();
        }
      });
    },

    onTranscript: (id, transcript, signal, speaker) => {
      // The person's newest line, and its place among their lines: a
      // re-sent transcript names the same line, so it is the same turn.
      let index = 0;
      let latest: string | null = null;
      for (const turn of transcript) {
        if (turn.role !== "user") continue;
        index += 1;
        latest = turn.content;
      }
      const last = transcript.at(-1);
      if (latest === null || last?.role !== "user") return;
      const utterance = latest;
      const utteranceIndex = index;
      enqueue(id, async () => {
        if (signal.aborted) return;
        let said: string;
        try {
          const result = await deps.voice.dialBackTurn({
            providerConversationId: id,
            utterance,
            utteranceIndex,
            correlationId: randomUUID(),
          });
          if (result.kind === "UNKNOWN_SESSION") {
            speaker.close();
            return;
          }
          // Past the end: said once per line; the browser's own clock ends
          // the call and the person carries on by typing.
          said =
            result.kind === "REPLY" ? result.reply : GATEQ_VOICE_CLOSED_LINE;
        } catch {
          // The line was not recorded: ask for it again.
          said = GATEQ_VOICE_RETRY_LINE;
        }
        // Barge-in: the person spoke again; this answer is not spoken.
        if (signal.aborted || said.trim() === "") return;
        await speakSafely(speaker, said);
      });
    },

    onEnded: (id) => {
      // The session's own clock and the sweep end the row; nothing here
      // needs the provider to have said goodbye.
      void id;
    },

    settled: async () => {
      while (queues.size > 0) await Promise.all([...queues.values()]);
    },
  };
}
