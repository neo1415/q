/**
 * Lane W (2026-10-15): what of the page is in the viewport, for the
 * manifest's `inView` and each section's `visible` refs.
 *
 * One IntersectionObserver for the whole tab. Its callback only records
 * the latest ratio per element: it never notifies, re-renders or moves the
 * manifest's sequence, so scrolling costs nothing here beyond the
 * browser's own threshold crossings. The manifest reads the ratios when a
 * turn is sent. An element not yet reported (just registered, or a browser
 * without the observer) falls back to its bounding box at that moment.
 */

const ratios = new WeakMap<Element, number>();
const observed = new Set<Element>();
let shared: IntersectionObserver | null | undefined;

/** Half of an element visible, or half the viewport filled by it. */
const LOOKING_AT = 0.5;

function observer(): IntersectionObserver | null {
  if (shared !== undefined) return shared;
  shared =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const root = entry.rootBounds?.height ?? 0;
              // A card taller than the screen is never half visible; filling
              // half the screen counts as looking at it.
              const fills = root > 0 ? entry.intersectionRect.height / root : 0;
              ratios.set(
                entry.target,
                entry.isIntersecting
                  ? Math.max(entry.intersectionRatio, fills, 0.01)
                  : 0,
              );
            }
          },
          { threshold: [0, LOOKING_AT] },
        );
  return shared;
}

/** Starts observing an element once; drops elements no longer on the page. */
export function observeInViewport(element: Element): void {
  const io = observer();
  if (io === null || observed.has(element)) return;
  observed.add(element);
  io.observe(element);
}

/** Bounded upkeep, run when a turn is sent: forget removed elements. */
export function pruneViewport(): void {
  const io = observer();
  if (io === null) return;
  for (const element of observed) {
    if (element.isConnected) continue;
    io.unobserve(element);
    observed.delete(element);
    ratios.delete(element);
  }
}

function rectRatio(element: Element): number {
  if (typeof window === "undefined") return 0;
  const rect = element.getBoundingClientRect();
  if (rect.width + rect.height <= 0) return 0;
  const height =
    Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
  const width =
    Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);
  if (height <= 0 || width <= 0) return 0;
  const own = rect.height > 0 ? height / rect.height : 1;
  const fills = window.innerHeight > 0 ? height / window.innerHeight : 0;
  return Math.max(own, fills, 0.01);
}

/**
 * How much of the element is visible, 0 to 1: the observer's last report,
 * else its box now. Observes it for next time.
 */
export function visibleRatio(element: Element): number {
  observeInViewport(element);
  return ratios.get(element) ?? rectRatio(element);
}

/** Any part on screen. */
export function isOnScreen(element: Element): boolean {
  return visibleRatio(element) > 0;
}

/** Enough on screen to be what they are looking at. */
export function isLookedAt(element: Element): boolean {
  return visibleRatio(element) >= LOOKING_AT;
}

/** Tests: forget everything (a fresh tab). */
export function resetViewport(): void {
  shared?.disconnect();
  shared = undefined;
  observed.clear();
}
