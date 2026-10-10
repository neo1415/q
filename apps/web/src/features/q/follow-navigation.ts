import type {
  QClientActionIntent,
  QNavigateDestination,
} from "@capital-q/contracts";

import type { QTurn } from "./conversation";
import { wireNow } from "./wire";

/**
 * Which navigation a typed conversation should follow now (CQ-QACT-001).
 *
 * Q's answer to "take me to Discover" carries a NAVIGATE intent; the
 * screen follows it exactly as it follows a spoken one, through the same
 * route map. Only an answer that arrived while this screen was open is
 * followed: a conversation reopened from history, or a refresh, shows the
 * old answer and its link but never moves the person on its own.
 *
 * `seen` is every Q turn already on screen when the conversation opened,
 * plus every one this function has already considered. It is updated in
 * place, so each answer is followed at most once.
 */
export function navigationToFollow(
  turns: readonly QTurn[],
  seen: Set<string>,
): QNavigateDestination | null {
  return followOfTurns(turns, seen).navigate;
}

/**
 * The navigation and the client actions (R20/R33: theme, reload, their
 * website) a typed conversation should follow now, under the same rule:
 * only answers that arrived while this screen was open, each at most once.
 */
export function followOfTurns(
  turns: readonly QTurn[],
  seen: Set<string>,
): {
  readonly navigate: QNavigateDestination | null;
  readonly actions: readonly QClientActionIntent[];
} {
  let navigate: QNavigateDestination | null = null;
  const actions: QClientActionIntent[] = [];
  // W7: nothing is followed, or marked followed, before the wire's
  // contracts are in; the caller looks again once they are (useWire).
  const schema = wireNow()?.QClientActionIntentSchema;
  if (schema === undefined) return { navigate, actions };
  for (const turn of turns) {
    if (turn.kind !== "Q" || turn.streaming || seen.has(turn.id)) continue;
    seen.add(turn.id);
    for (const block of turn.blocks) {
      if (block.kind !== "UI_INTENT") continue;
      if (block.intent.kind === "NAVIGATE") {
        // The latest one wins: two in one render is a conversation that
        // moved on, and the person should land where it ended.
        navigate = block.intent.destination;
        continue;
      }
      const action = schema.safeParse(block.intent);
      if (action.success) actions.push(action.data);
    }
  }
  // R3: nothing is expected here. Only the surface that makes the move
  // asks for it (requestMove), and asks before it performs the actions, so
  // an answer that moves AND works the new page ("open Capital, readiness
  // tab") has its UI acts wait for that page. Registering a move here that
  // another surface was meant to make is what left a spoken move reported
  // FAILED with nothing ever pushed (hosted 2026-10-09).
  return { navigate, actions };
}

/**
 * What this surface follows of the thread's answers. While a voice line is
 * open, a spoken answer's moves are the voice board's to make, after Q has
 * said them (they are only marked seen here). An answer to a question this
 * surface sent by typing is still followed here: the board never carries
 * it (2026-10-09 stack run, n-founder-strings: "Okay, let me do a quick
 * rehearsal with these people" was typed while /home's voice line was
 * open, and its NAVIGATE to Rehearsals was marked seen and never made).
 */
export function followOfThread(
  turns: readonly QTurn[],
  seen: Set<string>,
  voice: {
    readonly active: boolean;
    /** Runs started in this tab from typed questions (default: all noted). */
    readonly typedRuns?: ReadonlySet<string> | undefined;
  },
): ReturnType<typeof followOfTurns> {
  if (!voice.active) return followOfTurns(turns, seen);
  const typedRuns = voice.typedRuns ?? TYPED_RUNS;
  const typed = followOfTurns(
    turns.filter(
      (turn) =>
        turn.kind !== "Q" ||
        (turn.runId !== undefined && typedRuns.has(turn.runId)),
    ),
    seen,
  );
  // The spoken ones: seen, so they are never made here later either.
  followOfTurns(turns, seen);
  return typed;
}

/**
 * The Q turns already there when a conversation opens, so never followed.
 * With nothing asked in this tab lately (`since` null) that is every one.
 * Otherwise (RECOVERY-2026-10 G-D16) an answer recorded after the question
 * is the person's fresh one and is followed. An answer still streaming has
 * no recorded time: it is fresh only when its run is one this tab started
 * (G2 follow-up: an older run still streaming in the conversation Home
 * opened was treated as fresh, and its move bounced /home away).
 */
export function seenAtOpen(
  turns: readonly QTurn[],
  since: number | null,
  ownRuns: ReadonlySet<string> = TYPED_RUNS,
): Set<string> {
  const seen = new Set<string>();
  for (const turn of turns) {
    if (turn.kind !== "Q") continue;
    const fresh =
      since !== null &&
      (turn.at === undefined
        ? turn.runId !== undefined && ownRuns.has(turn.runId)
        : Date.parse(turn.at) >= since - FRESH_SKEW_MS);
    if (!fresh) seen.add(turn.id);
  }
  return seen;
}

/** Clock skew between the browser's "asked" and the server's record. */
const FRESH_SKEW_MS = 3_000;

/**
 * The runs this tab started from typed questions. Module state, so it
 * outlives the surface that asked (2026-10-09 rerun: the Q page's surface
 * was set up again as the voice line dropped and came back, and a set held
 * by the old one was gone when the answer landed). Bounded.
 */
const TYPED_RUNS = new Set<string>();
const TYPED_RUNS_MAX = 50;

export function noteTypedRun(runId: string): void {
  TYPED_RUNS.add(runId);
  if (TYPED_RUNS.size > TYPED_RUNS_MAX) {
    const oldest = TYPED_RUNS.values().next().value;
    if (oldest !== undefined) TYPED_RUNS.delete(oldest);
  }
}
