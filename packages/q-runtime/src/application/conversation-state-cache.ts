import type {
  QConversationState,
  QConversationSummaryRevision,
} from "../contracts/conversation-state.js";

/**
 * Q intelligence step 11: the last committed conversation state and summary
 * revision, per conversation and owner, held in this process.
 *
 * A follow-up turn reads both before its reader can start; held here, the
 * reader starts without those round trips. What makes it safe:
 *
 *  - The key is tenant + owner + conversation. An entry is only ever
 *    written from a state whose own identity is that key, so one person's
 *    state can never be served to another, nor across tenants.
 *  - Only committed data enters: the caller remembers a state after its
 *    transaction resolved, never from inside one.
 *  - A stale entry is harmless to storage: saves carry the expected
 *    version, so a fold from an old state writes nothing, and the caller
 *    forgets the entry when that happens.
 *  - The caller uses an entry only when no other turn happened since it
 *    (`continuesFrom`); a turn served by another instance, whose learner
 *    may have appended a summary here unseen, sends it back to the
 *    database. Entries also age out.
 *
 * Bounded (least recently used first). A restart forgets everything; the
 * database is the record.
 */
export type QConversationStateKey = {
  readonly tenantId: string;
  readonly userId: string;
  readonly conversationId: string;
};

export type QConversationStateCacheEntry = {
  readonly state: QConversationState;
  readonly summary: QConversationSummaryRevision | null;
};

export type QConversationStateCache = {
  readonly get: (
    key: QConversationStateKey,
  ) => QConversationStateCacheEntry | undefined;
  /** A committed state (its stored version) and the summary read with it. */
  readonly remember: (entry: QConversationStateCacheEntry) => void;
  /**
   * A summary revision that was committed. Kept only when newer than the
   * entry's own; no entry, nothing kept (the next turn reads the store).
   */
  readonly noteSummary: (
    key: QConversationStateKey,
    summary: QConversationSummaryRevision,
  ) => void;
  /** True when an entry was dropped. */
  readonly forget: (key: QConversationStateKey) => boolean;
};

export const CONVERSATION_STATE_CACHE_MAX = 1_000;
/** A conversation idle this long reads the store again. */
export const CONVERSATION_STATE_CACHE_MAX_AGE_MS = 10 * 60_000;

const keyOf = (key: QConversationStateKey): string =>
  JSON.stringify([key.tenantId, key.userId, key.conversationId]);

/** The newer of two revisions; a revision is never replaced by an older one. */
function newer(
  a: QConversationSummaryRevision | null,
  b: QConversationSummaryRevision | null,
): QConversationSummaryRevision | null {
  if (a === null) return b;
  if (b === null) return a;
  return b.revision > a.revision ? b : a;
}

export function createConversationStateCache(options?: {
  readonly max?: number | undefined;
  readonly maxAgeMs?: number | undefined;
  readonly now?: (() => number) | undefined;
}): QConversationStateCache {
  const max = Math.max(1, options?.max ?? CONVERSATION_STATE_CACHE_MAX);
  const maxAgeMs = options?.maxAgeMs ?? CONVERSATION_STATE_CACHE_MAX_AGE_MS;
  const now = options?.now ?? Date.now;
  const entries = new Map<
    string,
    QConversationStateCacheEntry & { readonly at: number }
  >();
  const put = (
    key: string,
    entry: QConversationStateCacheEntry & { readonly at: number },
  ): void => {
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > max) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  };
  return {
    get: (key) => {
      const k = keyOf(key);
      const entry = entries.get(k);
      if (entry === undefined) return undefined;
      if (now() - entry.at > maxAgeMs) {
        entries.delete(k);
        return undefined;
      }
      return { state: entry.state, summary: entry.summary };
    },
    remember: ({ state, summary }) => {
      const k = keyOf(state);
      const held = entries.get(k);
      // A state never moves backwards: an older version arriving late (two
      // saves racing) does not replace a newer one.
      if (held !== undefined && held.state.version > state.version) return;
      put(k, {
        state,
        summary: newer(held?.summary ?? null, summary),
        at: now(),
      });
    },
    noteSummary: (key, summary) => {
      const k = keyOf(key);
      const held = entries.get(k);
      if (held === undefined) return;
      put(k, { ...held, summary: newer(held.summary, summary) });
    },
    forget: (key) => entries.delete(keyOf(key)),
  };
}
