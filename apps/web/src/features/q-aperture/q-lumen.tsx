"use client";

import { useEffect, useRef } from "react";

import { useQMotion } from "./q-motion";

/**
 * Q Lumen (spec §5.1): while a voice session is open, a soft light along
 * the viewport edge on the dock's side answers "Q is here and listening"
 * at a glance. At most 24 px deep, one hue, a gradient into transparency
 * so it never sits under text as a fill, and pointer-transparent.
 *
 * Its intensity follows the audio, through opacity only, and only while
 * the session is open under Full motion; Calm holds it still; Off, reduced
 * transparency, more contrast and forced colours remove it (the last three
 * in CSS as well, so it is gone even before this runs).
 */
export function QLumen({
  active,
  input,
  output,
  side = "right",
}: {
  readonly active: boolean;
  /** 0..1 microphone and speaker energy; the light follows the louder. */
  readonly input?: (() => number) | undefined;
  readonly output?: (() => number) | undefined;
  readonly side?: "left" | "right" | undefined;
}) {
  const { motion, bloom } = useQMotion();
  const ref = useRef<HTMLDivElement>(null);
  const levelRef = useRef({ input, output });
  useEffect(() => {
    levelRef.current = { input, output };
  }, [input, output]);

  const moving = active && motion === "full" && bloom;
  useEffect(() => {
    const element = ref.current;
    if (!moving || element === null) return;
    let frame = 0;
    let smoothed = 0;
    const step = () => {
      const { input: heard, output: said } = levelRef.current;
      const raw = Math.max(heard?.() ?? 0, said?.() ?? 0);
      const target = Math.min(1, Math.max(0, raw));
      smoothed += (target - smoothed) * (target > smoothed ? 0.4 : 0.08);
      element.style.opacity = String(0.35 + 0.55 * smoothed);
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => {
      window.cancelAnimationFrame(frame);
      element.style.opacity = "";
    };
  }, [moving]);

  if (!active || motion === "off" || !bloom) return null;
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="cq-q-lumen"
      data-side={side}
      data-q-lumen
    />
  );
}
