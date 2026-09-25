import type { CreateQVoiceSessionResponse } from "@capital-q/contracts";

/**
 * The browser side of the voice channel, as the interview sees it
 * (CQ-Q-VOICE-001 C §33, D §45-§47).
 *
 * A provider-neutral port: the workspace and the voice surface consume
 * this and never a vendor type. The one implementation lives in
 * `./provider/` and is the only browser code allowed to import the
 * ElevenLabs SDK.
 */

/** What the person sees Q doing. Public labels only (D §46). */
export type VoiceState =
  | "IDLE"
  | "CONNECTING"
  | "LISTENING"
  | "USER_SPEAKING"
  | "THINKING"
  | "Q_SPEAKING"
  | "INTERRUPTED"
  | "ERROR";

export const VOICE_STATE_LABELS: Readonly<Record<VoiceState, string>> = {
  IDLE: "Ready",
  CONNECTING: "Connecting",
  LISTENING: "Listening",
  USER_SPEAKING: "Listening",
  THINKING: "Thinking",
  Q_SPEAKING: "Speaking",
  INTERRUPTED: "Listening",
  ERROR: "Voice paused",
};

/** One line of the live transcript, in the order it was heard or said. */
export type VoiceTranscriptLine = {
  readonly id: string;
  readonly role: "user" | "q";
  readonly text: string;
  /** True while more may still arrive for this line. */
  readonly partial: boolean;
  readonly at: number;
};

/**
 * A transcript line added, or put in place of the line with its id.
 *
 * The provider can report one utterance more than once as it grows; the
 * session then sends the grown line under the id it already gave, and a
 * consumer that appended every line showed one question as several.
 */
export function upsertLine<T extends { readonly id: string }>(
  lines: readonly T[],
  line: T,
): readonly T[] {
  return lines.some((item) => item.id === line.id)
    ? lines.map((item) => (item.id === line.id ? line : item))
    : [...lines, line];
}

export type VoiceSessionEvents = {
  /**
   * A completed transcript line from either side. A line whose id was
   * already sent replaces that line (see `upsertLine`).
   */
  readonly onLine?: ((line: VoiceTranscriptLine) => void) | undefined;
  /** Q was interrupted by the person (D §46 INTERRUPTED). */
  readonly onInterrupted?: (() => void) | undefined;
  /** The session ended, cleanly or not. */
  readonly onEnded?:
    ((reason: "ended" | "error" | "dropped") => void) | undefined;
  /** A plain sentence for the person; never a provider error string. */
  readonly onError?: ((message: string) => void) | undefined;
};

export type VoiceSessionStart = {
  /** The credential the Q API issued. */
  readonly credential: CreateQVoiceSessionResponse;
  /** What Q says first, when the interview has a question to ask. */
  readonly firstMessage?: string | undefined;
};

/** The live session, as the UI drives it. */
export type VoiceSessionClient = {
  readonly state: VoiceState;
  readonly connected: boolean;
  readonly muted: boolean;
  readonly transcript: readonly VoiceTranscriptLine[];
  readonly start: (input: VoiceSessionStart) => Promise<void>;
  readonly end: () => Promise<void>;
  /** Typed text while voice is active: the same Q turn, answered aloud (C §41). */
  readonly sendText: (text: string) => void;
  readonly setMuted: (muted: boolean) => void;
  readonly setVolume: (volume: number) => void;
  /** 0..1 input level, sampled for the presence visual (D §47). */
  readonly inputLevel: () => number;
  /** 0..1 output level. */
  readonly outputLevel: () => number;
};
