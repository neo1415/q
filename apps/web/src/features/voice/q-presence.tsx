"use client";

import { useEffect, useRef } from "react";

import { QMark } from "@capital-q/ui/q-mark";

import { VOICE_STATE_LABELS, type VoiceState } from "./session";

/**
 * Q's presence while speaking and listening (CQ-Q-VOICE-001 D §45-§47;
 * doc 18 §33).
 *
 * Not an orb, not a sparkle, not a HUD: the Q mark, in its own frame, with
 * a soft ring that breathes with what the microphone hears and what Q
 * says. Amplitude comes from the session's own level readings and moves
 * the ring's scale a few percent — enough to feel alive, never a light
 * show. Under reduced motion the ring is still and only the label moves.
 * The label is the meaning; the visual never carries it alone.
 */

export type QPresenceProps = {
  readonly state: VoiceState;
  /** Public stage text while Q works ("Searching public sources"). */
  readonly detail?: string | undefined;
  readonly inputLevel: () => number;
  readonly outputLevel: () => number;
  readonly className?: string | undefined;
};

const RING_MIN = 1;
const RING_MAX = 1.18;

export function QPresence({
  state,
  detail,
  inputLevel,
  outputLevel,
  className,
}: QPresenceProps) {
  const ringRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const ring = ringRef.current;
    if (ring === null) {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      ring.style.transform = "scale(1)";
      return;
    }
    let frame = 0;
    let current = RING_MIN;
    const tick = () => {
      const level =
        state === "Q_SPEAKING"
          ? outputLevel()
          : state === "USER_SPEAKING" || state === "LISTENING"
            ? inputLevel()
            : 0;
      const target =
        RING_MIN + (RING_MAX - RING_MIN) * Math.min(1, level * 1.6);
      // Ease toward the target so a burst of sound is a swell, not a jump.
      current += (target - current) * 0.2;
      ring.style.transform = `scale(${current.toFixed(3)})`;
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [state, inputLevel, outputLevel]);

  const markState =
    state === "ERROR"
      ? "ERROR"
      : state === "THINKING"
        ? "WORKING"
        : state === "IDLE"
          ? "IDLE"
          : "LISTENING";

  return (
    <div
      className={["flex flex-col items-center gap-3", className]
        .filter(Boolean)
        .join(" ")}
      data-q-presence={state}
    >
      <span className="relative inline-flex h-24 w-24 items-center justify-center">
        <span
          ref={ringRef}
          aria-hidden="true"
          data-q-presence-ring
          className={[
            "absolute inset-0 rounded-full border transition-colors duration-(--cq-motion-slow)",
            state === "Q_SPEAKING"
              ? "border-(--cq-accent) bg-(--cq-accent-soft)"
              : state === "THINKING"
                ? "cq-presence-thinking border-(--cq-border) bg-(--cq-surface-sunken)"
                : state === "ERROR"
                  ? "border-(--cq-danger-soft) bg-(--cq-surface-sunken)"
                  : "border-(--cq-border-subtle) bg-(--cq-surface-sunken)",
          ].join(" ")}
        />
        <QMark size="lg" state={markState} className="relative" />
      </span>
      <div className="flex flex-col items-center gap-0.5" role="status">
        <span className="cq-label text-(--cq-text-primary)">
          {VOICE_STATE_LABELS[state]}
        </span>
        {detail !== undefined ? (
          <span className="cq-caption text-(--cq-text-secondary)">
            {detail}
          </span>
        ) : null}
      </div>
    </div>
  );
}
