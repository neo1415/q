"use client";

import { useEffect, type RefObject } from "react";

import type { Rect } from "./dock-placement";

/**
 * Controls the dock must never cover (spec §6.2 a; WCAG 2.4.11).
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

/** The registered controls that are on screen now, as viewport rects. */
export function avoidRects(): readonly Rect[] {
  const rects: Rect[] = [];
  for (const element of zones) {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    if (
      box.bottom <= 0 ||
      box.right <= 0 ||
      box.top >= window.innerHeight ||
      box.left >= window.innerWidth
    ) {
      continue;
    }
    rects.push({
      left: box.left,
      top: box.top,
      right: box.right,
      bottom: box.bottom,
    });
  }
  return rects;
}
