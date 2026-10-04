"use client";

import { useState } from "react";

import { QAperture } from "../q-aperture/q-aperture";

/**
 * Q's presence on the landing (ADR 0045): the same particle swarm as the
 * Q page, at rest. It is Q, so it is the one thing that glows; it is not
 * used as a background or decoration anywhere else on the page. Reduced
 * motion and Q motion Off draw it still (the swarm's own rules).
 */
export function HeroPresence() {
  // Sized once, before the first paint (this island never renders on the
  // server): a resize after mount would shift the hero.
  const [size] = useState(() =>
    typeof window.matchMedia === "function" &&
    window.matchMedia("(min-width: 1024px)").matches
      ? 360
      : 240,
  );
  return (
    <div role="img" aria-label="Q" className="cq-landing-presence-mark">
      <QAperture state="IDLE" size={size} />
    </div>
  );
}
