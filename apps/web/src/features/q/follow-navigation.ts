import {
  QClientActionIntentSchema,
  type QClientActionIntent,
  type QNavigateDestination,
} from "@capital-q/contracts";

import type { QTurn } from "./conversation";

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
      const action = QClientActionIntentSchema.safeParse(block.intent);
      if (action.success) actions.push(action.data);
    }
  }
  return { navigate, actions };
}
