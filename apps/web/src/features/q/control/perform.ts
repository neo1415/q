import type { QUiActIntent } from "@capital-q/contracts";

import {
  actionable,
  controlOf,
  isDisabled,
  isInteractive,
  KIND_ACTS,
  listItems,
  stateElement,
  stateOf,
  type ControlEntry,
  type ControlState,
  type ControlStatus,
} from "./registry";
import { currentRoute, routeEpoch, routeOfHref } from "./route-state";

/**
 * RECOVERY-2026-10 (C1/C2): one UI act on one registered control, through
 * the control's own element -- the click a person's pointer or Enter key
 * runs -- never a selector or coordinates from a model.
 *
 * DONE is reported only once the page shows the effect, never on the
 * click alone (founder requirement 2026-10-08):
 * - a tab: it is the selected tab and, when it is a link, the router has
 *   settled on its route;
 * - a section: it is in the viewport;
 * - a list item: the route changed, a dialog opened, or the item is
 *   selected, current or open (an item with nothing to open: in view);
 * - a disclosure, menu or toggle: its state is the one asked for;
 * - a button: the route changed, a dialog opened, or its own state moved;
 * - focus: it has focus.
 * An effect that does not show within its bound is FAILED.
 */

/** How long a state change may take (a tab whose panel streams from the server). */
export const STATE_CONFIRM_MS = 6_000;
/** How long a smooth scroll may take to bring something into view. */
export const SCROLL_CONFIRM_MS = 2_000;
/** How long a click's effect (a dialog, a move) may take to show. */
export const EFFECT_CONFIRM_MS = 6_000;
const POLL_MS = 50;

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

/**
 * For a page's own handler (onAct): waits until its effect shows, so it
 * answers DONE only then. True when it showed within the bound.
 */
export function effectShown(
  test: () => boolean,
  limitMs: number = STATE_CONFIRM_MS,
): Promise<boolean> {
  return until(test, limitMs);
}

/** The first element with a box: a `contents` wrapper has none of its own. */
function boxed(element: HTMLElement): HTMLElement {
  if (typeof window === "undefined") return element;
  if (window.getComputedStyle(element).display !== "contents") return element;
  for (const child of element.children) {
    if (child instanceof HTMLElement) return boxed(child);
  }
  return element;
}

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Whether any part of the element is inside the viewport now. */
export function inViewport(element: HTMLElement): boolean {
  const rect = boxed(element).getBoundingClientRect();
  return (
    rect.width + rect.height > 0 &&
    rect.bottom > 0 &&
    rect.top < window.innerHeight &&
    rect.right > 0 &&
    rect.left < window.innerWidth
  );
}

async function scrollTo(element: HTMLElement): Promise<ControlStatus> {
  const box = boxed(element);
  if (typeof box.scrollIntoView !== "function") return "FAILED";
  box.scrollIntoView({
    behavior: reducedMotion() ? "auto" : "smooth",
    block: "start",
  });
  return (await until(() => inViewport(box), SCROLL_CONFIRM_MS))
    ? "DONE"
    : "FAILED";
}

function focus(element: HTMLElement): ControlStatus {
  const target = actionable(element);
  if (!isInteractive(target)) return "NOT_APPLICABLE";
  target.focus({ preventScroll: false });
  return document.activeElement === target ? "DONE" : "FAILED";
}

/**
 * The control's current state, read again by id each time: a tab that is a
 * link re-renders (or the page replaces it) as it opens, so the element
 * that was clicked may no longer be the one on screen.
 */
function currentState(entry: ControlEntry): ControlState | undefined {
  const live = controlOf(entry.id) ?? entry;
  const element = live.element();
  return element === null
    ? undefined
    : stateOf(live.kind, stateElement(live.kind, element));
}

function openDialogs(): number {
  return document.querySelectorAll(
    '[role="dialog"]:not([hidden]), [role="alertdialog"]:not([hidden]), dialog[open]',
  ).length;
}

/** What a click may change, taken before it, to confirm it after. */
type Before = {
  readonly epoch: number;
  readonly dialogs: number;
  readonly state: ControlState | undefined;
  readonly url: string;
};

function before(entry: ControlEntry): Before {
  return {
    epoch: routeEpoch(),
    dialogs: openDialogs(),
    state: currentState(entry),
    url: `${window.location.pathname}${window.location.search}`,
  };
}

/**
 * A link's click is confirmed once the router has settled on its route
 * (the shell reports the route Next rendered), not when the URL bar moves.
 */
function settledOn(link: HTMLElement): (() => boolean) | null {
  const href = link instanceof HTMLAnchorElement ? link.href : null;
  const route = href === null || href === "" ? null : routeOfHref(href);
  if (route === null) return null;
  return () => currentRoute() === route;
}

/** A click had a visible effect: a settled move, a dialog, or a new state. */
function moved(entry: ControlEntry, was: Before, item?: HTMLElement): boolean {
  if (routeEpoch() !== was.epoch) return true;
  if (`${window.location.pathname}${window.location.search}` !== was.url) {
    // A shallow URL change (history.replaceState) the page made itself.
    return true;
  }
  if (openDialogs() > was.dialogs) return true;
  if (currentState(entry) !== was.state) return true;
  if (item !== undefined) {
    const marked = [item, ...item.querySelectorAll<HTMLElement>("*")].some(
      (one) =>
        one.getAttribute("aria-selected") === "true" ||
        one.getAttribute("aria-expanded") === "true" ||
        (one.getAttribute("aria-current") ?? "false") !== "false" ||
        (one instanceof HTMLDetailsElement && one.open),
    );
    if (marked) return true;
  }
  return false;
}

const OPENING = new Set(["EXPAND", "OPEN"]);

async function byKind(
  entry: ControlEntry,
  element: HTMLElement,
  intent: QUiActIntent,
): Promise<ControlStatus> {
  const target = actionable(element);
  switch (intent.act) {
    case "SCROLL_TO":
      return scrollTo(element);
    case "FOCUS":
      return focus(element);
    case "SELECT_TAB":
    case "ACTIVATE": {
      if (entry.kind === "TAB") {
        const route = settledOn(target);
        const selected = () => currentState(entry) === "SELECTED";
        const done = () => selected() && (route === null || route());
        if (done()) return "DONE";
        target.click();
        return (await until(done, STATE_CONFIRM_MS)) ? "DONE" : "FAILED";
      }
      const was = before(entry);
      target.click();
      return (await until(() => moved(entry, was), EFFECT_CONFIRM_MS))
        ? "DONE"
        : "FAILED";
    }
    case "SELECT_ITEM": {
      const items = listItems(element);
      const index = intent.index ?? 1;
      const item = items[index - 1];
      if (item === undefined) return "TARGET_MISSING";
      const open = actionable(item);
      // An item with nothing to open (a ranked risk, a line of text) is
      // selected by bringing it into view; a click on it would do nothing.
      if (!isInteractive(open)) return scrollTo(item);
      if (isDisabled(open)) return "NOT_APPLICABLE";
      const was = before(entry);
      open.click();
      return (await until(() => moved(entry, was, item), EFFECT_CONFIRM_MS))
        ? "DONE"
        : "FAILED";
    }
    case "EXPAND":
    case "OPEN":
    case "COLLAPSE":
    case "CLOSE": {
      // A dialog closes through its own close control only: its first
      // button could as well be the one that confirms.
      if (entry.kind === "DIALOG") {
        const close = element.querySelector<HTMLElement>(
          '[data-q-close], button[aria-label^="Close" i]',
        );
        if (close === null) return "NOT_APPLICABLE";
        close.click();
        return (await until(
          () => !element.isConnected || element.hidden,
          STATE_CONFIRM_MS,
        ))
          ? "DONE"
          : "FAILED";
      }
      const opening = OPENING.has(intent.act);
      const want: ControlState = opening ? "OPEN" : "CLOSED";
      if (currentState(entry) === want) return "DONE";
      // Without an expanded state to read, an opening is confirmed by the
      // dialog or popup it shows; a closing cannot be confirmed at all.
      const was = before(entry);
      const stateful = was.state === "OPEN" || was.state === "CLOSED";
      if (!stateful && !opening) return "NOT_APPLICABLE";
      target.click();
      return (await until(
        () =>
          stateful ? currentState(entry) === want : openDialogs() > was.dialogs,
        2_000,
      ))
        ? "DONE"
        : "FAILED";
    }
    case "SET": {
      if (typeof intent.value !== "boolean") return "NOT_APPLICABLE";
      const want = intent.value ? "ON" : "OFF";
      if (currentState(entry) === want) return "DONE";
      target.click();
      return (await until(() => currentState(entry) === want, 2_000))
        ? "DONE"
        : "FAILED";
    }
    // Only through the page's own handler (onAct): a filter's code value,
    // a carousel's step. Without one, the kind does not do it.
    case "FILTER":
    case "NEXT":
    case "PREVIOUS":
    case "SCROLL_DOWN":
    case "SCROLL_UP":
    case "SCROLL_TOP":
    case "SCROLL_BOTTOM":
    case "BACK":
    case "FORWARD":
      return "NOT_APPLICABLE";
  }
}

/**
 * Performs one act on a registered control: the page's own handler first
 * (it may decline with NOT_APPLICABLE and leave the kind's default), then
 * the kind's default. A disabled control, or an act its kind does not
 * take, is NOT_APPLICABLE; a throw is FAILED.
 *
 * A page's own handler answers DONE only once its effect shows (its own
 * state set and rendered); that is the handler's contract.
 */
export async function performOnControl(
  entry: ControlEntry,
  intent: QUiActIntent,
): Promise<ControlStatus> {
  const element = entry.element();
  if (element === null || !element.isConnected) return "TARGET_MISSING";
  // Reading or scrolling to a disabled control is fine; acting on it is not.
  if (
    intent.act !== "SCROLL_TO" &&
    intent.act !== "FOCUS" &&
    isDisabled(stateElement(entry.kind, element))
  ) {
    return "NOT_APPLICABLE";
  }
  if (entry.onAct !== undefined) {
    const own = await entry.onAct(intent);
    if (own !== "NOT_APPLICABLE" || entry.exclusive === true) return own;
  }
  if (!KIND_ACTS[entry.kind].includes(intent.act)) return "NOT_APPLICABLE";
  return byKind(entry, element, intent);
}
