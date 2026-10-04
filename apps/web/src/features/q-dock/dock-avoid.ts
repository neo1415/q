"use client";

import { useEffect, type RefObject } from "react";

import type { Rect } from "./dock-placement";

/**
 * Controls the dock must never cover (spec §6.2 a; WCAG 2.4.11), beyond
 * the interactive elements and headings it finds on its own.
 *
 * A composer, a primary action bar, video controls or a decision rail
 * registers itself; when the dock's anchor would overlap one that is on
 * screen, the dock glides to the nearest free anchor and comes back when
 * the control goes away. Registration is the whole API:
 *
 *   const ref = useRef<HTMLDivElement>(null);
 *   useDockAvoid(ref);
 */

const zones = new Set<Element>();
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

export function useDockAvoid(
  ref: RefObject<Element | null>,
  active = true,
): void {
  useEffect(() => {
    const element = ref.current;
    if (!active || element === null) return;
    zones.add(element);
    changed();
    return () => {
      zones.delete(element);
      changed();
    };
  }, [ref, active]);
}

export function subscribeAvoid(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function onScreen(box: DOMRect): boolean {
  return !(
    box.bottom <= 0 ||
    box.right <= 0 ||
    box.top >= window.innerHeight ||
    box.left >= window.innerWidth
  );
}

function toRect(box: DOMRect): Rect {
  return {
    left: box.left,
    top: box.top,
    right: box.right,
    bottom: box.bottom,
  };
}

/** The registered controls that are on screen now, as viewport rects. */
export function avoidRects(): readonly Rect[] {
  const rects: Rect[] = [];
  for (const element of zones) {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    if (!onScreen(box)) continue;
    rects.push(toRect(box));
  }
  return rects;
}

/**
 * What a person can press, type in or read as a signpost. A bare
 * `tabindex` is left out: scroll regions carry one and span the page.
 */
const INTERACTIVE = [
  "a[href]",
  "button",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "summary",
  "video[controls]",
  "audio[controls]",
  "[contenteditable='true']",
  "[contenteditable='']",
  "[role='button']",
  "[role='link']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='option']",
  "[role='slider']",
  "[role='combobox']",
  "[role='textbox']",
].join(", ");
const HEADINGS = "h1, h2, h3, h4, h5, h6, [role='heading']";

/** Not obstacles: the dock itself, and what nobody can see or reach. */
const IGNORED = "[data-q-dock], [inert], [aria-hidden='true']";

/**
 * A heading's text, not its block: "Plan allowances" leaves the rest of
 * its line free. Falls back to the element where ranges have no geometry.
 */
function headingBox(element: Element): DOMRect {
  try {
    const range = document.createRange();
    range.selectNodeContents(element);
    const box = range.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) return box;
  } catch {
    // No layout for ranges here (jsdom): the element's box is the safe side.
  }
  return element.getBoundingClientRect();
}

/**
 * Everything on screen the dock must not cover (spec §6.2 a): every
 * interactive element and heading in view, found the same way on every
 * page, plus the registered zones. One read of layout per placement.
 */
export function obstacleRects(): readonly Rect[] {
  const rects: Rect[] = [...avoidRects()];
  for (const element of document.querySelectorAll(
    `${INTERACTIVE}, ${HEADINGS}`,
  )) {
    if (element.closest(IGNORED) !== null) continue;
    const box = element.matches(HEADINGS)
      ? headingBox(element)
      : element.getBoundingClientRect();
    // Visually hidden text (sr-only) is a 1 px box: nothing to cover.
    if (box.width < 2 || box.height < 2) continue;
    if (!onScreen(box)) continue;
    rects.push(toRect(box));
  }
  return rects;
}
