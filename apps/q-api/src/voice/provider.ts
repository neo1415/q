import type { Server as HttpServer } from "node:http";

import type { QVoiceChoice } from "@capital-q/contracts";

/**
 * The realtime voice provider boundary (doc 11 §17.2 Path B, doc 12
 * §36.2; CQ-Q-VOICE-001 C §32-§34).
 *
 * A provider is the Speech Engine: it owns the microphone transport,
 * speech recognition, turn detection, interruption and text-to-speech. It
 * is not Q. Everything that reaches Q through it is text a person said,
 * and everything Q gives it is text to say. No provider type crosses this
 * file: Company, Investor, Onboarding, Evidence and Q code see only what
 * is declared here.
 */

/** What a browser needs to open one microphone session with the provider. */
export type VoiceSessionCredentials = {
  /** Ephemeral, scoped to one provider conversation. Never a provider API key. */
  readonly token: string;
  /** The provider's id for the conversation this token opens. Integration metadata only. */
  readonly providerConversationId: string;
};

/** One line of what the provider transcribed, in order. */
export type VoiceTranscriptTurn = {
  readonly role: "user" | "agent";
  readonly content: string;
};

/**
 * The provider's side of one live conversation: where Q's words go.
 * Speaking accepts a whole line or a stream of chunks; a stream that is
 * interrupted stops where it is.
 */
export type VoiceSpeaker = {
  readonly providerConversationId: string | undefined;
  readonly isOpen: boolean;
  speak(response: string | AsyncIterable<string>): Promise<void>;
  close(): void;
};

export type VoiceChannelHandlers = {
  /** The provider opened a conversation; the id was issued with a credential. */
  onInit(providerConversationId: string, speaker: VoiceSpeaker): void;
  /**
   * The provider transcribed a turn. `signal` aborts when the person speaks
   * again before Q has finished (barge-in): whatever is in flight for this
   * turn must stop, and nothing from it may be spoken or persisted as if it
   * had completed.
   */
  onTranscript(
    transcript: readonly VoiceTranscriptTurn[],
    signal: AbortSignal,
    speaker: VoiceSpeaker,
  ): void;
  onClose(speaker: VoiceSpeaker): void;
  onDisconnect(speaker: VoiceSpeaker): void;
  onError(error: Error, speaker: VoiceSpeaker): void;
};

export type VoiceAttachment = {
  /** Stop accepting provider connections; the HTTP server stays up. */
  close(): Promise<void>;
};

export type RealtimeVoiceProvider = {
  /** For logs and configuration status; never a secret. */
  readonly name: string;
  /** Which voices this composition can speak with. */
  readonly voices: readonly QVoiceChoice[];
  /**
   * Issue one ephemeral credential. The provider conversation id is known
   * before the browser connects, which is what lets the server bind it to
   * the actor and the thread first.
   */
  createSession(input: {
    readonly voice: QVoiceChoice;
  }): Promise<VoiceSessionCredentials>;
  /**
   * Accept provider connections on `path` of an existing HTTP server. Every
   * upgrade is verified as the provider's before a session exists; there is
   * no unauthenticated mode.
   */
  attach(
    server: HttpServer,
    path: string,
    handlers: VoiceChannelHandlers,
  ): Promise<VoiceAttachment>;
};
