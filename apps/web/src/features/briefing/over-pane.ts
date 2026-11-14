import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import { avoidRects, subscribeAvoid } from "@/features/q-dock/dock-avoid";

/**
 * Whether a floating box sits over a content pane (live check 2026-10-16:
 * the arrival greeting covered the GateQ application being read). A pane
 * marks itself with `data-content-pane`; floating things check against
 * those, never against the whole page, so they still float where there is
 * room. Re-checked as the page settles, on resize and on scroll.
 *
 * Journey audit 2026-11-13 D4: the briefing also covered primary actions
 * (the founder's message Send on desktop; an interest's Accept/Decline on
 * a phone). The controls a page registers with the Q dock (`useDockAvoid`:
 * a composer, a decision row) are now avoided the same way, so the
 * briefing tucks instead of covering them.
 */

/** Whether two boxes share any area. Pure, for its test. */
export function overlaps(
  a: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  b: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
): boolean {
  return (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  );
}

type Box = Pick<DOMRect, "left" | "right" | "top" | "bottom">;

function overAnyPane(mine: Box): boolean {
  if (mine.right <= mine.left || mine.bottom <= mine.top) return false;
  const pane = [...document.querySelectorAll("[data-content-pane]")].some(
    (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && overlaps(mine, rect);
    },
  );
  return pane || avoidRects().some((rect) => overlaps(mine, rect));
}

/**
 * How far from the viewport's bottom a box anchored there must sit so it
 * covers none of `controls`, given where it sits now. Null: it is clear
 * where it is. Pure, for its test.
 */
export function clearBottom(
  box: Box,
  controls: readonly Box[],
  viewportHeight: number,
  gap = 8,
): number | null {
  let current = box;
  let lifted: number | null = null;
  // Each lift can only move the box up, past the control it met; a few
  // passes settle any stack of controls.
  for (let pass = 0; pass < 8; pass += 1) {
    const hit = controls.find((control) => overlaps(current, control));
    if (hit === undefined) return lifted;
    const height = current.bottom - current.top;
    const bottom = hit.top - gap;
    lifted = Math.max(0, viewportHeight - bottom);
    current = { ...current, top: bottom - height, bottom };
  }
  return lifted;
}

// Layout effect on the client so a box that would cover a pane never
// paints there first; a plain effect on the server, where it never runs.
const useBeforePaint =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Re-runs `check` as the page settles, moves, or its controls change. */
function useRecheck(check: () => void, watch: unknown, active = true): void {
  const checkRef = useRef(check);
  useBeforePaint(() => {
    checkRef.current = check;
  });
  useBeforePaint(() => {
    if (!active) return;
    const run = () => checkRef.current();
    run();
    // Panes stream in after the shell: look again as the page settles.
    const timers = [400, 1500, 4000].map((ms) => window.setTimeout(run, ms));
    window.addEventListener("resize", run);
    window.addEventListener("scroll", run, { passive: true });
    const unsubscribe = subscribeAvoid(run);
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      window.removeEventListener("resize", run);
      window.removeEventListener("scroll", run);
      unsubscribe();
    };
  }, [watch, active]);
}

/**
 * `place` says where the box sits when shown in full (not where a tucked
 * form of it is), so tucking never flips it back and forth.
 */
export function useOverPane(place: () => Box | null, watch: unknown): boolean {
  const [over, setOver] = useState(false);
  useRecheck(() => {
    const box = place();
    setOver(box === null ? false : overAnyPane(box));
  }, watch);
  return over;
}

/**
 * Where the OPENED briefing sits so it covers none of `controls` (D4
 * remainder, live 14 Nov at 390px: opened over an interest, it covered
 * Accept/Decline and no scroll cleared it). It rises above the controls
 * it would meet; when that leaves too little room under the top edge, it
 * keeps that room and scrolls inside (maxHeight) rather than covering a
 * control. Null: clear where it is. Pure, for its test.
 */
export function openedPlacement(
  box: Box,
  controls: readonly Box[],
  viewportHeight: number,
  edge = 8,
  minHeight = 96,
): { readonly bottom: number; readonly maxHeight: number | null } | null {
  const bottom = clearBottom(box, controls, viewportHeight);
  if (bottom === null) return null;
  const height = box.bottom - box.top;
  const room = viewportHeight - bottom - edge;
  return {
    bottom,
    maxHeight: room >= height ? null : Math.max(minHeight, Math.floor(room)),
  };
}

/**
 * Measures where an element sits by its own classes (before any move) and
 * keeps `place` of that box against the registered controls current.
 */
function usePlacement<T>(
  ref: RefObject<Element | null>,
  active: boolean,
  watch: unknown,
  place: (natural: Box) => T | null,
): T | null {
  const [placed, setPlaced] = useState<T | null>(null);
  // Inactive: forget the move, so the next activation measures afresh.
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) setPlaced(null);
  }
  const natural = useRef<Box | null>(null);
  useRecheck(
    () => {
      const element = ref.current;
      if (element === null) return;
      if (placed === null) {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        natural.current = rect;
      }
      const from = natural.current;
      if (from === null) return;
      setPlaced(place(from));
    },
    watch,
    active,
  );
  return active ? placed : null;
}

/**
 * The bottom offset (px) that keeps a small bottom-anchored element (the
 * tucked briefing button) off every registered primary control; null when
 * it is clear where its own classes put it.
 */
export function useClearBottom(
  ref: RefObject<Element | null>,
  active: boolean,
  watch: unknown,
): number | null {
  return usePlacement(ref, active, watch, (natural) =>
    clearBottom(natural, avoidRects(), window.innerHeight),
  );
}

/** The opened briefing's placement off every registered control. */
export function useOpenedPlacement(
  ref: RefObject<Element | null>,
  active: boolean,
  watch: unknown,
): ReturnType<typeof openedPlacement> {
  return usePlacement(ref, active, watch, (natural) =>
    openedPlacement(natural, avoidRects(), window.innerHeight),
  );
}
