# Evidence: apps/web/src/features/briefing/arrival-gate.ts (lines 1-120)

- Original path: `apps/web/src/features/briefing/arrival-gate.ts`
- Line range: 1-120 (HEAD 520bd123)
- Why included: Complete: when the arrival briefing is given (once per browser session via sessionStorage, again after 2h away); 'since' comes from a localStorage heartbeat.

```
    1  /**
    2   * When Q gives the arrival briefing (Zino, 2026-10-08): once per browser
    3   * session, and again after two hours away; never on every navigation.
    4   * Per-viewer conveniences kept in this browser only, read and written
    5   * defensively: blocked storage means the briefing is given (once per page
    6   * load), never that it breaks the page.
    7   *
    8   * Decided once per page load and shared, so the Q page and the dock never
    9   * both give it, and the spoken welcome and the screen agree.
   10   */
   11  
   12  const SEEN_KEY = "cq.q.last-seen";
   13  const SESSION_KEY = "cq.q.arrived";
   14  
   15  /** Away this long, and it is an arrival again. */
   16  export const RETURN_AFTER_MS = 2 * 3_600_000;
   17  /** How often an open, visible page says the person is still here. */
   18  const HEARTBEAT_MS = 60_000;
   19  
   20  export type ArrivalGate = {
   21    readonly give: boolean;
   22    /** Their last visit, ISO; null when this browser has none. */
   23    readonly since: string | null;
   24  };
   25  
   26  /** Pure: whether this is an arrival, from what the browser remembers. */
   27  export function arrivalGateOf(input: {
   28    readonly now: number;
   29    readonly lastSeen: string | null;
   30    readonly arrivedThisSession: boolean;
   31  }): ArrivalGate {
   32    const seen =
   33      input.lastSeen === null ? Number.NaN : Date.parse(input.lastSeen);
   34    const known = Number.isFinite(seen) && seen <= input.now;
   35    const away = known && input.now - seen >= RETURN_AFTER_MS;
   36    return {
   37      give: !input.arrivedThisSession || away,
   38      since: known ? new Date(seen).toISOString() : null,
   39    };
   40  }
   41  
   42  function read(storage: () => Storage, key: string): string | null {
   43    try {
   44      return storage().getItem(key);
   45    } catch {
   46      return null;
   47    }
   48  }
   49  
   50  function write(storage: () => Storage, key: string, value: string): void {
   51    try {
   52      storage().setItem(key, value);
   53    } catch {
   54      // Blocked storage: the briefing is simply given again next time.
   55    }
   56  }
   57  
   58  let decided: ArrivalGate | null = null;
   59  let beating = false;
   60  
   61  function beat(): void {
   62    write(() => window.localStorage, SEEN_KEY, new Date().toISOString());
   63  }
   64  
   65  /**
   66   * This page load's decision. The first call reads the last visit, then
   67   * starts keeping it current; later calls get the same answer.
   68   */
   69  export function decideArrival(now: number = Date.now()): ArrivalGate {
   70    if (decided !== null) return decided;
   71    if (typeof window === "undefined") return { give: false, since: null };
   72    decided = arrivalGateOf({
   73      now,
   74      lastSeen: read(() => window.localStorage, SEEN_KEY),
   75      arrivedThisSession: read(() => window.sessionStorage, SESSION_KEY) === "1",
   76    });
   77    if (decided.give) write(() => window.sessionStorage, SESSION_KEY, "1");
   78    if (!beating) {
   79      beating = true;
   80      beat();
   81      window.setInterval(() => {
   82        if (document.visibilityState === "visible") beat();
   83      }, HEARTBEAT_MS);
   84      window.addEventListener("pagehide", beat);
   85      document.addEventListener("visibilitychange", () => {
   86        if (document.visibilityState === "hidden") beat();
   87        // Back after two hours on the same page: an arrival again.
   88        else if (decided !== null) {
   89          const last = read(() => window.localStorage, SEEN_KEY);
   90          const again = arrivalGateOf({
   91            now: Date.now(),
   92            lastSeen: last,
   93            arrivedThisSession: true,
   94          });
   95          if (again.give) {
   96            decided = again;
   97            for (const listener of returnListeners) listener(again);
   98          }
   99          beat();
  100        }
  101      });
  102    }
  103    return decided;
  104  }
  105  
  106  type ReturnListener = (gate: ArrivalGate) => void;
  107  const returnListeners = new Set<ReturnListener>();
  108  
  109  /** Back on an open page after two hours away: brief again. */
  110  export function onReturn(listener: ReturnListener): () => void {
  111    returnListeners.add(listener);
  112    return () => {
  113      returnListeners.delete(listener);
  114    };
  115  }
  116  
  117  /** For tests: forget this page load's decision. */
  118  export function resetArrivalGate(): void {
  119    decided = null;
  120  }
```

