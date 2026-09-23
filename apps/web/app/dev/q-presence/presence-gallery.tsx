"use client";

import { useCallback } from "react";

import {
  Q_PRESENCE_STATES,
  QPresence,
  type QPresenceState,
} from "@/features/q-presence";

/** A synthetic voice: syllables of energy, so the reactive states move. */
function useSyntheticLevel(rate: number): () => number {
  return useCallback(() => {
    const t = performance.now() / 1000;
    const syllable = Math.max(0, Math.sin(t * rate)) ** 2;
    const breath = 0.5 + 0.5 * Math.sin(t * 0.7);
    return Math.min(1, syllable * (0.4 + breath * 0.6));
  }, [rate]);
}

export function PresenceGallery() {
  const input = useSyntheticLevel(5.2);
  const output = useSyntheticLevel(3.8);
  return (
    <div className="flex flex-col gap-10" data-presence-gallery>
      <ul className="grid grid-cols-2 gap-8 sm:grid-cols-4 lg:grid-cols-7">
        {Q_PRESENCE_STATES.map((state: QPresenceState) => (
          <li key={state} className="flex flex-col items-center gap-2">
            <QPresence
              state={state}
              size="lg"
              inputLevel={input}
              outputLevel={output}
              label
            />
            <span className="cq-caption font-mono text-(--cq-text-tertiary)">
              {state}
            </span>
          </li>
        ))}
      </ul>
      <ul className="flex flex-wrap items-center gap-8">
        {Q_PRESENCE_STATES.map((state: QPresenceState) => (
          <li key={state} className="flex items-center gap-3">
            <QPresence
              state={state}
              size="sm"
              inputLevel={input}
              outputLevel={output}
            />
            <span className="cq-caption font-mono text-(--cq-text-tertiary)">
              {state}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
