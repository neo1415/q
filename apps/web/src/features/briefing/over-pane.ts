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
 * The bottom offset (px) that keeps a small bottom-anchored element (the
 * tucked briefing button) off every registered primary control; null when
 * it is clear where its own classes put it.
 */
export function useClearBottom(
  ref: RefObject<Element | null>,
  active: boolean,
  watch: unknown,
): number | null {
  const [lift, setLift] = useState<number | null>(null);
  // Untucked: forget the lift, so the next tuck measures afresh.
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) setLift(null);
  }
  // Where the element sits by its classes, measured before any lift.
  const natural = useRef<Box | null>(null);
  useRecheck(
    () => {
      const element = ref.current;
      if (element === null) return;
      if (lift === null) {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        natural.current = rect;
      }
      const from = natural.current;
      if (from === null) return;
      setLift(clearBottom(from, avoidRects(), window.innerHeight));
    },
    watch,
    active,
  );
  return active ? lift : null;
}
