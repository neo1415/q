"use client";

import { QAperture } from "../q-aperture/q-aperture";

/**
 * Q's presence on the landing (ADR 0045): the same particle swarm as the
 * Q page, at rest. It is Q, so it is the one thing that glows; it is not
 * used as a background or decoration anywhere else on the page. Reduced
 * motion and Q motion Off draw it still (the swarm's own rules).
 */
export function HeroPresence() {
  return (
    <div role="img" aria-label="Q" className="cq-landing-presence-mark">
      <QAperture state="IDLE" size="stage" />
    </div>
  );
}
