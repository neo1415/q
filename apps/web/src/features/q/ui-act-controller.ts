import type { QUiActIntent, QUiActReceipt } from "@capital-q/contracts";

import { manifestVersion } from "./manifest";
import { performOnControl } from "./control/perform";
import { controlOf, kindOfId, registerControl } from "./control/registry";
import {
  activeNavigation,
  navigationNoteRoute,
  requestNavigation,
  resetNavigationLifecycle,
  type NavigationRequest,
} from "./control/navigation-lifecycle";
import {
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

export { NAVIGATION_WAIT_MS } from "./control/navigation-lifecycle";
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
export { NAVIGATION_RECEIPT_EVENT } from "./control/navigation-lifecycle";

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
// Moves: one lifecycle (control/navigation-lifecycle.ts) owns them; the act
// queue only waits for the one on its way.
// ---------------------------------------------------------------------------

let lastActivity = 0;

export {
  arrivedAt,
  navigationInFlight,
  onNavigationOutcome,
  routesMatch,
  type NavigationOutcome,
} from "./control/navigation-lifecycle";
export { noteRedirect } from "./control/app-routes";

/**
 * The shell reports each route the router settled on (QControlRuntime);
 * the move on its way is verified there.
 */
export function noteRoute(path: string): void {
  const from = routeEpoch();
  noteSettledRoute(path);
  if (routeEpoch() === from) return;
  lastActivity = Date.now();
  navigationNoteRoute(path);
}

export { routeTrail };

/**
 * Q's move to `path`: validated, executed through the client router and
 * verified (navigation-lifecycle.ts). A UI act queued after it waits for
 * the new page instead of acting on the one being left.
 */
export function requestMove(
  request: NavigationRequest,
): ReturnType<typeof requestNavigation> {
  lastActivity = Date.now();
  return requestNavigation(request);
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
  const moving = activeNavigation();
  if (moving === null) return;
  await moving.settled;
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
  resetNavigationLifecycle();
  lastActivity = 0;
  ledger.length = 0;
  queue = Promise.resolve();
}
