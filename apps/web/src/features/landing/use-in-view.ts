"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * True once the element has come near the viewport, and stays true. The
 * landing's islands load their code on this, so a visitor who never
 * scrolls never downloads them. A host without IntersectionObserver (a
 * test DOM, an old browser) counts as in view, so content is never lost.
 */
export function useInView(
  ref: RefObject<Element | null>,
  options: { readonly rootMargin?: string; readonly threshold?: number } = {},
): boolean {
  // No IntersectionObserver (old browsers, test DOMs): visible from the
  // start. On the server it is always false, so the HTML holds the fallback.
  const [seen, setSeen] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof IntersectionObserver === "undefined",
  );
  const { rootMargin = "200px 0px", threshold = 0 } = options;
  useEffect(() => {
    const element = ref.current;
    if (element === null || seen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin, threshold },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, seen, rootMargin, threshold]);
  return seen;
}

/** The person's reduced-motion preference, read after mount. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
