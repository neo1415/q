import type { Server as HttpServer } from "node:http";

import { getMeter, type Logger } from "@capital-q/observability";

import type { VoiceSessionBindings } from "./bindings.js";
import type {
  RealtimeVoiceProvider,
  VoiceAttachment,
  VoiceSpeaker,
} from "./provider.js";
import type { VoiceTurnHandler } from "./turn.js";

/**
 * The voice channel on the running HTTP server (CQ-Q-VOICE-001 C §33-§37).
 *
 * The provider connects here, once per conversation, presenting the
 * conversation id a credential was issued for. That id resolves to the
 * binding made when the credential was issued — the actor and the thread —
 * or the connection is closed: an unknown or already-used id is not a
 * person Capital Q knows. From then on every transcript runs as that
 * actor's turn; nothing in the transcript can change who is speaking.
 */

export type VoiceChannelDependencies = {
  readonly provider: RealtimeVoiceProvider;
  readonly bindings: VoiceSessionBindings;
  readonly turn: VoiceTurnHandler;
  readonly logger: Logger;
  readonly now?: (() => number) | undefined;
};

export async function attachVoiceChannel(
  server: HttpServer,
  path: string,
  dependencies: VoiceChannelDependencies,
): Promise<VoiceAttachment> {
  const { provider, bindings, turn, logger } = dependencies;
  const now = dependencies.now ?? Date.now;
  const meter = getMeter("@capital-q/q-api");
  const startedCounter = meter.createCounter("q.voice.session.started", {
    description: "Voice sessions the provider connected",
  });
  const endedCounter = meter.createCounter("q.voice.session.ended", {
    description: "Voice sessions ended, by how",
  });
  const turnsCounter = meter.createCounter("q.voice.turn", {
    description: "Spoken turns handled, by outcome and path",
  });
  const errorsCounter = meter.createCounter("q.voice.error", {
    description: "Voice channel errors",
  });
  const turnLatency = meter.createHistogram("q.voice.turn.first_speech_ms", {
    description:
      "Milliseconds from a final transcript to the first text handed to speech",
    unit: "ms",
  });

  const bindingOf = (speaker: VoiceSpeaker) => {
    const id = speaker.providerConversationId;
    return id === undefined ? null : bindings.get(id);
  };

  const end = (speaker: VoiceSpeaker, how: "closed" | "dropped") => {
    const id = speaker.providerConversationId;
    if (id === undefined) {
      return;
    }
    const binding = bindings.get(id);
    bindings.release(id);
    if (binding !== null) {
      endedCounter.add(1, { how });
      logger.info(
        { qVoiceSessionId: binding.voiceSessionId, how },
        "voice session ended",
      );
    }
  };

  return provider.attach(server, path, {
    onInit: (providerConversationId, speaker) => {
      const binding = bindings.connect(providerConversationId);
      if (binding === null) {
        // Not issued by this server, expired, or presented twice.
        logger.warn(
          { path },
          "voice connection refused: no binding for conversation",
        );
        errorsCounter.add(1, { kind: "unbound" });
        speaker.close();
        return;
      }
      startedCounter.add(1, { voice: binding.voice });
      logger.info(
        {
          qVoiceSessionId: binding.voiceSessionId,
          thread:
            binding.thread.onboarding === undefined
              ? "conversation"
              : "interview",
        },
        "voice session started",
      );
    },
    onTranscript: (transcript, signal, speaker) => {
      const binding = bindingOf(speaker);
      if (binding === null) {
        speaker.close();
        return;
      }
      const startedAt = now();
      let firstSpeechAt: number | undefined;
      const timed: VoiceSpeaker = {
        get providerConversationId() {
          return speaker.providerConversationId;
        },
        get isOpen() {
          return speaker.isOpen;
        },
        speak: (response) => {
          if (firstSpeechAt === undefined) {
            firstSpeechAt = now();
            turnLatency.record(firstSpeechAt - startedAt);
          }
          return speaker.speak(response);
        },
        close: () => {
          speaker.close();
        },
      };
      void turn(binding, transcript, signal, timed)
        .then((outcome) => {
          turnsCounter.add(1, {
            outcome: outcome.kind,
            path: outcome.kind === "NOTHING" ? "none" : outcome.path,
          });
        })
        .catch((error: unknown) => {
          errorsCounter.add(1, { kind: "turn" });
          logger.error(
            { err: error, qVoiceSessionId: binding.voiceSessionId },
            "voice turn failed",
          );
          if (!signal.aborted && speaker.isOpen) {
            void speaker
              .speak("I couldn't take that just now. Could you say it again?")
              .catch(() => undefined);
          }
        });
    },
    onClose: (speaker) => {
      end(speaker, "closed");
    },
    onDisconnect: (speaker) => {
      end(speaker, "dropped");
    },
    onError: (error, speaker) => {
      errorsCounter.add(1, { kind: "channel" });
      const binding = bindingOf(speaker);
      logger.warn(
        { err: error, qVoiceSessionId: binding?.voiceSessionId },
        "voice channel error",
      );
    },
  });
}
