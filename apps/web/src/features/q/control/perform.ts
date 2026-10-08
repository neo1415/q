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

/**
 * RECOVERY-2026-10 (C1/C2): one UI act on one registered control, through
 * the control's own element -- the click a person's pointer or Enter key
 * runs -- never a selector or coordinates from a model.
 *
 * DONE means the act ran and, where the control has a state to show it,
 * the state changed: a tab Q selected reports DONE only once it is the
 * selected tab. Nothing is reported done that the page did not do.
 */

/** How long a state change may take (a tab whose panel streams from the server). */
export const STATE_CONFIRM_MS = 6_000;
const POLL_MS = 50;

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

function scrollTo(element: HTMLElement): ControlStatus {
  const box = boxed(element);
  if (typeof box.scrollIntoView !== "function") return "FAILED";
  box.scrollIntoView({
    behavior: reducedMotion() ? "auto" : "smooth",
    block: "start",
  });
  return "DONE";
}

function focus(element: HTMLElement): ControlStatus {
  const target = actionable(element);
  if (!isInteractive(target)) return "NOT_APPLICABLE";
  target.focus({ preventScroll: false });
  return document.activeElement === target ? "DONE" : "FAILED";
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function confirmState(
  entry: ControlEntry,
  wanted: (state: ControlState | undefined) => boolean,
  limitMs: number = STATE_CONFIRM_MS,
): Promise<boolean> {
  const until = Date.now() + limitMs;
  for (;;) {
    if (wanted(currentState(entry))) return true;
    if (Date.now() >= until) return false;
    await wait(POLL_MS);
  }
}

/** Whether the control shows the state at all (an element without ARIA cannot confirm). */
function hasState(entry: ControlEntry): boolean {
  return currentState(entry) !== undefined;
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
        if (stateOf("TAB", target) === "SELECTED") return "DONE";
        target.click();
        return (await confirmState(entry, (state) => state === "SELECTED"))
          ? "DONE"
          : "FAILED";
      }
      target.click();
      return "DONE";
    }
    case "SELECT_ITEM": {
      const items = listItems(element);
      const index = intent.index ?? 1;
      const item = items[index - 1];
      if (item === undefined) return "TARGET_MISSING";
      const open = actionable(item);
      if (isDisabled(open)) return "NOT_APPLICABLE";
      open.click();
      return "DONE";
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
        return "DONE";
      }
      const opening = OPENING.has(intent.act);
      const before = stateOf(entry.kind, target);
      if (before === (opening ? "OPEN" : "CLOSED")) return "DONE";
      target.click();
      if (!hasState(entry)) return "DONE";
      return (await confirmState(
        entry,
        (state) => state === (opening ? "OPEN" : "CLOSED"),
        2_000,
      ))
        ? "DONE"
        : "FAILED";
    }
    case "SET": {
      if (typeof intent.value !== "boolean") return "NOT_APPLICABLE";
      const want = intent.value ? "ON" : "OFF";
      if (stateOf("TOGGLE", target) === want) return "DONE";
      target.click();
      return (await confirmState(entry, (state) => state === want, 2_000))
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
