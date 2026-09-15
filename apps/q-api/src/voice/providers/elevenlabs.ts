import type { Server as HttpServer } from "node:http";

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

import type { QVoiceChoice } from "@capital-q/contracts";

import type {
  RealtimeVoiceProvider,
  VoiceAttachment,
  VoiceSpeaker,
} from "../provider.js";

/**
 * ElevenLabs Speech Engine as Capital Q's realtime voice provider
 * (CQ-Q-VOICE-001 C §28-§34). The ONLY file in the service that imports
 * the ElevenLabs SDK; the boundary lint keeps it that way.
 *
 * What ElevenLabs does here: microphone transport (WebRTC to the browser),
 * speech recognition, turn detection, interruption, text-to-speech and
 * playback. What it never does: decide, retrieve, research, remember, or
 * act. Q stays on this server; the Speech Engine connects to it over a
 * WebSocket that is verified on every upgrade with the provider's signed
 * header. `disableAuth` is not offered by this adapter at all.
 *
 * Voices are separate Speech Engine resources that share one WebSocket
 * route; a credential is issued against the resource for the chosen
 * voice, and the same server answers every conversation whichever voice
 * carried it.
 */

export type ElevenLabsVoiceProviderOptions = {
  /** Revealed once at composition; never held anywhere else. */
  readonly apiKey: string;
  readonly speechEngines: {
    readonly default: string;
    readonly male: string | undefined;
  };
};

type Session = {
  readonly conversationId: string | undefined;
  readonly isOpen: boolean;
  sendResponse(response: string | AsyncIterable<unknown>): Promise<void>;
  close(): void;
};

function toSpeaker(session: Session): VoiceSpeaker {
  return {
    get providerConversationId() {
      return session.conversationId;
    },
    get isOpen() {
      return session.isOpen;
    },
    speak: (response) => session.sendResponse(response),
    close: () => {
      session.close();
    },
  };
}

export function createElevenLabsVoiceProvider(
  options: ElevenLabsVoiceProviderOptions,
): RealtimeVoiceProvider {
  const client = new ElevenLabsClient({ apiKey: options.apiKey });
  const engineFor = (voice: QVoiceChoice): string =>
    voice === "MALE" && options.speechEngines.male !== undefined
      ? options.speechEngines.male
      : options.speechEngines.default;
  const voices: readonly QVoiceChoice[] =
    options.speechEngines.male === undefined ? ["FEMALE"] : ["FEMALE", "MALE"];

  return {
    name: "elevenlabs-speech-engine",
    voices,
    createSession: async ({ voice }) => {
      const issued = await client.conversationalAi.conversations.getWebrtcToken(
        { agentId: engineFor(voice) },
      );
      return {
        token: issued.token,
        providerConversationId: issued.conversationId,
      };
    },
    attach: (server: HttpServer, path, handlers): Promise<VoiceAttachment> => {
      // One attachment serves every voice: the upgrade is verified against
      // the account's key, not against one engine, and the conversation id
      // the provider presents is what the bindings resolve.
      const speakers = new WeakMap<object, VoiceSpeaker>();
      const speakerOf = (session: Session): VoiceSpeaker => {
        const existing = speakers.get(session);
        if (existing !== undefined) {
          return existing;
        }
        const speaker = toSpeaker(session);
        speakers.set(session, speaker);
        return speaker;
      };
      const attachment = client.speechEngine.attach(
        options.speechEngines.default,
        server,
        path,
        {
          onInit: (conversationId, session) => {
            handlers.onInit(conversationId, speakerOf(session));
          },
          onTranscript: (transcript, signal, session) => {
            handlers.onTranscript(
              transcript.map((turn) => ({
                role: turn.role,
                content: turn.content,
              })),
              signal,
              speakerOf(session),
            );
          },
          onClose: (session) => {
            handlers.onClose(speakerOf(session));
          },
          onDisconnect: (session) => {
            handlers.onDisconnect(speakerOf(session));
          },
          onError: (error, session) => {
            handlers.onError(error, speakerOf(session));
          },
        },
      );
      return Promise.resolve({ close: () => attachment.close() });
    },
  };
}
