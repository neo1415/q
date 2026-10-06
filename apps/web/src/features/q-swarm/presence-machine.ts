import type { QApertureState } from "../q-aperture/aperture-state";
import type { FigureKind } from "./presence-figures";

/**
 * Which figure Q's particles form (PRESENCE spec §3; K1-K2, ADR 0051, as
 * amended by P11): one fixed mapping from what Q is doing to one shape.
 *
 * The founder saw the presence as "random at random times" (2026-10-06):
 * gestures the model picked popped over Q's voice on sentence-length
 * timers, a "!" fired on wake, the Q mark and a ribbon came and went on
 * their own clocks, and every one of them took the face's place while Q
 * spoke. So the figure is now a pure function of the surface's state:
 * the same inputs always give the same shape, and the shape changes only
 * when an input changes. No clock, no queue, no randomness.
 *
 * | Q is                         | Shape                                  |
 * | ---------------------------- | -------------------------------------- |
 * | idle, done, paused (error)   | the cloud, breathing (error: dimmed)   |
 * | listening                    | the cloud, leaning in                  |
 * | thinking                     | the spiral                             |
 * | working (a tool, an action)  | the ring                               |
 * | speaking                     | the face (Q page, 160 px+), else wave  |
 * | asking, waiting on approval  | the "?"                                |
 * | resting with answer cards up | the Q mark in knots of light           |
 *
 * Below 72 px a face, a wave, a "?" or the Q mark cannot be read: a small
 * surface keeps to the cloud, the lean, the spiral and the ring.
 */

export type PresenceView = {
  readonly figure: FigureKind;
  readonly dim: boolean;
};

/** The smallest surface a face is drawn on (ADR 0051). */
export const FACE_MIN_PIXELS = 160;
/** Below this a shape cannot be read: the cloud family only. */
export const SMALL_PIXELS = 72;

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
 * The figure for a state. `face` says the surface may show the face
 * (`faceAllowed`); it is used only while Q speaks.
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

const RESTING: ReadonlySet<QApertureState> = new Set(["IDLE", "COMPLETE"]);

export type PresenceInput = {
  readonly state: QApertureState;
  readonly small: boolean;
  /** The surface may show the face while Q speaks (`faceAllowed`). */
  readonly face?: boolean | undefined;
  /** Answer cards are on screen beside this presence. */
  readonly showing?: boolean | undefined;
};

/** Q's figure for this moment: pure, total and deterministic. */
export function presenceFor(input: PresenceInput): PresenceView {
  const dim = input.state === "ERROR";
  // Resting while cards are up: the Q mark holds for as long as they do,
  // and gives way the moment Q listens, thinks or speaks again.
  if (input.showing === true && !input.small && RESTING.has(input.state)) {
    return { figure: "CONSTELLATION", dim };
  }
  return {
    figure: figureForState(input.state, input.small, input.face === true),
    dim,
  };
}
