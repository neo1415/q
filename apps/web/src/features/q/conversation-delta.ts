import type { QMessage } from "@capital-q/contracts";

/**
 * Egress (Supabase restricted the project for its egress quota,
 * 2026-10-24): a read-back of the thread (after a spoken turn, a decided
 * card, a finished document) read the whole conversation again, every
 * 2.5 s until it settled, cards and all. It now asks only for what came
 * after the last message it read and folds that in here.
 *
 * - What it already holds stays, unless the server says its run was
 *   replaced by a later fragment of the same spoken turn.
 * - A message it holds already (streamed, or from the room feed) is not
 *   added twice.
 */
export function withDelta(
  held: readonly QMessage[],
  delta: readonly QMessage[],
  withdrawnRunIds: readonly string[] = [],
): readonly QMessage[] {
  const withdrawn = new Set(withdrawnRunIds);
  const kept: QMessage[] = [];
  const seen = new Set<string>();
  for (const message of held) {
    if (withdrawn.has(message.runId) || seen.has(message.messageId)) continue;
    seen.add(message.messageId);
    kept.push(message);
  }
  for (const message of delta) {
    if (seen.has(message.messageId)) continue;
    seen.add(message.messageId);
    kept.push(message);
  }
  return kept;
}

/** Where the next read-back starts: the last message a read returned. */
export function nextCursor(
  previous: string | null,
  read: readonly QMessage[],
): string | null {
  return read.at(-1)?.messageId ?? previous;
}
