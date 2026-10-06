import type { QApertureState } from "../q-aperture/aperture-state";

/**
 * When Q plays a sound (I2, design B's sound board; founder 2026-10-06:
 * "sound effects... soft hum when thinking, pings when a result is
 * ready... not too much"). Pure, so every rule is tested:
 *
 * - Only for real state: the same transitions that move Q's presence.
 * - Never while Q is speaking; never in Discover's swipe path.
 * - At most one sound every 0.6 s; the rest are dropped, not queued.
 * - The hum plays only on the Q page, only while a job runs, and stops by
 *   itself after 20 s. It is ambient, so a person who asks the system for
 *   reduced motion or reduced transparency (a calmer interface) gets the
 *   short sounds but no hum.
 * - On, Quiet or Off on this device; new devices start on Quiet, which
 *   keeps only Result ready, Needs you and errors.
 * - Every sound has a visible counterpart (Q's label and presence), so
 *   nothing depends on hearing it.
 */

export const Q_SOUNDS = [
  "wake",
  "listenOn",
  "listenOff",
  "hum",
  "ping",
  "needs",
  "error",
  "sent",
  "working",
] as const;
export type QSound = (typeof Q_SOUNDS)[number];

export const SOUND_MODES = ["ON", "QUIET", "OFF"] as const;
export type SoundMode = (typeof SOUND_MODES)[number];

export const DEFAULT_SOUND_MODE: SoundMode = "QUIET";

export const SOUND_MODE_LABELS: Readonly<Record<SoundMode, string>> = {
  ON: "On",
  QUIET: "Quiet",
  OFF: "Off",
};

/**
 * What Quiet keeps: the sounds that tell you something needs you, and the
 * silence ladder's first rung (ADR 0062): one soft tone when Q has been
 * working 0.7 s, so a wait never starts in dead air.
 */
export const QUIET_SOUNDS: ReadonlySet<QSound> = new Set([
  "ping",
  "needs",
  "error",
  "working",
]);

/** ADR 0062: the soft tone plays once Q has worked this long, if it still is. */
export const WORKING_TONE_AFTER_MS = 700;

/** Whether Q's state is a wait the silence ladder fills. */
export function isWorkingState(state: QApertureState): boolean {
  return BUSY.has(state);
}

/** No two sounds closer than this; the later one is dropped. */
export const MIN_GAP_MS = 600;
/** The hum stops by itself after this long. */
export const HUM_MAX_MS = 20_000;

const RESTING: ReadonlySet<QApertureState> = new Set([
  "IDLE",
  "COMPLETE",
  "ERROR",
]);
const BUSY: ReadonlySet<QApertureState> = new Set(["THINKING", "WORKING"]);

export type SoundCue = {
  /** A short sound to play, if any. */
  readonly play: QSound | null;
  /** Start or stop the hum, or leave it as it is. */
  readonly hum: "START" | "STOP" | null;
};

/**
 * The cue for a change of Q's state. `previous` is null on the first
 * render, which never plays: arriving on a page is not an event.
 */
export function cueForTransition(
  previous: QApertureState | null,
  next: QApertureState,
): SoundCue {
  if (previous === null || previous === next) return { play: null, hum: null };
  const hum = BUSY.has(next) ? "START" : "STOP";
  switch (next) {
    case "SPEAKING":
      return { play: null, hum: "STOP" };
    case "LISTENING":
      return { play: RESTING.has(previous) ? "wake" : "listenOn", hum };
    case "THINKING":
    case "WORKING":
      return {
        play: previous === "LISTENING" ? "listenOff" : null,
        hum: BUSY.has(previous) ? null : hum,
      };
    case "COMPLETE":
      return { play: "ping", hum };
    case "NEEDS_INPUT":
    case "NEEDS_APPROVAL":
      return { play: "needs", hum };
    case "ERROR":
      return { play: "error", hum };
    case "IDLE":
      return { play: previous === "LISTENING" ? "listenOff" : null, hum };
  }
}

export type SoundContext = {
  readonly mode: SoundMode;
  /** Q's voice is playing. */
  readonly speaking: boolean;
  /** The current path, e.g. "/home" or "/discover". */
  readonly pathname: string;
  readonly reducedMotion: boolean;
  readonly reducedTransparency: boolean;
  /** Milliseconds, any monotonic clock. */
  readonly now: number;
  /** When the last sound played, or null. */
  readonly lastAt: number | null;
};

/** The Q page, where the hum may play. */
export const Q_PAGE_PATH = "/home";

/** Discover's swipe path, where nothing plays. */
export function inSwipePath(pathname: string): boolean {
  return pathname === "/discover" || pathname.startsWith("/discover/");
}

/** Whether a sound may play now. */
export function soundAllowed(sound: QSound, context: SoundContext): boolean {
  if (context.mode === "OFF") return false;
  if (context.speaking) return false;
  if (inSwipePath(context.pathname)) return false;
  if (context.mode === "QUIET" && !QUIET_SOUNDS.has(sound)) return false;
  if (sound === "hum") {
    return (
      context.pathname === Q_PAGE_PATH &&
      !context.reducedMotion &&
      !context.reducedTransparency
    );
  }
  return context.lastAt === null || context.now - context.lastAt >= MIN_GAP_MS;
}

/** A stored mode, or the default for anything else. */
export function parseSoundMode(value: string | null | undefined): SoundMode {
  return SOUND_MODES.find((mode) => mode === value) ?? DEFAULT_SOUND_MODE;
}
