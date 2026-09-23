import type { VoiceState } from "../voice/session";

/**
 * What the presence shows Q doing. Seven states, each with a word beside
 * it: the formation carries the mood, the label carries the meaning, and
 * neither is read alone (doc 18 §34).
 */
export const Q_PRESENCE_STATES = [
  "IDLE",
  "LISTENING",
  "THINKING",
  "SPEAKING",
  "ACTION",
  "SUCCESS",
  "ERROR",
] as const;

export type QPresenceState = (typeof Q_PRESENCE_STATES)[number];

export const Q_PRESENCE_LABELS: Readonly<Record<QPresenceState, string>> = {
  IDLE: "Ready",
  LISTENING: "Listening",
  THINKING: "Thinking",
  SPEAKING: "Speaking",
  ACTION: "On it",
  SUCCESS: "Done",
  ERROR: "Paused",
};

/**
 * The voice session's state, as the presence shows it. Connecting reads as
 * thinking (Q is getting ready, not waiting on the person); an
 * interruption reads as listening, because that is what Q is now doing.
 */
export function presenceStateFromVoice(state: VoiceState): QPresenceState {
  switch (state) {
    case "IDLE":
      return "IDLE";
    case "CONNECTING":
    case "THINKING":
      return "THINKING";
    case "LISTENING":
    case "USER_SPEAKING":
    case "INTERRUPTED":
      return "LISTENING";
    case "Q_SPEAKING":
      return "SPEAKING";
    case "ERROR":
      return "ERROR";
  }
}
