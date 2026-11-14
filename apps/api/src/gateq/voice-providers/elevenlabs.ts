import type { Server as HttpServer } from "node:http";

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

import type { GateqDialBackVoiceProvider } from "@capital-q/gateq-intake";

import type { GateqDialBackHandlers } from "../voice-dial-back.js";

/**
 * Q's ElevenLabs Speech Engine as the GateQ voice interview's speech
 * provider (owner directive 2026-11-14: reuse the existing voice
 * providers). The ONLY file in this service that imports the ElevenLabs
 * SDK; the boundary lint keeps it that way. It mirrors q-api's own
 * adapter (apps/q-api/src/voice/providers/elevenlabs.ts): the same SDK,
 * the same Speech Engine transport, the same Q voice.
 *
 * What ElevenLabs does here: WebRTC to the browser, speech recognition,
 * turn detection, interruption, text-to-speech and playback. What it never
 * does: decide, ask or remember. Every reply is the canonical GateQ
 * interviewer's, produced on this server and handed to the engine as
 * text. The engine dials back over a WebSocket that the SDK verifies on
 * every upgrade with the provider's signed header; there is no
 * unauthenticated mode. The API key never leaves this process; the
 * browser receives only a one-conversation WebRTC token.
 *
 * The engine resource (its voice, recogniser and `wsUrl`) is created once
 * by the developer setup (`pnpm voice:setup -- --gateq-ws-url ...`); the
 * running service never creates or reconfigures it.
 */

type Session = {
  readonly conversationId: string | undefined;
  readonly isOpen: boolean;
  sendResponse(response: string | AsyncIterable<unknown>): Promise<void>;
  close(): void;
};

export function createElevenLabsGateqVoice(options: {
  /** Revealed once at composition; never held anywhere else. */
  readonly apiKey: string;
  /** The GateQ interviewer's Speech Engine resource id (not a secret). */
  readonly speechEngineId: string;
}): {
  readonly provider: GateqDialBackVoiceProvider;
  readonly attach: (
    server: HttpServer,
    path: string,
    handlers: GateqDialBackHandlers,
  ) => { readonly close: () => Promise<void> };
} {
  const client = new ElevenLabsClient({ apiKey: options.apiKey });
  const speaker = (session: Session) => ({
    speak: (text: string) => session.sendResponse(text),
    close: () => {
      session.close();
    },
  });
  return {
    provider: {
      kind: "DIAL_BACK",
      name: "elevenlabs",
      issueLine: async () => {
        const issued =
          await client.conversationalAi.conversations.getWebrtcToken({
            agentId: options.speechEngineId,
          });
        return {
          token: issued.token,
          providerConversationId: issued.conversationId,
        };
      },
    },
    attach: (server, path, handlers) => {
      const attachment = client.speechEngine.attach(
        options.speechEngineId,
        server,
        path,
        {
          onInit: (conversationId, session) => {
            handlers.onInit(conversationId, speaker(session));
          },
          onTranscript: (transcript, signal, session) => {
            handlers.onTranscript(
              session.conversationId ?? "",
              transcript.map((turn) => ({
                role: turn.role,
                content: turn.content,
              })),
              signal,
              speaker(session),
            );
          },
          onClose: (session) => {
            handlers.onEnded(session.conversationId ?? "");
          },
          onDisconnect: (session) => {
            handlers.onEnded(session.conversationId ?? "");
          },
          onError: (_error, session) => {
            // The provider's message is for its own logs, never relayed.
            handlers.onEnded(session.conversationId ?? "");
          },
        },
      );
      return { close: () => attachment.close() };
    },
  };
}
