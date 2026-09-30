/**
 * Q's patience (founder direction 2026-09-30). Q enjoys a little small
 * talk and then brings the person back to what they came for; somebody
 * who keeps pulling away is warned, sent to look around until they are
 * ready, and, persisting, has their account paused for a person at
 * Capital Q to look at.
 *
 * The model only reads each turn (was it small talk, and who started it).
 * Everything here is deterministic and persisted per person, so it
 * survives leaving and coming back, and nothing a model writes can raise
 * or lower anybody's standing by itself.
 *
 * The rules, as the founder set them:
 * - Small talk the person starts: two turns, then Q steers back.
 * - Small talk Q starts: up to four turns, and Q is already steering back
 *   by the third.
 * - Two rounds of that are fine. The third round, Q warns that it will
 *   send them elsewhere in the app until they are ready, and does. That
 *   is a strike, and strikes are remembered.
 * - Once they have a strike, the first round of small talk on any later
 *   visit is enough: Q tells them again and sends them away again.
 * - From the third strike Q is visibly and audibly impatient (orange);
 *   at the fifth it is red, the account is paused and an admin is told.
 */

export type ChatterReading = "NONE" | "PERSON" | "Q";

export type ConductState = {
  /** Small-talk turns in a row, this round. */
  readonly streak: number;
  /** Whether Q started the current round. */
  readonly qStarted: boolean;
  /** Full rounds of small talk this visit. */
  readonly rounds: number;
  /** Times they were sent away; kept across visits. */
  readonly strikes: number;
  /** Set once the account is paused. */
  readonly suspended: boolean;
};

export const INITIAL_CONDUCT: ConductState = {
  streak: 0,
  qStarted: false,
  rounds: 0,
  strikes: 0,
  suspended: false,
};

export type ConductMood = "CALM" | "IMPATIENT" | "STERN";

export type ConductAction =
  /** Nothing to do: small talk is fine, or there was none. */
  | "NONE"
  /** Steer back now, warmly. */
  | "STEER_BACK"
  /** Steer back now, more firmly: this is the second round. */
  | "STEER_BACK_FIRMLY"
  /** Warn that they will be sent to look around, and send them. */
  | "ROUTE_AWAY"
  /** The fifth strike: the account is paused and an admin told. */
  | "SUSPEND";

export type ConductDecision = {
  readonly state: ConductState;
  readonly action: ConductAction;
  readonly mood: ConductMood;
};

export const STRIKES_BEFORE_SUSPENSION = 5;
const IMPATIENT_FROM_STRIKE = 3;

export function moodOf(strikes: number): ConductMood {
  if (strikes >= STRIKES_BEFORE_SUSPENSION) return "STERN";
  return strikes >= IMPATIENT_FROM_STRIKE ? "IMPATIENT" : "CALM";
}

/**
 * The next state and what Q must do, from what this turn was. A new visit
 * starts with `rounds` and `streak` at zero and the same strikes.
 */
export function decideConduct(
  previous: ConductState,
  reading: ChatterReading,
): ConductDecision {
  if (previous.suspended) {
    return { state: previous, action: "SUSPEND", mood: "STERN" };
  }
  if (reading === "NONE") {
    const state = { ...previous, streak: 0, qStarted: false };
    return { state, action: "NONE", mood: moodOf(state.strikes) };
  }
  const qStarted = previous.streak === 0 ? reading === "Q" : previous.qStarted;
  const streak = previous.streak + 1;
  // Q's own small talk may run to four turns; it steers back by the third.
  const limit = qStarted ? 3 : 2;
  if (streak < limit) {
    const state = { ...previous, streak, qStarted };
    return { state, action: "NONE", mood: moodOf(state.strikes) };
  }
  const rounds = previous.rounds + 1;
  // Somebody already sent away once needs only one round to be sent again.
  const sendAway = previous.strikes > 0 || rounds >= 3;
  if (!sendAway) {
    const state = { ...previous, streak: 0, qStarted: false, rounds };
    return {
      state,
      action: rounds >= 2 ? "STEER_BACK_FIRMLY" : "STEER_BACK",
      mood: moodOf(state.strikes),
    };
  }
  const strikes = previous.strikes + 1;
  const suspended = strikes >= STRIKES_BEFORE_SUSPENSION;
  const state: ConductState = {
    streak: 0,
    qStarted: false,
    rounds: 0,
    strikes,
    suspended,
  };
  return {
    state,
    action: suspended ? "SUSPEND" : "ROUTE_AWAY",
    mood: moodOf(strikes),
  };
}

/** What Q is told about its own patience this turn, in plain words. */
export function conductNote(decision: ConductDecision): string {
  const mood =
    decision.mood === "IMPATIENT"
      ? " You are running out of patience with this person and it shows: shorter, cooler, no jokes."
      : decision.mood === "STERN"
        ? " You are out of patience."
        : "";
  switch (decision.action) {
    case "NONE":
      return mood.trim();
    case "STEER_BACK":
      return `Enough small talk for now: answer their last line in a few warm words, then bring them back to the question you need.${mood}`;
    case "STEER_BACK_FIRMLY":
      return `This is the second round of small talk: be friendly but clear that you need to get their setup done, and ask the question you need.${mood}`;
    case "ROUTE_AWAY":
      return `They keep pulling away from the setup. Tell them plainly and kindly that you'll let them look around Capital Q for now and pick this up when they're ready; ask no question.${mood}`;
    case "SUSPEND":
      return "They have been sent away five times. Tell them, calmly and without blame, that you're pausing their account and someone from the Capital Q team will be in touch; ask no question.";
  }
}
