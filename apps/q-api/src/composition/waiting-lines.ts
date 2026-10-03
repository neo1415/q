/**
 * "Still waiting for your approval: X." lines a turn deferred until the
 * engine's step for the same run (lead 2026-10-03, runs a05becfe,
 * a5121124): the turn defers, the action port takes once and says it
 * unless its card superseded or was that card. Bounded: a run whose step
 * never comes leaves nothing behind for long.
 */
const MAX = 256;

export function createWaitingLines(): {
  readonly defer: (
    runId: string,
    waiting: { readonly line: string; readonly actionId: string },
  ) => void;
  readonly take: (
    runId: string,
  ) => { readonly line: string; readonly actionId: string } | null;
} {
  const lines = new Map<string, { line: string; actionId: string }>();
  return {
    defer: (runId, waiting) => {
      lines.delete(runId);
      lines.set(runId, { ...waiting });
      while (lines.size > MAX) {
        const oldest = lines.keys().next().value;
        if (oldest === undefined) break;
        lines.delete(oldest);
      }
    },
    take: (runId) => {
      const found = lines.get(runId) ?? null;
      lines.delete(runId);
      return found;
    },
  };
}
