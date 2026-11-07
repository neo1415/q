/**
 * W5.2 (Q Workspace plan §5): what is new on a page since the person last
 * looked, said in one line, or nothing at all.
 *
 * A page declares its material facts (a deck's version, the counterpart's
 * latest message, the relationship's stage, documents shared). On arrival
 * they are compared with the person's last-seen snapshot of that page:
 * - first visit: nothing is "new since you were last here"; it is saved;
 * - a fact whose value changed (or, for counts, rose) is news;
 * - unknown stays unknown: a fact with no value now is never news and
 *   never overwrites what was last seen;
 * - one line, never a routine summary; silent when nothing material moved;
 * - never the same line twice on a page, and at most one line per page in
 *   a while, and one across pages in a short while (no chatter on fast
 *   moves).
 *
 * Deterministic and instant: the page already holds what it renders, so
 * the comparison costs no read and no model call (the cheapest cache).
 * Materiality is the page's declaration in code, never a model's call.
 *
 * Storage holds hashes only (no names, ids or amounts in the browser's
 * storage) and is cleared on sign-out (clearArrivalSnapshots).
 */

export type ArrivalFact = {
  /** Stable within the page: "deck", "latest-message". */
  readonly key: string;
  /** What it is now: a version, an id, a count. Null: unknown. */
  readonly value: string | number | null;
  /**
   * CHANGED: any change is news (an id, a stage).
   * INCREASED: only a rise is news (a count of documents shared).
   */
  readonly news: "CHANGED" | "INCREASED";
  /** The line, in English, static (translated where it is shown). */
  readonly line: string;
  /** Who it is about, said before the line ("Brightwell"). */
  readonly subject?: string | undefined;
  /** The suggested next step: what to ask Q (static English). */
  readonly ask?: string | undefined;
};

export type ArrivalNews = {
  readonly key: string;
  readonly line: string;
  readonly subject: string | null;
  readonly ask: string | null;
  /** Other material changes on the page besides this one. */
  readonly more: number;
};

type Seen = string | number;

export type ArrivalSnapshot = {
  readonly v: 1;
  /** Fact key → hash of its value (counts stay numbers, to compare). */
  readonly facts: Readonly<Record<string, Seen>>;
  /** Hashes of the lines already said on this page, newest last. */
  readonly said: readonly string[];
  readonly lastLineAt: number | null;
};

export type ArrivalStore = {
  readonly read: (page: string) => ArrivalSnapshot | null;
  readonly write: (page: string, snapshot: ArrivalSnapshot) => void;
};

/** At most one line on a page in this long. */
export const ARRIVAL_PAGE_GAP_MS = 15 * 60_000;
/** At most one line anywhere in this long (fast moves stay quiet). */
export const ARRIVAL_ANY_GAP_MS = 45_000;
/** How many said lines a page remembers, to never repeat them. */
const SAID_KEPT = 24;

/** FNV-1a, 32-bit: a short, stable, non-reversible-enough tag. */
export function arrivalHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function seenOf(fact: ArrivalFact): Seen | null {
  if (fact.value === null) return null;
  if (fact.news === "INCREASED" && typeof fact.value === "number") {
    return fact.value;
  }
  return arrivalHash(String(fact.value));
}

function isNews(fact: ArrivalFact, now: Seen, before: Seen | undefined) {
  if (fact.news === "INCREASED") {
    // A count seen before as a number; a first count is a baseline.
    return typeof now === "number" && typeof before === "number"
      ? now > before
      : false;
  }
  return before !== undefined && before !== now;
}

let lastAnyLineAt: number | null = null;

/** Forgets the cross-page gap (tests). */
export function resetArrivalNews(): void {
  lastAnyLineAt = null;
}

/**
 * Compares the page's facts with its last-seen snapshot, saves the new
 * one, and returns the one line to say, or null for silence.
 */
export function arrivalNews(
  page: string,
  facts: readonly ArrivalFact[],
  options: { readonly store: ArrivalStore; readonly now: number },
): ArrivalNews | null {
  const { store, now } = options;
  const before = store.read(page);
  const seen: Record<string, Seen> = { ...(before?.facts ?? {}) };
  const changed: ArrivalFact[] = [];
  for (const fact of facts) {
    const value = seenOf(fact);
    if (value === null) continue; // unknown: neither news nor forgotten
    if (before !== null && isNews(fact, value, before.facts[fact.key])) {
      changed.push(fact);
    }
    seen[fact.key] = value;
  }
  const said = before?.said ?? [];
  const lastLineAt = before?.lastLineAt ?? null;
  // Never the same line on this page again: the fact's key and its new
  // value, so the same news is not said twice, while a later change is.
  const fresh = changed.filter(
    (fact) => !said.includes(lineTag(fact, seen[fact.key])),
  );
  const quietHere =
    lastLineAt !== null && now - lastLineAt < ARRIVAL_PAGE_GAP_MS;
  const quietAnywhere =
    lastAnyLineAt !== null && now - lastAnyLineAt < ARRIVAL_ANY_GAP_MS;
  const first = fresh[0];
  if (first === undefined || quietHere || quietAnywhere) {
    store.write(page, { v: 1, facts: seen, said, lastLineAt });
    return null;
  }
  const tags = fresh.map((fact) => lineTag(fact, seen[fact.key]));
  store.write(page, {
    v: 1,
    facts: seen,
    said: [...said, ...tags].slice(-SAID_KEPT),
    lastLineAt: now,
  });
  lastAnyLineAt = now;
  return {
    key: first.key,
    line: first.line,
    subject: first.subject ?? null,
    ask: first.ask ?? null,
    more: fresh.length - 1,
  };
}

function lineTag(fact: ArrivalFact, value: Seen | undefined): string {
  return arrivalHash(`${fact.key}\u0000${String(value)}`);
}

// ---------------------------------------------------------------------------
// The browser's store: this device, this person, hashes only.
// ---------------------------------------------------------------------------

export const ARRIVAL_STORAGE_PREFIX = "cq.arrival.";

function parseSnapshot(raw: string | null): ArrivalSnapshot | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    if (!("v" in value) || value.v !== 1) return null;
    if (!("facts" in value) || typeof value.facts !== "object") return null;
    if (value.facts === null) return null;
    const facts: Record<string, Seen> = {};
    for (const [key, seen] of Object.entries(value.facts)) {
      if (typeof seen === "string" || typeof seen === "number") {
        facts[key] = seen;
      }
    }
    const said =
      "said" in value && Array.isArray(value.said)
        ? value.said.filter((one): one is string => typeof one === "string")
        : [];
    const lastLineAt =
      "lastLineAt" in value && typeof value.lastLineAt === "number"
        ? value.lastLineAt
        : null;
    return { v: 1, facts, said, lastLineAt };
  } catch {
    return null;
  }
}

/** localStorage, keyed by a hash of the page; quiet when it is blocked. */
export function browserArrivalStore(): ArrivalStore {
  return {
    read: (page) => {
      try {
        return parseSnapshot(
          window.localStorage.getItem(
            ARRIVAL_STORAGE_PREFIX + arrivalHash(page),
          ),
        );
      } catch {
        return null;
      }
    },
    write: (page, snapshot) => {
      try {
        window.localStorage.setItem(
          ARRIVAL_STORAGE_PREFIX + arrivalHash(page),
          JSON.stringify(snapshot),
        );
      } catch {
        // Blocked storage: arrival stays silent, never wrong.
      }
    },
  };
}

/** Sign-out: the next person on this device starts with nothing seen. */
export function clearArrivalSnapshots(): void {
  try {
    const storage = window.localStorage;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(ARRIVAL_STORAGE_PREFIX) === true) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Nothing stored, or storage blocked.
  }
}
