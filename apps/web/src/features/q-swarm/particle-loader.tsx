"use client";

import { QSwarm } from "./q-swarm";

/**
 * The loading state, everywhere (founder direction 2026-09-29): Q's swarm
 * running its ring. Said once for assistive technology; the motion follows
 * the person's Q motion setting.
 */
export function ParticleLoader({
  size = 56,
  label = "Loading",
}: {
  readonly size?: number;
  readonly label?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-2"
      data-particle-loader
    >
      <QSwarm state="WORKING" pixels={size} />
      <span className="sr-only">{label}</span>
    </div>
  );
}
