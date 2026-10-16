import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Whether a floating box sits over a content pane (live check 2026-10-16:
 * the arrival greeting covered the GateQ application being read). A pane
 * marks itself with `data-content-pane`; floating things check against
 * those, never against the whole page, so they still float where there is
 * room. Re-checked as the page settles, on resize and on scroll.
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
  return [...document.querySelectorAll("[data-content-pane]")].some((pane) => {
    const rect = pane.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && overlaps(mine, rect);
  });
}

// Layout effect on the client so a box that would cover a pane never
// paints there first; a plain effect on the server, where it never runs.
const useBeforePaint =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * `place` says where the box sits when shown in full (not where a tucked
 * form of it is), so tucking never flips it back and forth.
 */
export function useOverPane(place: () => Box | null, watch: unknown): boolean {
  const [over, setOver] = useState(false);
  const placeRef = useRef(place);
  // The latest `place`, kept for the listeners below (set after render).
  useBeforePaint(() => {
    placeRef.current = place;
  });
  useBeforePaint(() => {
    const check = () => {
      const box = placeRef.current();
      setOver(box === null ? false : overAnyPane(box));
    };
    check();
    // Panes stream in after the shell: look again as the page settles.
    const timers = [400, 1500, 4000].map((ms) => window.setTimeout(check, ms));
    window.addEventListener("resize", check);
    window.addEventListener("scroll", check, { passive: true });
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      window.removeEventListener("resize", check);
      window.removeEventListener("scroll", check);
    };
  }, [watch]);
  return over;
}
