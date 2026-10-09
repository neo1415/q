import type { QUiActIntent, QUiActReceipt } from "@capital-q/contracts";

import { manifestVersion } from "./manifest";
import { performOnControl } from "./control/perform";
import { controlOf, kindOfId, registerControl } from "./control/registry";
import {
  currentRoute,
  noteRoute as noteSettledRoute,
  resetRouteState,
  routeEpoch,
  routeTrail,
} from "./control/route-state";

/**
 * RECOVERY-2026-10 seam: universal application control
 * (docs/recovery/specs/C-app-control.md §3.2).
 *
 * Every UI act Q's answer carries runs here, one at a time and in order,
 * so one answer's chain -- open a page, pick its tab, scroll to a section
 * -- runs as steps, each after the last one's receipt. An act on an id
 * the page has not registered reports TARGET_MISSING, never done; every
 * act reports exactly one receipt, with the manifest seq after it, which
 * goes to the server (receipt-reporter.ts) so Q knows what happened.
 *
 * After a navigation, the next step waits for the new page to register
 * its controls (bounded) and never runs on the page being left.
 */
export type UiActHandler = (
  intent: QUiActIntent,
) => Promise<QUiActReceipt["status"]> | QUiActReceipt["status"];

/** The new page's route reported (or this long passed) after a move. */
export const NAVIGATION_WAIT_MS = 20_000;
/** A move reported FAILED is still listened for this long, to correct it. */
export const LATE_LANDING_MS = 60_000;
/** A step after a move or another act may wait this long for its control. */
export const REGISTRATION_WAIT_MS = 4_000;
/** Otherwise, a moment's grace for a control that is mounting. */
export const REGISTRATION_GRACE_MS = 400;
/** How long after an act the page is still settling. */
const SETTLING_MS = 6_000;
/** BACK/FORWARD: how long the route may take to change. */
const HISTORY_WAIT_MS = 3_000;
/** A page scroll: how long it may take to move. */
const SCROLL_WAIT_MS = 1_500;
const POLL_MS = 50;
const LEDGER_MAX = 16;

/** G-R1: the page's receipts as window events, for tests to record. */
export const UI_ACT_RECEIPT_EVENT = "cq:ui-act-receipt";
export const NAVIGATION_RECEIPT_EVENT = "cq:navigation-receipt";

function dispatch(name: string, detail: unknown): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

const listeners = new Set<(receipt: QUiActReceipt) => void>();
const reports = new Set<(report: UiActReport) => void>();

/** One act and what came of it, for the server and the person's notice. */
export type UiActReport = {
  readonly intent: QUiActIntent;
  readonly receipt: QUiActReceipt;
};
const ledger: UiActReport[] = [];

/**
 * A page registers a control by id with its own handler (the lead seam's
 * first form, kept). Prefer `useQControl`, which also publishes the
 * control in the manifest with its kind.
 */
export function registerUiControl(
  id: string,
  handler: UiActHandler,
): () => void {
  const kind = kindOfId(id);
  if (kind === null) return () => undefined;
  return registerControl({
    id,
    kind,
    // A handler-only control has no element of its own; it acts anywhere.
    element: () =>
      typeof document === "undefined" ? null : document.documentElement,
    onAct: handler,
    // Its own handler decides; never a click on the document.
    exclusive: true,
  });
}

/** Receipts reach whoever reports them to the server (the Q wire). */
export function onUiActReceipt(
  listener: (receipt: QUiActReceipt) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The act with its receipt (the reporter and the notice). */
export function onUiActReport(
  listener: (report: UiActReport) => void,
): () => void {
  reports.add(listener);
  return () => reports.delete(listener);
}

/** The last few acts and receipts on this tab, newest last. */
export function recentUiActReports(): readonly UiActReport[] {
  return [...ledger];
}

// ---------------------------------------------------------------------------
// Route trail: where this tab has been, in order (BACK, "the page I was on").
// ---------------------------------------------------------------------------

/** What the act queue waits for: the next settled route after a move. */
let navigationPending: {
  readonly from: number;
  readonly at: number;
  readonly expected: string | null;
} | null = null;
let lastActivity = 0;

/** How a move Q made ended: the route the router settled on, or none. */
export type NavigationOutcome =
  | {
      readonly status: "DONE";
      readonly expected: string | null;
      readonly route: string;
    }
  | { readonly status: "FAILED"; readonly expected: string | null };

const navigationListeners = new Set<(outcome: NavigationOutcome) => void>();

/** Heard per move Q made: settled, or not within the bound. */
export function onNavigationOutcome(
  listener: (outcome: NavigationOutcome) => void,
): () => void {
  navigationListeners.add(listener);
  return () => navigationListeners.delete(listener);
}

/**
 * The move whose outcome is not yet known (or was reported FAILED and may
 * still land late). One at a time: a newer move replaces it.
 */
let move: {
  readonly expected: string | null;
  failed: boolean;
  timer: ReturnType<typeof setTimeout> | null;
} | null = null;

/**
 * Whether the route the router settled on is the one asked for: the same
 * path, with every query value the move named (a page may add its own,
 * like the conversation it names). Never "any route change": a URL the
 * page rewrites for itself is not the move landing (G-D14).
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

/**
 * Pages that send the person on to another page (`/investors` -> Discover
 * for a founder): a move to one has arrived when it lands on where that
 * page sent it. Declared by the redirecting page itself, so a move there
 * is never reported FAILED -- and "that page didn't open" never said --
 * for a page that did its job (live 2026-10-09).
 */
const redirects = new Map<
  string,
  { readonly to: string; readonly at: number }
>();
const REDIRECT_FRESH_MS = 60_000;

export function noteRedirect(from: string, to: string): void {
  redirects.set(pathOf(from), { to, at: Date.now() });
}

function pathOf(route: string): string {
  try {
    return (
      new URL(route, "http://route.local").pathname.replace(/\/+$/u, "") || "/"
    );
  } catch {
    return route;
  }
}

/** The move to `expected` has arrived at `actual` (itself, or where it sent them). */
export function arrivedAt(expected: string, actual: string): boolean {
  if (routesMatch(expected, actual)) return true;
  const sent = redirects.get(pathOf(expected));
  return (
    sent !== undefined &&
    Date.now() - sent.at <= REDIRECT_FRESH_MS &&
    routesMatch(sent.to, actual)
  );
}

/** Where this tab is now, by the router's settled route, else its URL. */
function landedOn(expected: string | null): string | null {
  const candidates = [
    currentRoute(),
    typeof window === "undefined"
      ? null
      : `${window.location.pathname}${window.location.search}`,
  ];
  for (const candidate of candidates) {
    if (candidate === null) continue;
    if (expected === null || arrivedAt(expected, candidate)) return candidate;
  }
  return null;
}

function emit(outcome: NavigationOutcome): void {
  for (const listener of navigationListeners) listener(outcome);
  dispatch(NAVIGATION_RECEIPT_EVENT, outcome);
}

function landed(route: string): void {
  const current = move;
  if (current === null) return;
  if (current.timer !== null) clearTimeout(current.timer);
  move = null;
  // A move reported FAILED that lands late is reported again, DONE: the
  // newest receipt is the truth, so Q never confesses a page that opened.
  emit({ status: "DONE", expected: current.expected, route });
}

/**
 * The shell reports each route the router settled on (QControlRuntime);
 * a move Q was waiting for has arrived when it is that route.
 */
export function noteRoute(path: string): void {
  const from = routeEpoch();
  noteSettledRoute(path);
  if (routeEpoch() === from) return;
  lastActivity = Date.now();
  const expected = navigationPending?.expected ?? null;
  if (
    navigationPending !== null &&
    (expected === null || arrivedAt(expected, path))
  ) {
    navigationPending = null;
  }
  if (
    move !== null &&
    (move.expected === null || arrivedAt(move.expected, path))
  ) {
    landed(path);
  }
}

export { routeTrail };

/** A move of Q's is on its way and has not landed yet. */
export function navigationInFlight(): boolean {
  return move !== null && !move.failed;
}

/**
 * A move is on its way (Q's own navigation, to `path` when known): the
 * next step waits for the new route, so it never runs on the page being
 * left, and the move itself is DONE only once the router settles on that
 * route. At the deadline it is checked once more against where the tab
 * actually is; only a move that is not there is FAILED, and a late landing
 * is still reported DONE.
 */
export function expectNavigation(path?: string): void {
  const expected = path ?? null;
  lastActivity = Date.now();
  // The same move asked twice (the typed and the room follow) is one move.
  if (move !== null && move.expected === expected && !move.failed) return;
  navigationPending = { from: routeEpoch(), at: Date.now(), expected };
  if (move?.timer != null) clearTimeout(move.timer);
  if (expected !== null && landedOn(expected) !== null) {
    move = null;
    navigationPending = null;
    emit({ status: "DONE", expected, route: landedOn(expected) ?? expected });
    return;
  }
  const current: NonNullable<typeof move> = {
    expected,
    failed: false,
    timer: null,
  };
  move = current;
  current.timer = setTimeout(() => {
    current.timer = null;
    if (move !== current) return;
    const there = expected === null ? null : landedOn(expected);
    if (there !== null) {
      landed(there);
      return;
    }
    current.failed = true;
    emit({ status: "FAILED", expected });
    // Still listened for a while: a slow page that lands corrects it.
    current.timer = setTimeout(() => {
      if (move === current) move = null;
    }, LATE_LANDING_MS);
  }, NAVIGATION_WAIT_MS);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(test: () => boolean, limitMs: number): Promise<boolean> {
  const end = Date.now() + limitMs;
  for (;;) {
    if (test()) return true;
    if (Date.now() >= end) return false;
    await wait(POLL_MS);
  }
}

async function settleNavigation(): Promise<void> {
  const pending = navigationPending;
  if (pending === null) return;
  await until(
    () =>
      navigationPending !== pending ||
      (routeEpoch() !== pending.from &&
        (pending.expected === null || landedOn(pending.expected) !== null)),
    Math.max(0, pending.at + NAVIGATION_WAIT_MS - Date.now()),
  );
  if (navigationPending === pending) navigationPending = null;
}

// ---------------------------------------------------------------------------
// Page acts: no target.
// ---------------------------------------------------------------------------

/** The element that scrolls: the shell's main area, else the document. */
function scroller(): Element {
  const main = document.getElementById("main");
  if (main !== null && main.scrollHeight > main.clientHeight + 1) return main;
  return document.scrollingElement ?? document.documentElement;
}

async function historyStep(direction: "BACK" | "FORWARD") {
  // No page of this app behind them: a step back would leave Capital Q.
  if (direction === "BACK" && routeTrail().length < 2) return "NOT_APPLICABLE";
  const from = routeEpoch();
  if (direction === "BACK") window.history.back();
  else window.history.forward();
  lastActivity = Date.now();
  // Nothing ahead: the route never changes, which is the honest answer.
  return (await until(() => routeEpoch() !== from, HISTORY_WAIT_MS))
    ? "DONE"
    : direction === "FORWARD"
      ? "NOT_APPLICABLE"
      : "FAILED";
}

/** DONE once the page has actually moved; a scroll that never lands is FAILED. */
async function scrolled(
  area: Element,
  from: number,
): Promise<QUiActReceipt["status"]> {
  return (await until(() => area.scrollTop !== from, SCROLL_WAIT_MS))
    ? "DONE"
    : "FAILED";
}

async function pageAct(intent: QUiActIntent): Promise<QUiActReceipt["status"]> {
  const behavior: ScrollBehavior =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";
  const area = scroller();
  const top = area.scrollTop;
  const room = area.scrollHeight - area.clientHeight;
  switch (intent.act) {
    case "SCROLL_TOP":
    case "SCROLL_UP":
      // Already at the top: nothing to scroll, and it is said so.
      if (top <= 0) return "NOT_APPLICABLE";
      if (intent.act === "SCROLL_TOP") area.scrollTo({ top: 0, behavior });
      else area.scrollBy({ top: -area.clientHeight * 0.85, behavior });
      return scrolled(area, top);
    case "SCROLL_BOTTOM":
    case "SCROLL_DOWN":
      if (top >= room - 1) return "NOT_APPLICABLE";
      if (intent.act === "SCROLL_BOTTOM") {
        area.scrollTo({ top: area.scrollHeight, behavior });
      } else {
        area.scrollBy({ top: area.clientHeight * 0.85, behavior });
      }
      return scrolled(area, top);
    case "BACK":
    case "FORWARD":
      return historyStep(intent.act);
    case "SELECT_TAB":
    case "SCROLL_TO":
    case "FOCUS":
    case "EXPAND":
    case "COLLAPSE":
    case "OPEN":
    case "CLOSE":
    case "SELECT_ITEM":
    case "ACTIVATE":
    case "SET":
    case "FILTER":
    case "NEXT":
    case "PREVIOUS":
      // These name a control; without one there is nothing to act on.
      return "TARGET_MISSING";
  }
}

const PAGE_ACTS = new Set([
  "SCROLL_DOWN",
  "SCROLL_UP",
  "SCROLL_TOP",
  "SCROLL_BOTTOM",
  "BACK",
  "FORWARD",
]);

async function run(intent: QUiActIntent): Promise<QUiActReceipt["status"]> {
  await settleNavigation();
  if (intent.target === undefined || PAGE_ACTS.has(intent.act)) {
    return pageAct(intent);
  }
  const target = intent.target;
  // A step after a move or another act waits for its control to mount;
  // a lone act gets a moment's grace, then the truth.
  const settling = Date.now() - lastActivity < SETTLING_MS;
  await until(
    () => controlOf(target) !== undefined,
    settling ? REGISTRATION_WAIT_MS : REGISTRATION_GRACE_MS,
  );
  const entry = controlOf(target);
  if (entry === undefined) return "TARGET_MISSING";
  return performOnControl(entry, intent);
}

function settleSeq(): Promise<number> {
  // The page's own reaction (a panel mounting) lands in the manifest first.
  return new Promise((resolve) =>
    setTimeout(() => resolve(manifestVersion()), 0),
  );
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Queues one act; resolves with its receipt once it ran (or was refused).
 * Acts run one at a time, in the order they arrive.
 */
export function performUiAct(intent: QUiActIntent): Promise<QUiActReceipt> {
  const done = queue.then(async () => {
    let status: QUiActReceipt["status"];
    try {
      status = await run(intent);
    } catch {
      status = "FAILED";
    }
    lastActivity = Date.now();
    const receipt: QUiActReceipt = {
      actId: intent.actId,
      status,
      seq: await settleSeq(),
    };
    const report: UiActReport = { intent, receipt };
    ledger.push(report);
    if (ledger.length > LEDGER_MAX) ledger.shift();
    for (const listener of listeners) listener(receipt);
    for (const listener of reports) listener(report);
    // G-R1: tests observe receipts as the page reports them (a DOM event,
    // never authority; the server reads the posted batch).
    dispatch(UI_ACT_RECEIPT_EVENT, {
      ...receipt,
      act: intent.act,
      ...(intent.target === undefined ? {} : { target: intent.target }),
    });
    return receipt;
  });
  queue = done.catch(() => undefined);
  return done;
}

/** Clears the trail and the ledger (tests). */
export function resetUiActController(): void {
  resetRouteState();
  if (move?.timer != null) clearTimeout(move.timer);
  move = null;
  navigationPending = null;
  lastActivity = 0;
  ledger.length = 0;
  queue = Promise.resolve();
}
