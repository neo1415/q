import type { QPresenceGesture, QSentenceGesture } from "@capital-q/contracts";

import type { QApertureState } from "../q-aperture/aperture-state";
import type { FigureKind } from "./presence-figures";

/**
 * Which figure Q's particles form, from real signals only (PRESENCE spec
 * §3; K1-K2, ADR 0051): the surface's Q state (voice or run), and the
 * gestures Q's answer asked for, timed against its voice. Pure and
 * clock-driven, so every transition is tested rather than eyeballed.
 *
 * - Nobody talking: the cloud, breathing.
 * - The person talking: the cloud leaning in, with their voice.
 * - Addressed from rest ("Hey Q", a session opening): a "!" first.
 * - Q asking or waiting on an approval: a "?".
 * - Thinking: a turning spiral. Working: the ring.
 * - Q speaking: the wave, or the human face where the surface allows one
 *   (the Q page, 160 px or more: `faceAllowed`); the answer's gestures
 *   as their sentences are said.
 * - An answer ready: the Q mark in knots of light, once, then the cloud.
 * - Arriving on a surface Q travels to (the dock and the Q page): a ribbon,
 *   briefly, flowing into the state's shape.
 */

export type PresenceView = {
  readonly figure: FigureKind;
  readonly dim: boolean;
  /** What put this figure up, for the playground and the tests. */
  readonly cause: "STATE" | "WAKE" | "GESTURE" | "READY" | "ARRIVE";
};

/** Every gesture's figure. */
export const GESTURE_FIGURE: Readonly<Record<QPresenceGesture, FigureKind>> = {
  QUESTION: "QUESTION",
  EXCLAIM: "EXCLAIM",
  MONEY: "MONEY",
  BUILDINGS: "BUILDINGS",
  CHART_UP: "CHART_UP",
  CLAP: "CLAP",
  // The face-borne gestures became shapes when the old face went (ADR 0051).
  LAUGH: "RIBBON",
  THINK_TILT: "SPIRAL",
  NOD: "CONSTELLATION",
  HANDS_EXPLAIN: "HANDS",
};

/** How long each gesture holds before the state's figure returns. */
export const GESTURE_MS: Readonly<Record<QPresenceGesture, number>> = {
  QUESTION: 2_000,
  EXCLAIM: 1_800,
  MONEY: 2_300,
  BUILDINGS: 2_400,
  CHART_UP: 2_400,
  CLAP: 2_400,
  LAUGH: 2_800,
  THINK_TILT: 2_400,
  NOD: 1_800,
  HANDS_EXPLAIN: 3_200,
};

export const WAKE_MS = 1_600;
/** The Q mark holds this long when an answer is ready, then the cloud. */
export const READY_MS = 2_400;
/** The ribbon holds this long when Q arrives on a surface it travels to. */
export const ARRIVE_MS = 900;
/** The smallest surface a face is drawn on (ADR 0051). */
export const FACE_MIN_PIXELS = 160;
/** A gesture this late is no longer about what is being said. */
export const STALE_AFTER_MS = 6_000;
/** Spoken English, about 14 characters a second. */
export const SPEECH_MS_PER_CHAR = 70;
/** Without the text, one sentence of speech. */
export const SENTENCE_MS = 2_600;
/** Spoken gestures wait this long for Q's voice to start, then play. */
const WAIT_FOR_VOICE_MS = 5_000;

/**
 * Whether a surface may show Q's human face (ADR 0051): only one the
 * caller marks as the Q page's own presence, and only at 160 px or more.
 * Everywhere else Q has no face (design B's option A).
 */
export function faceAllowed(surface: {
  readonly face: boolean;
  readonly pixels: number;
}): boolean {
  return surface.face && surface.pixels >= FACE_MIN_PIXELS;
}

/**
 * The figure for a state, before any gesture. `face` says the surface may
 * show the face (`faceAllowed`); it is used only while Q speaks.
 */
export function figureForState(
  state: QApertureState,
  small: boolean,
  face = false,
): FigureKind {
  switch (state) {
    case "IDLE":
    case "ERROR":
    case "COMPLETE":
      return "CLOUD";
    case "LISTENING":
      return "ATTENTIVE";
    case "THINKING":
      return "SPIRAL";
    case "WORKING":
      return "RING";
    case "SPEAKING":
      // Below 72 px a wave cannot be read: the cloud swells with the voice.
      return small ? "CLOUD" : face ? "FACE" : "WAVE";
    case "NEEDS_INPUT":
    case "NEEDS_APPROVAL":
      return small ? "ATTENTIVE" : "QUESTION";
  }
}

const RESTING: ReadonlySet<QApertureState> = new Set([
  "IDLE",
  "COMPLETE",
  "ERROR",
]);

/** One answer's gestures, as the screen received them. */
export type GestureBatch = {
  readonly gestures: readonly QSentenceGesture[];
  /** True when the answer is being spoken (voice); false for typed. */
  readonly spoken: boolean;
  /** The answer's text, when the screen has it, to time sentences. */
  readonly text?: string | undefined;
};

type Entry = {
  readonly gesture: QPresenceGesture;
  readonly offset: number;
  readonly spoken: boolean;
  anchor: number | null;
  readonly received: number;
};

/** Where each sentence starts, as a share of the text (0..1). */
export function sentenceStarts(text: string): number[] {
  const starts = [0];
  const length = text.length;
  if (length === 0) return starts;
  for (let i = 0; i < length - 1; i += 1) {
    const char = text[i];
    if (
      (char === "." || char === "!" || char === "?" || char === "\n") &&
      (text[i + 1] === " " || text[i + 1] === "\n")
    ) {
      let next = i + 1;
      while (next < length && (text[next] === " " || text[next] === "\n")) {
        next += 1;
      }
      if (next < length) starts.push(next / length);
    }
  }
  return starts;
}

/** When, after its anchor, each gesture of a batch is due. */
export function gestureOffsets(batch: GestureBatch): number[] {
  if (!batch.spoken) {
    // Typed: one after another as the answer lands.
    let at = 0;
    return batch.gestures.map((item) => {
      const offset = at;
      at += GESTURE_MS[item.gesture] + 250;
      return offset;
    });
  }
  const text = batch.text ?? "";
  if (text.length === 0) {
    return batch.gestures.map((item) => item.sentence * SENTENCE_MS);
  }
  const starts = sentenceStarts(text);
  const total = text.length * SPEECH_MS_PER_CHAR;
  return batch.gestures.map((item) => {
    const share = starts[Math.min(item.sentence, starts.length - 1)] ?? 0;
    return Math.round(share * total);
  });
}

export type PresenceMachine = {
  readonly step: (input: {
    readonly state: QApertureState;
    readonly small: boolean;
    /** Milliseconds, any monotonic clock. */
    readonly now: number;
    /** The surface may show the face while Q speaks (`faceAllowed`). */
    readonly face?: boolean | undefined;
  }) => PresenceView;
  readonly schedule: (batch: GestureBatch, now: number) => void;
  /** Gestures waiting, for tests and the playground. */
  readonly waiting: () => number;
};

export function createPresenceMachine(
  options: {
    /** A surface Q travels to (the dock, the Q page): a ribbon on arrival. */
    readonly arrive?: boolean | undefined;
  } = {},
): PresenceMachine {
  let previous: QApertureState | null = null;
  let readyUntil = 0;
  // -1: arriving, timed from the first frame; 0: not a travelling surface.
  let arriveUntil = options.arrive === true ? -1 : 0;
  let speakingSince: number | null = null;
  let wakeUntil = 0;
  let active: {
    gesture: QPresenceGesture;
    until: number;
    spoken: boolean;
  } | null = null;
  let queue: Entry[] = [];

  const due = (entry: Entry): number | null =>
    entry.anchor === null ? null : entry.anchor + entry.offset;

  return {
    waiting: () => queue.length,
    schedule: (batch, now) => {
      const offsets = gestureOffsets(batch);
      const speaking = speakingSince !== null;
      batch.gestures.forEach((item, i) => {
        queue.push({
          gesture: item.gesture,
          offset: offsets[i] ?? 0,
          spoken: batch.spoken,
          // A spoken answer is timed from when Q started saying it; typed
          // gestures, and spoken ones that arrive after the voice, from now.
          anchor: batch.spoken ? (speaking ? speakingSince : null) : now,
          received: now,
        });
      });
    },
    step: ({ state, small, now, face = false }) => {
      if (arriveUntil === -1) arriveUntil = now + ARRIVE_MS;
      if (state !== previous) {
        // An answer is ready: the Q mark once, then the cloud.
        readyUntil =
          state === "COMPLETE" && previous !== null ? now + READY_MS : 0;
        if (state === "SPEAKING") speakingSince = now;
        else if (previous === "SPEAKING") {
          speakingSince = null;
          // Interrupted, or done: what was not said yet is not shown.
          if (state === "LISTENING") {
            queue = queue.filter((entry) => !entry.spoken);
            if (active?.spoken === true) active = null;
          }
        }
        if (
          previous !== null &&
          RESTING.has(previous) &&
          state === "LISTENING"
        ) {
          wakeUntil = now + WAKE_MS;
        } else if (state !== "LISTENING") {
          wakeUntil = 0;
        }
        previous = state;
      }
      // Spoken gestures waiting for the voice: anchored when it starts, or
      // played as they are if it never does.
      for (const entry of queue) {
        if (entry.anchor !== null) continue;
        if (speakingSince !== null) entry.anchor = speakingSince;
        else if (now - entry.received > WAIT_FOR_VOICE_MS) entry.anchor = now;
      }
      // Anchored after the voice already began: an entry whose time passed
      // while it travelled plays now rather than being lost.
      queue = queue.filter((entry) => {
        const at = due(entry);
        return at === null || now - at < STALE_AFTER_MS;
      });
      const dim = state === "ERROR";
      if (small) {
        return { figure: figureForState(state, true), dim, cause: "STATE" };
      }
      if (now < arriveUntil) {
        return { figure: "RIBBON", dim, cause: "ARRIVE" };
      }
      if (active !== null && now >= active.until) active = null;
      if (active === null) {
        let next = -1;
        let nextAt = Infinity;
        queue.forEach((entry, i) => {
          const at = due(entry);
          if (at !== null && at <= now && at < nextAt) {
            next = i;
            nextAt = at;
          }
        });
        const entry = queue[next];
        if (entry !== undefined) {
          queue.splice(next, 1);
          active = {
            gesture: entry.gesture,
            until: now + GESTURE_MS[entry.gesture],
            spoken: entry.spoken,
          };
        }
      }
      if (active !== null) {
        return {
          figure: GESTURE_FIGURE[active.gesture],
          dim,
          cause: "GESTURE",
        };
      }
      if (now < wakeUntil) return { figure: "EXCLAIM", dim, cause: "WAKE" };
      if (now < readyUntil) {
        return { figure: "CONSTELLATION", dim, cause: "READY" };
      }
      return {
        figure: figureForState(state, false, face),
        dim,
        cause: "STATE",
      };
    },
  };
}
