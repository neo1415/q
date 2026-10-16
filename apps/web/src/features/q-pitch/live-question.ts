import type { QTurn } from "@/features/q/conversation";

import { isTourAsk } from "./use-tour-ports";

/**
 * The viewer's own questions among new turns: the ones that pause the tour
 * (owner 16 Oct). Only a question asked on this page counts, one first seen
 * unconfirmed (typed here, awaiting the server). History a conversation
 * loads when the page's subject changes arrives confirmed and is never a
 * question to answer now (16 Oct run 4: the previous run's question, loaded
 * with the Harbourline conversation, paused the tour and cost its own ask).
 * The tour's scripted questions never count.
 *
 * `seen` and `askedHere` are the caller's, kept across calls.
 */
export function viewerQuestions(
  turns: readonly QTurn[],
  seen: Set<string>,
  askedHere: Set<string>,
): string[] {
  const asked: string[] = [];
  for (const turn of turns) {
    if (seen.has(turn.id)) continue;
    if (turn.kind === "PERSON" && turn.unconfirmed) {
      askedHere.add(turn.text.trim());
      continue;
    }
    seen.add(turn.id);
    if (turn.kind !== "PERSON" || isTourAsk(turn.text)) continue;
    if (askedHere.delete(turn.text.trim())) asked.push(turn.id);
  }
  return asked;
}
