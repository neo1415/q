import type { QVoiceTurnState } from "@capital-q/contracts";

/**
 * The turn board (CQ-Q-VOICE-001 rework): what Q is asking, and where it
 * is taking the person, after the latest spoken turn of each voice
 * session, kept so the screen can show options when Q asks a choice and
 * follow a spoken "take me to...". Process-local and forgettable, like the
 * bindings: nothing here is authority, and a missing entry only means the
 * screen shows no options.
 */

export type VoiceTurnBoard = {
  readonly record: (
    voiceSessionId: string,
    state: Omit<QVoiceTurnState, "sequence">,
  ) => QVoiceTurnState;
  readonly read: (voiceSessionId: string) => QVoiceTurnState;
  readonly forget: (voiceSessionId: string) => void;
};

const EMPTY: QVoiceTurnState = {
  sequence: 0,
  asking: null,
  navigate: null,
  handoff: null,
  degraded: false,
};

/** Entries older than this are pruned on the next write. */
const STALE_AFTER_MS = 60 * 60 * 1000;

export function createVoiceTurnBoard(
  now: () => number = Date.now,
): VoiceTurnBoard {
  const board = new Map<string, { state: QVoiceTurnState; at: number }>();
  const prune = () => {
    const cutoff = now() - STALE_AFTER_MS;
    for (const [id, entry] of board) {
      if (entry.at < cutoff) board.delete(id);
    }
  };
  return {
    record: (voiceSessionId, state) => {
      prune();
      const before = board.get(voiceSessionId)?.state;
      const previous = before?.sequence ?? 0;
      // The conversation, once known, stays known: a later turn that does
      // not name it (a navigation, a hand-off) does not lose it.
      const conversationId = state.conversationId ?? before?.conversationId;
      const next: QVoiceTurnState = {
        ...state,
        ...(conversationId === undefined ? {} : { conversationId }),
        sequence: previous + 1,
      };
      board.set(voiceSessionId, { state: next, at: now() });
      return next;
    },
    read: (voiceSessionId) => board.get(voiceSessionId)?.state ?? EMPTY,
    forget: (voiceSessionId) => {
      board.delete(voiceSessionId);
    },
  };
}
