import type { QCardCategory, QCardsIntent } from "@capital-q/contracts";

/**
 * Founder P5: one client-side visibility controller for the temporary
 * cards the Q page fills up with (Needs You, connections, sources,
 * recommendations, answers).
 *
 * PRESENTATION ONLY. Hiding a card changes what this browser tab draws; it
 * approves, rejects, deletes and cancels nothing, calls no API and touches
 * no Work task. A Needs You item stays in its Work/attention area. State
 * lives in sessionStorage so it holds across normal in-app navigation; the
 * storage may be unavailable, so every access is guarded and the page is
 * correct without it.
 *
 * "Hide all" clears the cards that exist now. A card first seen after the
 * clear is new and shows. Time is a counter, not a clock, so the order is
 * exact.
 */

export type CardsState = {
  readonly tick: number;
  /** Cards first seen at or before this tick are hidden by "hide all". */
  readonly clearedAt: number | null;
  readonly categories: readonly QCardCategory[];
  /** Spoken names ("tensorgate") hidden one by one. */
  readonly ones: readonly string[];
  /** Exceptions to a clear: restored by name or by category. */
  readonly shownNames: readonly string[];
  readonly shownCategories: readonly QCardCategory[];
  /** Card key -> tick it was first seen. */
  readonly seen: Readonly<Record<string, number>>;
};

export const EMPTY: CardsState = {
  tick: 0,
  clearedAt: null,
  categories: [],
  ones: [],
  shownNames: [],
  shownCategories: [],
  seen: {},
};

export const CARDS_STORAGE_KEY = "cq:q-cards:v1";
const SEEN_MAX = 400;

function load(): CardsState {
  try {
    const raw = window.sessionStorage.getItem(CARDS_STORAGE_KEY);
    if (raw === null) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY;
    return { ...EMPTY, ...(parsed as Partial<CardsState>) };
  } catch {
    return EMPTY;
  }
}

let state: CardsState = typeof window === "undefined" ? EMPTY : load();
const listeners = new Set<() => void>();
/** The same request heard by the screen and by Q's answer acts once. */
let last: { readonly signature: string; readonly at: number } | null = null;
const SAME_REQUEST_MS = 4_000;

function commit(next: CardsState): void {
  state = next;
  try {
    window.sessionStorage.setItem(CARDS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode or blocked storage: the tab still works, un-persisted.
  }
  for (const listener of [...listeners]) listener();
}

export function cardsState(): CardsState {
  return state;
}

export function subscribeCards(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Lower case, letters and digits only: "TensorGate Ltd." -> "tensorgate ltd". */
export function cardNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function nameMatches(spoken: string, cardName: string): boolean {
  const a = cardNameKey(spoken);
  const b = cardNameKey(cardName);
  if (a.length < 2 || b.length < 2) return false;
  return a === b || b.includes(a) || a.includes(b);
}

export type CardRef = {
  readonly category: QCardCategory;
  /** A stable id for the card ("approval:123", a company id). */
  readonly key: string;
  /** What the person would call it: a company, a person, a title. */
  readonly names: readonly string[];
};

export function isHiddenIn(s: CardsState, card: CardRef): boolean {
  if (s.shownNames.some((n) => card.names.some((c) => nameMatches(n, c)))) {
    return false;
  }
  if (s.ones.some((n) => card.names.some((c) => nameMatches(n, c)))) {
    return true;
  }
  if (s.categories.includes(card.category)) return true;
  if (s.shownCategories.includes(card.category)) return false;
  const seen = s.seen[card.key];
  return s.clearedAt !== null && seen !== undefined && seen <= s.clearedAt;
}

export function isCardHidden(card: CardRef): boolean {
  return isHiddenIn(state, card);
}

/** First sight of a card gives it its place in time (idempotent). */
export function noteSeen(keys: readonly string[]): void {
  const fresh = keys.filter((key) => state.seen[key] === undefined);
  if (fresh.length === 0) return;
  let tick = state.tick;
  const seen: Record<string, number> = { ...state.seen };
  for (const key of fresh) {
    tick += 1;
    seen[key] = tick;
  }
  const entries = Object.entries(seen);
  const kept =
    entries.length > SEEN_MAX
      ? Object.fromEntries(entries.slice(entries.length - SEEN_MAX))
      : seen;
  // Registering a card is not a change anyone draws: no listener runs, so
  // rendering a card cannot loop. Storage is written for the next page.
  state = { ...state, tick, seen: kept };
  try {
    window.sessionStorage.setItem(CARDS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // See commit().
  }
}

export function hideAllCards(): void {
  commit({
    ...state,
    clearedAt: state.tick,
    shownNames: [],
    shownCategories: [],
  });
}

export function hideCategory(category: QCardCategory): void {
  commit({
    ...state,
    categories: state.categories.includes(category)
      ? state.categories
      : [...state.categories, category],
    shownCategories: state.shownCategories.filter((c) => c !== category),
  });
}

export function hideOne(name: string): void {
  const key = cardNameKey(name);
  if (key.length === 0) return;
  commit({
    ...state,
    ones: state.ones.includes(key) ? state.ones : [...state.ones, key],
    shownNames: state.shownNames.filter((n) => cardNameKey(n) !== key),
  });
}

export function restoreAllCards(category?: QCardCategory): void {
  if (category === undefined) {
    commit({ ...EMPTY, tick: state.tick, seen: state.seen });
    return;
  }
  commit({
    ...state,
    categories: state.categories.filter((c) => c !== category),
    shownCategories: state.shownCategories.includes(category)
      ? state.shownCategories
      : [...state.shownCategories, category],
  });
}

export function restoreOne(name: string): void {
  const key = cardNameKey(name);
  if (key.length === 0) return;
  commit({
    ...state,
    ones: state.ones.filter((n) => !nameMatches(key, n)),
    shownNames: state.shownNames.includes(key)
      ? state.shownNames
      : [...state.shownNames, key],
  });
}

/**
 * The one entry the voice fast path, Q's answer and the click controls
 * share. Returns false for a malformed request, true once it is applied
 * (or was just applied: the same words heard twice act once).
 */
export function applyCardsIntent(intent: QCardsIntent): boolean {
  const signature = `${intent.action}|${intent.category ?? ""}|${cardNameKey(intent.name ?? "")}`;
  const now = Date.now();
  if (
    last !== null &&
    last.signature === signature &&
    now - last.at < SAME_REQUEST_MS
  ) {
    return true;
  }
  switch (intent.action) {
    case "HIDE_ALL":
      hideAllCards();
      break;
    case "HIDE_CATEGORY":
      if (intent.category === undefined) return false;
      hideCategory(intent.category);
      break;
    case "HIDE_ONE":
      if (intent.name === undefined) return false;
      hideOne(intent.name);
      break;
    case "RESTORE_ALL":
      restoreAllCards(intent.category);
      break;
    case "RESTORE_ONE":
      if (intent.name === undefined) return false;
      restoreOne(intent.name);
      break;
  }
  last = { signature, at: now };
  return true;
}

/** Tests: a clean controller and a forgotten "just applied". */
export function resetCards(): void {
  last = null;
  mounted.clear();
  commit(EMPTY);
}

// ---------------------------------------------------------------- React --

/** Cards currently on the page (hidden or not), for the click controls. */
export const mounted = new Map<string, CardRef>();
export const mountedListeners = new Set<() => void>();
let mountedVersion = 0;

export function mountCards(cards: readonly CardRef[]): () => void {
  for (const card of cards) mounted.set(card.key, card);
  mountedVersion += 1;
  for (const listener of [...mountedListeners]) listener();
  return () => {
    for (const card of cards) mounted.delete(card.key);
    mountedVersion += 1;
    for (const listener of [...mountedListeners]) listener();
  };
}

export function mountedVersionNow(): number {
  return mountedVersion;
}
