"use client";

import { useEffect, useState, type CSSProperties } from "react";

import type { QApertureState } from "../q-aperture/aperture-state";
import { useQSessionOptional } from "../q/q-session";
import { EDGE_STRIP, edgeDots, edgeFlowing } from "./edge-flow";

/**
 * Particles travelling around the page edge while Q works (ADR 0062,
 * Q room R7). Driven by Q's real state from the one Q session, only while
 * Q is thinking or working. Under reduced motion nothing moves: a still
 * edge line shows instead. Decorative: hidden from assistive technology,
 * since Q's label and presence already say that it is working.
 *
 * R9: drawn by the compositor, not a frame loop. Each side is a strip of
 * dots slid by a CSS transform animation, its twinkle an opacity one;
 * nothing runs on the main thread per frame, so a tap while Q works is
 * not queued behind drawing. Paused while off, and while the tab is
 * hidden.
 */

const SIDES = ["top", "right", "bottom", "left"] as const;

/** Seconds per twinkle (the second layer's opacity, alternating). */
const TWINKLE_S = 2.4;

/**
 * A strip's look and motion. Clockwise: the top runs right, the right
 * side down, the bottom left, the left side up; keyframes per tile live
 * in globals.css (fixed px, so the compositor runs them as they are).
 */
function stripStyle(
  side: (typeof SIDES)[number],
  layer: (typeof EDGE_STRIP.layers)[number],
  twinkle: boolean,
): CSSProperties {
  const axis = side === "top" || side === "bottom" ? "x" : "y";
  const forward = side === "top" || side === "right";
  const thickness = `${String(EDGE_STRIP.thicknessPx)}px`;
  const tile = `${String(layer.tilePx)}px`;
  const run = `cq-edge-${axis}-${forward ? "fwd" : "back"}-${String(layer.tilePx)}`;
  return {
    backgroundImage: edgeDots(axis, layer.tilePx, layer.dots, layer.salt),
    backgroundSize:
      axis === "x" ? `${tile} ${thickness}` : `${thickness} ${tile}`,
    [axis === "x" ? "width" : "height"]: `calc(100% + ${tile})`,
    animationName: twinkle ? `${run}, cq-edge-twinkle` : run,
    animationDuration: twinkle
      ? `${String(layer.seconds)}s, ${String(TWINKLE_S)}s`
      : `${String(layer.seconds)}s`,
  };
}

/** Fixed for the page's life: computed once, not per render. */
const STRIPS = SIDES.map((side) => ({
  side,
  layers: EDGE_STRIP.layers.map((layer, index) => ({
    key: layer.salt,
    style: stripStyle(side, layer, index === 1),
  })),
}));

/** Whether the tab is hidden (nothing animates for nobody). */
function useTabHidden(): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const read = () => setHidden(document.visibilityState === "hidden");
    read();
    document.addEventListener("visibilitychange", read);
    return () => document.removeEventListener("visibilitychange", read);
  }, []);
  return hidden;
}

export function QEdgeFlow({
  state: forced,
}: {
  /** The /dev harness drives it directly; the app reads the session. */
  readonly state?: QApertureState | undefined;
} = {}) {
  const session = useQSessionOptional();
  const state = forced ?? session?.presence?.state ?? "IDLE";
  const flowing = edgeFlowing(state);
  const hidden = useTabHidden();

  return (
    <div
      aria-hidden="true"
      data-q-edge-flow={flowing ? "on" : "off"}
      data-q-edge-paused={hidden || !flowing ? "" : undefined}
      className="cq-q-edge-flow"
    >
      {STRIPS.map(({ side, layers }) => (
        <div key={side} className={`cq-q-edge-side cq-q-edge-${side}`}>
          {layers.map((layer) => (
            <span
              key={layer.key}
              className="cq-q-edge-run"
              style={layer.style}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
