import { validateRoute, redirectedTo } from "./app-routes";
import { controlOf } from "./registry";
import { currentRoute } from "./route-state";
import { hardLoadUnlessVoice, routerNow, withRouter } from "./router-registry";

/**
 * R3: ONE authoritative lifecycle for every move Q makes on the screen.
 *
 *   REQUESTED -> VALIDATED -> EXECUTING -> VERIFIED | FAILED(reason)
 *
 * Hosted 2026-10-09 (q-api logs): Q said "taking you to Capital", and 20 s
 * later the app said "Q couldn't open that page" -- while the voice line's
 * screen relay showed the screen never changed. Before this module, the
 * surfaces that EXPECTED a move (the typed thread, the voice board, the
 * fast path) and the ones that EXECUTED it were different code: a surface
 * could register "a move to /capital is coming" and leave the push to
 * another that skipped it (already moved, already followed, no router), a
 * page's own URL rewrite could drop the router's push, and a bare 20 s
 * timer then reported FAILED with no reason. Now:
 *
 * - The one that asks executes: `requestNavigation` validates against the
 *   typed route table, pushes through the registered client router, and
 *   verifies against the route the router settled on (QControlRuntime's
 *   `noteRoute`), including a page's declared redirect, the not-found page,
 *   and a named control on the new page (a nested tab).
 * - Idempotent: the same intent id is one execution and one receipt; a
 *   move to the same path while one is under way joins it.
 * - Module state, so a component remounting mid-move changes nothing; a
 *   router that registers late is waited for (bounded), never a full page
 *   load while a voice call holds the audio.
 * - A push the router dropped is pushed once more before anything is
 *   reported; FAILED always carries a reason Q can say plainly.
 *
 * Q may say "opened" only on VERIFIED; before that only "opening".
 */

export type NavigationPhase =
  "REQUESTED" | "VALIDATED" | "EXECUTING" | "VERIFIED" | "FAILED";

export type NavigationFailure =
  /** No such page in the app (validated before anything moved). */
  | "NOT_FOUND"
  /** The person can't open that page (validated, or the page refused). */
  | "UNAUTHORIZED"
  /** No client router on this screen, and a reload would end the call. */
  | "NO_ROUTER"
  /** Pushed (twice) and the router never settled there in time. */
  | "NOT_LANDED"
  /** The page opened but the part asked for (a tab) is not on it. */
  | "CONTROL_MISSING"
  /** A newer move replaced this one before it landed. */
  | "SUPERSEDED";

export type NavigationState = {
  readonly intentId: string;
  readonly expected: string;
  readonly phase: NavigationPhase;
  /** VERIFIED: the route the browser settled on (a redirect's target). */
  readonly route?: string | undefined;
  readonly reason?: NavigationFailure | undefined;
  readonly control?: string | undefined;
};

/** A terminal receipt: what Q Brain, GPT-Live and the notice are told. */
export type NavigationOutcome =
  | {
      readonly status: "DONE";
      readonly intentId: string;
      readonly expected: string;
      readonly route: string;
    }
  | {
      readonly status: "FAILED";
      readonly intentId: string;
      readonly expected: string;
      readonly reason: NavigationFailure;
    };

export type NavigationRequest = {
  readonly path: string;
  /** The caller's idempotency key; derived from the path when absent. */
  readonly intentId?: string | undefined;
  /** A control the new page must register (e.g. `tab.readiness`). */
  readonly control?: string | undefined;
  /**
   * The turn (one sentence of the person's) that asked; the current turn
   * (`beginNavigationTurn`) when absent. Within one turn a move that
   * already VERIFIED is satisfied by that receipt (G2-D2).
   */
  readonly turn?: string | undefined;
};

export type NavigationHandle = {
  readonly intentId: string;
  readonly state: () => NavigationState;
  readonly settled: Promise<NavigationOutcome>;
};

/** The router has this long to settle on the route (slow server pages). */
export const NAVIGATION_WAIT_MS = 20_000;
/** Not there by now: the push is made once more (a dropped transition). */
export const NAVIGATION_RETRY_MS = 2_500;
/** No router registered yet: how long a move waits for one. */
export const ROUTER_WAIT_MS = 2_000;
/** A named control on the new page: how long it may take to register. */
export const CONTROL_WAIT_MS = 4_000;
const POLL_MS = 50;
const LEDGER_MAX = 32;

/** The not-found page's marker (app/not-found.tsx). */
export const NOT_FOUND_MARKER = "data-q-not-found";

/** What the person reads (and Q says) when a move did not happen. */
export function navigationFailureMessage(reason: NavigationFailure): string {
  switch (reason) {
    case "NOT_FOUND":
      return "That page doesn't exist in Capital Q, so Q didn't open anything.";
    case "UNAUTHORIZED":
      return "That page isn't available to your account, so Q didn't open it.";
    case "NO_ROUTER":
      return "Q couldn't move this screen without ending your call. Open it from the menu.";
    case "NOT_LANDED":
      return "That page didn't finish opening. Try again, or open it from the menu.";
    case "CONTROL_MISSING":
      return "The page opened, but the part Q was looking for isn't on it.";
    case "SUPERSEDED":
      return "Q moved on to another page before that one opened.";
  }
}

type Entry = {
  state: NavigationState;
  readonly turn: string | null;
  readonly handle: NavigationHandle;
  readonly resolve: (outcome: NavigationOutcome) => void;
  readonly timers: Set<ReturnType<typeof setTimeout>>;
  readonly cancels: (() => void)[];
  pushed: number;
  verifying: boolean;
};

const ledger = new Map<string, Entry>();
let active: Entry | null = null;
let sequence = 0;
/**
 * G2-D2 (gate on build/int-rc): one sentence ran the same move twice -- the
 * fast path VERIFIED it, then Q's answer for that sentence (70-800 ms
 * later) asked again with a fresh id, so q-api and the thread got a second
 * receipt. Joining only covered moves still in flight. A move is now tied
 * to the turn that asked for it; a later turn is a new move.
 */
let currentTurn: string | null = null;

/** The person finished a sentence: moves asked from now on are its own. */
export function beginNavigationTurn(turn?: string): string {
  sequence += 1;
  currentTurn = turn ?? `turn-${TAB}-${String(sequence)}`;
  return currentTurn;
}

/** This turn's VERIFIED move to the same place, if it already landed. */
function landedThisTurn(
  turn: string | null,
  path: string,
  control: string | undefined,
): Entry | null {
  if (turn === null) return null;
  let found: Entry | null = null;
  for (const entry of ledger.values()) {
    if (
      entry.turn === turn &&
      entry.state.phase === "VERIFIED" &&
      routesMatch(entry.state.expected, path) &&
      routesMatch(path, entry.state.expected) &&
      entry.state.control === control
    ) {
      found = entry;
    }
  }
  return found;
}
/**
 * R3 (stack run 2026-10-10, l-named-navigation): ids were `nav-<n>` per
 * tab, and q-api keeps one receipt per id per person -- so every new tab's
 * first move ("nav-1") was dropped as a retry of an older tab's, and Q
 * Brain never heard it landed. A per-tab random part keeps ids unique
 * across tabs; the sequence keeps them unique within one.
 */
const TAB = tabPart();

function tabPart(): string {
  try {
    return globalThis.crypto.randomUUID().slice(0, 8);
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

const phaseListeners = new Set<(state: NavigationState) => void>();
const outcomeListeners = new Set<(outcome: NavigationOutcome) => void>();

/** Every phase change, in order (speech gating, tests). */
export function onNavigationPhase(
  listener: (state: NavigationState) => void,
): () => void {
  phaseListeners.add(listener);
  return () => phaseListeners.delete(listener);
}

/** Exactly one terminal receipt per intent. */
export function onNavigationOutcome(
  listener: (outcome: NavigationOutcome) => void,
): () => void {
  outcomeListeners.add(listener);
  return () => outcomeListeners.delete(listener);
}

export const NAVIGATION_RECEIPT_EVENT = "cq:navigation-receipt";

function terminal(phase: NavigationPhase): boolean {
  return phase === "VERIFIED" || phase === "FAILED";
}

function setPhase(entry: Entry, next: Partial<NavigationState>): void {
  if (terminal(entry.state.phase)) return;
  entry.state = { ...entry.state, ...next };
  for (const listener of [...phaseListeners]) listener(entry.state);
  if (!terminal(entry.state.phase)) return;
  for (const timer of entry.timers) clearTimeout(timer);
  entry.timers.clear();
  for (const cancel of entry.cancels.splice(0)) cancel();
  if (active === entry) active = null;
  const outcome: NavigationOutcome =
    entry.state.phase === "VERIFIED"
      ? {
          status: "DONE",
          intentId: entry.state.intentId,
          expected: entry.state.expected,
          route: entry.state.route ?? entry.state.expected,
        }
      : {
          status: "FAILED",
          intentId: entry.state.intentId,
          expected: entry.state.expected,
          reason: entry.state.reason ?? "NOT_LANDED",
        };
  entry.resolve(outcome);
  for (const listener of [...outcomeListeners]) listener(outcome);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(NAVIGATION_RECEIPT_EVENT, { detail: outcome }),
    );
  }
}

function fail(entry: Entry, reason: NavigationFailure): void {
  setPhase(entry, { phase: "FAILED", reason });
}

function later(entry: Entry, ms: number, run: () => void): void {
  const timer = setTimeout(() => {
    entry.timers.delete(timer);
    run();
  }, ms);
  entry.timers.add(timer);
}

/**
 * Whether the route the router settled on is the one asked for: the same
 * path, with every query value the move named (a page may add its own,
 * like the conversation it names). Never "any route change".
 */
export function routesMatch(expected: string, actual: string): boolean {
  const base = "http://route.local";
  let want: URL;
  let got: URL;
  try {
    want = new URL(expected, base);
    got = new URL(actual, base);
  } catch {
    return false;
  }
  const path = (url: URL) => url.pathname.replace(/\/+$/u, "") || "/";
  if (path(want) !== path(got)) return false;
  for (const [key, value] of want.searchParams) {
    if (got.searchParams.get(key) !== value) return false;
  }
  return true;
}

/** The move to `expected` has arrived at `actual` (itself, or where it was sent). */
export function arrivedAt(expected: string, actual: string): boolean {
  return routesMatch(expected, actual) || redirectedTo(expected, actual);
}

/** Where this tab is now: the router's settled route, else its URL. */
function landedOn(expected: string): string | null {
  const candidates = [
    currentRoute(),
    typeof window === "undefined"
      ? null
      : `${window.location.pathname}${window.location.search}`,
  ];
  for (const candidate of candidates) {
    if (candidate !== null && arrivedAt(expected, candidate)) return candidate;
  }
  return null;
}

function notFoundShown(): boolean {
  return (
    typeof document !== "undefined" &&
    document.querySelector(`[${NOT_FOUND_MARKER}]`) !== null
  );
}

/** The route is there: the page itself, then the named control, is checked. */
function verify(entry: Entry, route: string): void {
  if (entry.verifying || terminal(entry.state.phase)) return;
  entry.verifying = true;
  // The route is reported after the router committed it (an effect), so
  // the page it rendered is already in the document.
  if (notFoundShown()) {
    // The route exists but not for this record or person (notFound() is
    // also how pages refuse a reader): never "opened".
    fail(entry, "NOT_FOUND");
    return;
  }
  const control = entry.state.control;
  if (control === undefined) {
    setPhase(entry, { phase: "VERIFIED", route });
    return;
  }
  // A nested destination (a tab): the new page must register it.
  const end = Date.now() + CONTROL_WAIT_MS;
  const check = () => {
    if (controlOf(control) !== undefined) {
      setPhase(entry, { phase: "VERIFIED", route });
    } else if (Date.now() >= end) {
      fail(entry, "CONTROL_MISSING");
    } else {
      later(entry, POLL_MS, check);
    }
  };
  check();
}

function execute(entry: Entry): void {
  const { expected } = entry.state;
  const validation = validateRoute(expected);
  if (!validation.ok) {
    fail(entry, validation.reason);
    return;
  }
  setPhase(entry, { phase: "VALIDATED" });
  // A newer move replaces one still on its way: one screen, one place.
  if (active !== null && active !== entry) fail(active, "SUPERSEDED");
  active = entry;
  setPhase(entry, { phase: "EXECUTING" });
  const there = landedOn(expected);
  if (there !== null) {
    verify(entry, there);
    return;
  }
  later(entry, NAVIGATION_WAIT_MS, () => {
    const landed = landedOn(expected);
    if (landed !== null) verify(entry, landed);
    else fail(entry, "NOT_LANDED");
  });
  const cancel = withRouter(ROUTER_WAIT_MS, (push) => {
    if (terminal(entry.state.phase)) return;
    if (push === null) {
      // No router on this screen: a full page load is the last resort,
      // never while a voice call holds the audio (it would end the call).
      if (!hardLoadUnlessVoice(expected)) fail(entry, "NO_ROUTER");
      return;
    }
    const pushOnce = () => {
      entry.pushed += 1;
      // The router registered now: a remounted shell's, if it changed.
      (routerNow() ?? push)(expected);
    };
    pushOnce();
    // A transition the router dropped (a page rewriting its own URL while
    // the move was on its way) never lands: pushed once more, not reported.
    later(entry, NAVIGATION_RETRY_MS, () => {
      if (terminal(entry.state.phase) || entry.verifying) return;
      if (landedOn(expected) !== null) return;
      pushOnce();
    });
  });
  entry.cancels.push(cancel);
}

function remember(entry: Entry): void {
  ledger.set(entry.state.intentId, entry);
  while (ledger.size > LEDGER_MAX) {
    const oldest = ledger.keys().next().value;
    if (oldest === undefined) break;
    ledger.delete(oldest);
  }
}

/**
 * Asks for a move. The caller that asks is the one that executes: there is
 * no "expect a move someone else makes". Never throws.
 */
export function requestNavigation(
  request: NavigationRequest,
): NavigationHandle {
  if (request.intentId !== undefined) {
    const known = ledger.get(request.intentId);
    // Same id: one execution, the same receipt.
    if (known !== undefined) return known.handle;
  }
  // The same move asked again while it is on its way (the fast path, then
  // Q's answer, then the voice board) joins it.
  if (
    active !== null &&
    !terminal(active.state.phase) &&
    routesMatch(active.state.expected, request.path) &&
    routesMatch(request.path, active.state.expected) &&
    active.state.control === request.control
  ) {
    return active.handle;
  }
  const turn = request.turn ?? currentTurn;
  // The same turn asking for the move it already made: that receipt, no
  // second push and no second outcome.
  const landed = landedThisTurn(turn, request.path, request.control);
  if (landed !== null) return landed.handle;
  sequence += 1;
  const intentId = request.intentId ?? `nav-${TAB}-${String(sequence)}`;
  let resolve: (outcome: NavigationOutcome) => void = () => undefined;
  const settled = new Promise<NavigationOutcome>((done) => {
    resolve = done;
  });
  const entry: Entry = {
    state: {
      intentId,
      expected: request.path,
      phase: "REQUESTED",
      ...(request.control === undefined ? {} : { control: request.control }),
    },
    turn,
    handle: { intentId, state: () => entry.state, settled },
    resolve,
    timers: new Set(),
    cancels: [],
    pushed: 0,
    verifying: false,
  };
  remember(entry);
  for (const listener of [...phaseListeners]) listener(entry.state);
  try {
    execute(entry);
  } catch {
    fail(entry, "NOT_LANDED");
  }
  return entry.handle;
}

/**
 * The shell reports each route the router settled on (QControlRuntime).
 * The move on its way is verified when it is that route, or where its page
 * sent it.
 */
export function navigationNoteRoute(path: string): void {
  const entry = active;
  if (entry === null || entry.state.phase !== "EXECUTING") return;
  if (arrivedAt(entry.state.expected, path)) verify(entry, path);
}

/** A move is on its way and has not landed (or failed) yet. */
export function navigationInFlight(): boolean {
  return active !== null && !terminal(active.state.phase);
}

/** The move on its way, for the act queue to wait on. */
export function activeNavigation(): NavigationHandle | null {
  return active === null || terminal(active.state.phase) ? null : active.handle;
}

/** The latest move to this path (any phase), if one is remembered. */
export function lastNavigationTo(path: string): NavigationState | null {
  let found: NavigationState | null = null;
  for (const entry of ledger.values()) {
    if (routesMatch(entry.state.expected, path)) found = entry.state;
  }
  return found;
}

/** Clears every move (tests). */
export function resetNavigationLifecycle(): void {
  for (const entry of ledger.values()) {
    for (const timer of entry.timers) clearTimeout(timer);
    for (const cancel of entry.cancels.splice(0)) cancel();
  }
  ledger.clear();
  active = null;
  sequence = 0;
  currentTurn = null;
}
