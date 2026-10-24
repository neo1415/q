"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A count that moves to its new value instead of jumping (owner reference
 * design, 24 Oct): 0.25–0.9 s depending on the distance, tabular numerals
 * so the line never shifts. Reduced motion, a first render or a
 * non-browser: the value is shown at once.
 */
function prefersReducedMotion(): boolean {
  return (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function" ||
    typeof requestAnimationFrame !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useCountUp(value: number): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const still = prefersReducedMotion();
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value || still) return;
    const duration = Math.min(900, Math.max(250, Math.abs(value - start) * 60));
    const began = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / duration);
      // ease-out cubic: fast at first, settling on the value.
      const eased = 1 - (1 - t) ** 3;
      setShown(Math.round(start + (value - start) * eased));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, still]);
  // Reduced motion jumps: the value itself, never an animated one.
  return still ? value : shown;
}

/** "12 waiting on you": the number inline with its words, counting up. */
export function CountUp({
  value,
  className,
}: {
  readonly value: number;
  readonly className?: string | undefined;
}) {
  const shown = useCountUp(value);
  return (
    <span className={`tabular-nums ${className ?? ""}`} data-count={value}>
      {/* The settled value for assistive tech; the moving one is visual. */}
      <span className="sr-only">{String(value)}</span>
      <span aria-hidden="true">{String(shown)}</span>
    </span>
  );
}
