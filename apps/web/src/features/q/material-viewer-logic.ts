import type { QTurn } from "./conversation";

/**
 * When a data-room document Q opened closes again (R0, founder 2026-10-06:
 * "when the topic moves on, the opened document closes; reopen when the
 * subject returns; I can say close it"). Read from the conversation's own
 * turns that arrived after it opened: the person asking to close it, or
 * Q's next answer moving the screen elsewhere or showing other cards.
 * Talking about the document keeps it open; Q opens it again when the
 * subject comes back.
 */
const CLOSE_WORDS = /\b(close|shut|hide|dismiss|put away)\b/iu;

export function materialShouldClose(
  turnsSinceOpen: readonly QTurn[],
  documentId: string,
): boolean {
  for (const turn of turnsSinceOpen) {
    if (turn.kind === "PERSON") {
      if (CLOSE_WORDS.test(turn.text)) return true;
      continue;
    }
    if (turn.kind !== "Q" || turn.streaming) continue;
    for (const block of turn.blocks) {
      if (block.kind === "ANSWER_CARDS" || block.kind === "COMPARISON_CARDS") {
        return true;
      }
      if (block.kind !== "UI_INTENT") continue;
      const intent = block.intent;
      const same =
        intent.kind === "OPEN_RECORD_PAGE" &&
        intent.page === "DATA_ROOM_DOCUMENT" &&
        intent.id.toLowerCase() === documentId.toLowerCase();
      if (!same) return true;
    }
  }
  return false;
}
