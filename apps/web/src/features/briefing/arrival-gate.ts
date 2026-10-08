/**
 * When Q gives the arrival briefing (Zino, 2026-10-08): once per browser
 * session, and again after two hours away; never on every navigation.
 * Per-viewer conveniences kept in this browser only, read and written
 * defensively: blocked storage means the briefing is given (once per page
 * load), never that it breaks the page.
 *
 * Decided once per page load and shared, so the Q page and the dock never
 * both give it, and the spoken welcome and the screen agree.
 */

const SEEN_KEY = "cq.q.last-seen";
const SESSION_KEY = "cq.q.arrived";

/** Away this long, and it is an arrival again. */
export const RETURN_AFTER_MS = 2 * 3_600_000;
/** How often an open, visible page says the person is still here. */
const HEARTBEAT_MS = 60_000;

export type ArrivalGate = {
  readonly give: boolean;
  /** Their last visit, ISO; null when this browser has none. */
  readonly since: string | null;
};

/** Pure: whether this is an arrival, from what the browser remembers. */
export function arrivalGateOf(input: {
  readonly now: number;
  readonly lastSeen: string | null;
  readonly arrivedThisSession: boolean;
}): ArrivalGate {
  const seen =
    input.lastSeen === null ? Number.NaN : Date.parse(input.lastSeen);
  const known = Number.isFinite(seen) && seen <= input.now;
  const away = known && input.now - seen >= RETURN_AFTER_MS;
  return {
    give: !input.arrivedThisSession || away,
    since: known ? new Date(seen).toISOString() : null,
  };
}

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: string): void {
  try {
    storage().setItem(key, value);
  } catch {
    // Blocked storage: the briefing is simply given again next time.
  }
}

let decided: ArrivalGate | null = null;
let beating = false;

function beat(): void {
  write(() => window.localStorage, SEEN_KEY, new Date().toISOString());
}

/**
 * This page load's decision. The first call reads the last visit, then
 * starts keeping it current; later calls get the same answer.
 */
export function decideArrival(now: number = Date.now()): ArrivalGate {
  if (decided !== null) return decided;
  if (typeof window === "undefined") return { give: false, since: null };
  decided = arrivalGateOf({
    now,
    lastSeen: read(() => window.localStorage, SEEN_KEY),
    arrivedThisSession: read(() => window.sessionStorage, SESSION_KEY) === "1",
  });
  if (decided.give) write(() => window.sessionStorage, SESSION_KEY, "1");
  if (!beating) {
    beating = true;
    beat();
    window.setInterval(() => {
      if (document.visibilityState === "visible") beat();
    }, HEARTBEAT_MS);
    window.addEventListener("pagehide", beat);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") beat();
      // Back after two hours on the same page: an arrival again.
      else if (decided !== null) {
        const last = read(() => window.localStorage, SEEN_KEY);
        const again = arrivalGateOf({
          now: Date.now(),
          lastSeen: last,
          arrivedThisSession: true,
        });
        if (again.give) {
          decided = again;
          for (const listener of returnListeners) listener(again);
        }
        beat();
      }
    });
  }
  return decided;
}

type ReturnListener = (gate: ArrivalGate) => void;
const returnListeners = new Set<ReturnListener>();

/** Back on an open page after two hours away: brief again. */
export function onReturn(listener: ReturnListener): () => void {
  returnListeners.add(listener);
  return () => {
    returnListeners.delete(listener);
  };
}

/** For tests: forget this page load's decision. */
export function resetArrivalGate(): void {
  decided = null;
}
