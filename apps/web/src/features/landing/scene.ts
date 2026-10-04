/**
 * The landing scenes' shared timing helpers. Client only: every function
 * here is called from an effect, never during render.
 */

export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** The phone layout (the prototype's 760 px breakpoint). */
export function isSmallViewport(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 760px)").matches
  );
}

export type Wait = (ms: number) => Promise<void>;

/**
 * A looping story that runs while its element is on screen and stops
 * cleanly when it leaves: every wait rejects once the run is stale, so a
 * half-played story never keeps writing to the page. Reduced motion (or
 * no IntersectionObserver) shows the final state at once, with no timers.
 */
export function runScene(
  element: Element,
  run: (wait: Wait) => Promise<void>,
  finalState: () => void,
  options: { readonly threshold?: number; readonly reduce: boolean },
): () => void {
  if (options.reduce || typeof IntersectionObserver === "undefined") {
    finalState();
    return () => undefined;
  }
  let token = 0;
  const timers = new Set<number>();
  const observer = new IntersectionObserver(
    (entries) => {
      const on = entries.some((e) => e.isIntersecting);
      token++;
      if (!on) return;
      const mine = token;
      const alive = () => mine === token;
      const wait: Wait = (ms) =>
        new Promise((resolve, reject) => {
          const id = window.setTimeout(() => {
            timers.delete(id);
            if (alive()) resolve();
            else reject(new Error("scene left the screen"));
          }, ms);
          timers.add(id);
        });
      void (async () => {
        try {
          while (alive()) await run(wait);
        } catch {
          // The scene left the screen; the next entry starts it afresh.
        }
      })();
    },
    { threshold: options.threshold ?? 0.35 },
  );
  observer.observe(element);
  return () => {
    token++;
    observer.disconnect();
    for (const id of timers) window.clearTimeout(id);
    timers.clear();
  };
}
