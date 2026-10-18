import type { VoiceState } from "../voice/session";

/**
 * What the Q Aperture shows Q doing (ADR 0017 F2; spec §5.1). Nine states,
 * each with a word: the light carries the mood, the label carries the
 * meaning, and neither is read alone (doc 18 §34).
 *
 * Every state is derived from real state — the voice session, the run,
 * a pending approval — never from a decorative loop.
 */
export const Q_APERTURE_STATES = [
  "IDLE",
  "LISTENING",
  "THINKING",
  "WORKING",
  "SPEAKING",
  "NEEDS_INPUT",
  "NEEDS_APPROVAL",
  "COMPLETE",
  "ERROR",
] as const;

export type QApertureState = (typeof Q_APERTURE_STATES)[number];

export const Q_APERTURE_LABELS: Readonly<Record<QApertureState, string>> = {
  IDLE: "Q",
  LISTENING: "Listening",
  THINKING: "Thinking",
  WORKING: "Working",
  SPEAKING: "Speaking",
  NEEDS_INPUT: "Q has a question",
  NEEDS_APPROVAL: "Approval needed",
  COMPLETE: "Done",
  ERROR: "Paused",
};

/**
 * The voice session's state, as the aperture shows it. Connecting reads as
 * thinking (Q is getting ready, not waiting on the person); an
 * interruption reads as listening, because that is what Q is now doing.
 */
export function apertureStateFromVoice(state: VoiceState): QApertureState {
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

/** The signals a Q surface already holds, in the order they win. */
export type QRunSignals = {
  /** The live voice session's state; null while voice is off. */
  readonly voice: VoiceState | null;
  /** Q asked the person something and offered options (voice turn). */
  readonly asking?: boolean | undefined;
  /** An approval waits on the person, bound to an exact payload. */
  readonly approvalPending?: boolean | undefined;
  /** A run is streaming or being submitted. */
  readonly working: boolean;
  /** Q is carrying out something it was asked to (a followed action). */
  readonly acting?: boolean | undefined;
  /** An answer just landed (the brief settle after a run). */
  readonly settled?: boolean | undefined;
  readonly failed: boolean;
};

/**
 * One state from the surface's own signals. Voice, while it is on, is the
 * truth (a question with options while Q listens reads as a question); a
 * waiting approval outranks work, because it is what needs the person.
 */
export function apertureStateFor(signals: QRunSignals): QApertureState {
  if (signals.voice !== null) {
    const fromVoice = apertureStateFromVoice(signals.voice);
    return fromVoice === "LISTENING" && signals.asking === true
      ? "NEEDS_INPUT"
      : fromVoice;
  }
  if (signals.approvalPending === true) return "NEEDS_APPROVAL";
  if (signals.acting === true) return "WORKING";
  if (signals.working) return "THINKING";
  if (signals.failed) return "ERROR";
  if (signals.settled === true) return "COMPLETE";
  return "IDLE";
}
