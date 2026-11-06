import { arrivalElement, arrivalTargetOf, boxOf } from "./deep-link";

/**
 * Q Workspace W3.3/W3.4: what happens when a move lands.
 *
 * Arrival: the element the URL names (a section, a message, a Board item,
 * the latest entry) is scrolled into view and marked briefly, and, after
 * Q's own move, focus goes to the page's heading so a screen reader hears
 * where they are. Nothing of it happens while the person is typing to Q
 * outside the page: their caret and their place are never taken from them.
 * Reduced motion scrolls at once and marks without a fade.
 *
 * Back: each of Q's moves is a normal history entry (the lifecycle pushes
 * through the router), now marked with where it came from, so Back
 * returns to the page before Q's move and the page pane can tell Q's
 * moves from the person's own clicks. The person's own entries are never
 * touched.
 */

/** How long a page may take to render the element it was sent to. */
export const ARRIVAL_WAIT_MS = 4_000;
/** How long the mark stays on the element. */
export const ARRIVAL_MARK_MS = 1_800;
/** The attribute the mark is drawn from (globals.css). */
export const ARRIVAL_MARK = "data-q-arrived";
const POLL_MS = 50;

export type ArrivalResult =
  "ARRIVED" | "NO_TARGET" | "MISSING" | "TYPING" | "SUPERSEDED";

export type ArrivalOptions = {
  /** Q's move (focus goes to the heading), or the person's own load. */
  readonly byQ: boolean;
  readonly href?: string | undefined;
  readonly reducedMotion?: boolean | undefined;
  readonly waitMs?: number | undefined;
};

/** The page pane: where arrival works. Q's composer is outside it. */
function pagePane(): HTMLElement | null {
  return document.getElementById("main");
}

function editable(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly;
  if (element instanceof HTMLInputElement) {
    return !element.readOnly && !NOT_TYPED.has(element.type);
  }
  return false;
}
const NOT_TYPED = new Set([
  "button",
  "checkbox",
  "radio",
  "range",
  "submit",
  "reset",
  "file",
  "color",
  "image",
]);

/** The person is typing to Q (a field outside the page pane has focus). */
export function typingOutsidePage(): boolean {
  const active = document.activeElement;
  if (!editable(active)) return false;
  const pane = pagePane();
  return pane === null || !pane.contains(active);
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

let generation = 0;

/** The page's heading, made focusable without entering the tab order. */
function pageHeading(): HTMLElement | null {
  const root = pagePane() ?? document.body;
  const heading = root.querySelector<HTMLElement>("h1") ?? null;
  if (heading === null) return null;
  if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
  return heading;
}

function mark(element: HTMLElement): void {
  element.setAttribute(ARRIVAL_MARK, "");
  window.setTimeout(
    () => element.removeAttribute(ARRIVAL_MARK),
    ARRIVAL_MARK_MS,
  );
}

/**
 * Arrive at what the URL names. Waits (bounded) for the page to render it;
 * a newer arrival supersedes this one. Resolves with what happened.
 */
export function arrive(options: ArrivalOptions): Promise<ArrivalResult> {
  const mine = ++generation;
  const href = options.href ?? window.location.href;
  const target = arrivalTargetOf(href);
  const reduced = options.reducedMotion ?? prefersReducedMotion();
  const focusHeading = () => {
    if (!options.byQ || typingOutsidePage()) return;
    pageHeading()?.focus({ preventScroll: target !== null });
  };
  if (target === null) {
    focusHeading();
    return Promise.resolve("NO_TARGET");
  }
  const deadline = Date.now() + (options.waitMs ?? ARRIVAL_WAIT_MS);
  return new Promise((resolve) => {
    const step = () => {
      if (mine !== generation) {
        resolve("SUPERSEDED");
        return;
      }
      if (typingOutsidePage()) {
        resolve("TYPING");
        return;
      }
      const found = arrivalElement(target);
      const box = found === null ? null : boxOf(found);
      if (box === null) {
        if (Date.now() >= deadline) {
          focusHeading();
          resolve("MISSING");
          return;
        }
        window.setTimeout(step, POLL_MS);
        return;
      }
      box.scrollIntoView?.({
        block: target.kind === "SECTION" ? "start" : "center",
        behavior: reduced ? "auto" : "smooth",
      });
      mark(box);
      focusHeading();
      resolve("ARRIVED");
    };
    step();
  });
}

/** The history mark on an entry Q's move made. */
export type QMoveMark = { readonly from: string; readonly at: number };
const MARK_KEY = "cqQMove";

/**
 * Marks the current history entry as Q's move from `from`. The entry's
 * own state (the router's) is kept; only this key is added.
 */
export function markQMove(from: string): void {
  const state: unknown = window.history.state;
  const base =
    typeof state === "object" && state !== null
      ? (state as Record<string, unknown>)
      : {};
  const markValue: QMoveMark = { from, at: Date.now() };
  window.history.replaceState(
    { ...base, [MARK_KEY]: markValue },
    "",
    window.location.href,
  );
}

/** Where the current entry's Q move came from, or null (the person's own). */
export function qMoveOrigin(): QMoveMark | null {
  const state: unknown = window.history.state;
  if (typeof state !== "object" || state === null) return null;
  const value = (state as Record<string, unknown>)[MARK_KEY];
  if (typeof value !== "object" || value === null) return null;
  const { from, at } = value as Record<string, unknown>;
  return typeof from === "string" && typeof at === "number"
    ? { from, at }
    : null;
}
