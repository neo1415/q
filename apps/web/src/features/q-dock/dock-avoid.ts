"use client";

import { useEffect, type RefObject } from "react";

import type { Obstacle, Rect } from "./dock-placement";

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
/**
 * Signposts that are not headings in the markup but read as one: a
 * fieldset's legend, a term in a settings list, a table or figure caption.
 */
const LABELS = "legend, dt, caption, figcaption";
/**
 * Whatever names a section, group or region is its label (settings
 * layout: a section titled by an element that is not an h1-h6 is still
 * titled), so it is avoided like a heading.
 */
const LABELLED =
  "section[aria-labelledby], fieldset[aria-labelledby], [role='group'][aria-labelledby], [role='region'][aria-labelledby]";
const TEXT = `${HEADINGS}, ${LABELS}`;

/** Not obstacles: the dock itself, and what nobody can see or reach. */
const IGNORED = "[data-q-dock], [inert], [aria-hidden='true']";

/**
 * A heading's text, not its block: "Plan allowances" leaves the rest of
 * its line free. Falls back to the element where ranges have no geometry.
 */
function textBox(element: Element): DOMRect {
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

/** The elements that name a section, group or region on the page. */
function sectionLabels(): Set<Element> {
  const labels = new Set<Element>();
  for (const labelled of document.querySelectorAll(LABELLED)) {
    for (const id of (labelled.getAttribute("aria-labelledby") ?? "").split(
      /\s+/,
    )) {
      const label = id === "" ? null : document.getElementById(id);
      if (label !== null) labels.add(label);
    }
  }
  return labels;
}

/**
 * Everything on screen the dock must not cover (spec §6.2 a): every
 * interactive element, heading and section label in view, found the same
 * way on every page, plus the registered zones. One read of layout per
 * placement. Headings and labels are marked `text`: when nowhere is free,
 * the dock covers a control's edge before it covers what a page is called.
 */
export function obstacleRects(): readonly Obstacle[] {
  const rects: Obstacle[] = [...avoidRects()];
  const text = new Set<Element>([
    ...document.querySelectorAll(TEXT),
    ...sectionLabels(),
  ]);
  const elements = new Set<Element>([
    ...document.querySelectorAll(INTERACTIVE),
    ...text,
  ]);
  for (const element of elements) {
    if (element.closest(IGNORED) !== null) continue;
    const isText = text.has(element) && !element.matches(INTERACTIVE);
    const box = isText ? textBox(element) : element.getBoundingClientRect();
    // Visually hidden text (sr-only) is a 1 px box: nothing to cover.
    if (box.width < 2 || box.height < 2) continue;
    if (!onScreen(box)) continue;
    rects.push(isText ? { ...toRect(box), text: true } : toRect(box));
  }
  return rects;
}

/**
 * Calls `onChange` whenever the page's layout may have moved under the
 * dock without a scroll or a resize (QA 390 px, /settings: the dock sat on
 * "Notifications" after the page settled). A client setting that loads in
 * changes a text node, not the tree; a web font swaps and every line below
 * reflows; neither was seen, so the dock kept the obstacles it measured
 * first. Settled first: a streaming answer would otherwise re-measure the
 * page on every token.
 */
export function watchLayout(onChange: () => void): () => void {
  let settle = 0;
  const later = () => {
    window.clearTimeout(settle);
    settle = window.setTimeout(onChange, 200);
  };
  const mutations = new MutationObserver(later);
  mutations.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  // The page growing or shrinking: content above a heading changed height.
  const resize =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(later);
  resize?.observe(document.body);
  const fonts = typeof document.fonts === "undefined" ? null : document.fonts;
  fonts?.addEventListener("loadingdone", later);
  let live = true;
  void fonts?.ready.then(() => {
    if (live) later();
  });
  return () => {
    live = false;
    window.clearTimeout(settle);
    mutations.disconnect();
    resize?.disconnect();
    fonts?.removeEventListener("loadingdone", later);
  };
}
