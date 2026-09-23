/**
 * Where the reader was (CQ-WEB-020; doc 20 §144-§147, doc 17 §128).
 *
 * Opening a company and pressing Back must come back to the same card, not
 * to the top of the slate. Doc 20 §146 asks for the same slate, the same
 * item and the same scroll position; §147 adds that the slate must not be
 * recomputed to get there.
 *
 * Two decisions are worth stating, because both had a plausible
 * alternative.
 *
 * **Session storage, not the URL.** Doc 17 §126 wants stable routes for
 * important states, and lists them: `/company/:id`, `/q/:conversationId` --
 * entities, addressable and shareable. A position inside a slate is
 * neither. A slate belongs to exactly one investor: the discovery contract
 * has the server answer NOT_FOUND for anybody else's, so a URL carrying
 * `?slate=...&at=...` would be a link that is meaningless to every other
 * reader and, pasted into a support ticket or a shared tab, leaks which
 * companies this investor was shown and how far they got. Doc 17 §128
 * files feed position under scroll restoration, which is per-tab session
 * state; `sessionStorage` is exactly that, and it dies with the tab rather
 * than resurrecting a three-week-old position.
 *
 * **A card id, not an index.** An index into a list is only meaningful
 * against the list that produced it, and the slate can be rebuilt between
 * visits (the `SLATE_RESTARTED` note). Naming the card means a restore
 * either finds that company in the slate it belongs to, or cleanly finds
 * nothing.
 *
 * Nothing about the company is written down -- no name, no description, no
 * reasons. Those are disclosure-controlled, and a restore has no need of
 * them: it names an id and the next authorized load returns the content.
 */

const STORAGE_KEY = "cq.discover.feed.position";

export type PersistedFeedPosition = {
  readonly slateId: string;
  readonly companyId: string;
};

/**
 * The slice of `Storage` this needs.
 *
 * Narrow on purpose: the controller is handed a port it can be tested
 * against, and nothing here reaches for a global `window`.
 */
export type FeedPositionStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/**
 * `sessionStorage`, or nothing.
 *
 * Absent during server rendering, and it throws rather than returning null
 * when a browser blocks site data. Feed position is a convenience; failing
 * to read it must never be the reason a feed does not render.
 */
export function browserFeedPositionStore(): FeedPositionStore | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isPosition(value: unknown): value is PersistedFeedPosition {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["slateId"] === "string" &&
    typeof candidate["companyId"] === "string"
  );
}

/**
 * Read the stored position, if it belongs to the slate now on screen.
 *
 * A position from a different slate is not stale data to migrate, it is an
 * answer to a different question, and it is dropped.
 */
export function readFeedPosition(
  store: FeedPositionStore | null,
  slateId: string | null,
): PersistedFeedPosition | null {
  if (store === null || slateId === null) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isPosition(parsed)) return null;
    return parsed.slateId === slateId ? parsed : null;
  } catch {
    // Unparseable or unreadable. Start at the top; never throw at a reader.
    return null;
  }
}

export function writeFeedPosition(
  store: FeedPositionStore | null,
  position: PersistedFeedPosition,
): void {
  if (store === null) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(position));
  } catch {
    // Quota, private mode, blocked site data. Losing the position is the
    // whole cost.
  }
}

export function clearFeedPosition(store: FeedPositionStore | null): void {
  if (store === null) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    // As above.
  }
}
