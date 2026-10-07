import type { QApertureState } from "../q-aperture/aperture-state";
import type { QMotion } from "../q-aperture/aperture-frame";

/**
 * The Q moment (founder direction 2026-10-07): now and then the presence
 * gathers into the letter Q, the brand mark, holds it, and lets it go
 * back into whatever its state shows. The state mapping (P11,
 * presence-machine.ts) is untouched; this only lays the letter over it,
 * and only while Q is resting with nothing else to show.
 *
 * Deterministic and calm, never a roll of the dice. It forms:
 * - once on first landing, a moment after the presence starts;
 * - when Q finishes an answer (speaking, thinking or working gives way
 *   to rest), a beat later;
 * - otherwise at most once every IDLE_PERIOD of unbroken rest.
 * Never while Q listens, thinks, works, speaks, asks or is paused, never
 * while answer cards are up, never under reduced motion (the still
 * presence keeps its state's figure), and only on the Q page's own
 * presence (the surface that may show the face).
 *
 * The clock is the presence's own (seconds the swarm has run), so time
 * off screen or in a hidden tab never counts towards the next moment.
 * `at` allocates nothing: it is called once a frame.
 */

/** The letter forms over the presence's own morph (morphSeconds). */
export const Q_MOMENT_IN = 1.2;
/** How long the letter holds once formed. */
export const Q_MOMENT_HOLD = 1.5;
/** The letter is the target for this long; the release is the state's own 1.2 s morph. */
export const Q_MOMENT_SECONDS = Q_MOMENT_IN + Q_MOMENT_HOLD;
/** First landing: the presence settles a moment before the letter forms. */
export const Q_LANDING_DELAY = 1.2;
/** An answer finished: a beat of rest before the letter forms. */
export const Q_ANSWER_DELAY = 0.6;
/** Unbroken rest between two idle moments. */
export const Q_IDLE_PERIOD = 52;
/** No two moments start closer than this, whatever asked for them. */
export const Q_MIN_GAP = 8;

const RESTING: ReadonlySet<QApertureState> = new Set(["IDLE", "COMPLETE"]);
const ANSWERING: ReadonlySet<QApertureState> = new Set([
  "SPEAKING",
  "THINKING",
  "WORKING",
]);

export type QMoment = {
  /**
   * Whether the letter is the target at presence time `t` (seconds).
   * `surface`: this is the Q page's own presence, large enough to read it.
   */
  readonly at: (
    t: number,
    state: QApertureState,
    surface: boolean,
    showing: boolean,
    motion: QMotion,
  ) => boolean;
  /** Form the letter at the next eligible frame (the dev harness). */
  readonly ask: () => void;
};

export function createQMoment(options: {
  /**
   * Asked once, at the first eligible frame: whether to greet the person
   * with the letter (false: already shown on this page load).
   */
  readonly landing: () => boolean;
}): QMoment {
  let landing = true;
  let previous: QApertureState | null = null;
  /** When unbroken eligibility began; -1 while not eligible. */
  let restingSince = -1;
  /** When the current moment began; -1 when none is under way. */
  let current = -1;
  let lastStart = Number.NEGATIVE_INFINITY;
  /** When an asked-for moment may start; -1 when none is asked for. */
  let pending = -1;
  let asked = false;

  const at: QMoment["at"] = (t, state, surface, showing, motion) => {
    const eligible =
      surface && !showing && motion === "full" && RESTING.has(state);
    const finished =
      previous !== null && ANSWERING.has(previous) && RESTING.has(state);
    previous = state;
    if (!eligible) {
      // Anything else Q does takes the presence back at once: the state's
      // own figure flows in over the letter.
      restingSince = -1;
      current = -1;
      pending = -1;
      return false;
    }
    if (restingSince < 0) restingSince = t;
    if (landing) {
      landing = false;
      if (options.landing()) pending = t + Q_LANDING_DELAY;
    }
    if (finished) pending = t + Q_ANSWER_DELAY;
    if (asked) {
      asked = false;
      pending = t;
      lastStart = Number.NEGATIVE_INFINITY;
    }
    if (current >= 0) {
      if (t - current < Q_MOMENT_SECONDS) return true;
      current = -1;
    }
    if (pending < 0 && t - Math.max(restingSince, lastStart) >= Q_IDLE_PERIOD) {
      pending = t;
    }
    if (pending >= 0 && t >= pending) {
      pending = -1;
      if (t - lastStart >= Q_MIN_GAP) {
        current = t;
        lastStart = t;
        return true;
      }
    }
    return false;
  };

  return {
    at,
    ask: () => {
      asked = true;
    },
  };
}
