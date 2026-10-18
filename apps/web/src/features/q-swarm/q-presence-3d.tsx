"use client";

import { useEffect, useState } from "react";

import type { QApertureState } from "../q-aperture/aperture-state";
import { QAperture } from "../q-aperture/q-aperture";
import { QSwarm } from "./q-swarm";

/**
 * Q's 3D presence by where it appears (ADR 0049), for surfaces that do not
 * already go through the Q Aperture -- the landing hero first. Every
 * variant is the same swarm (`QSwarm`): the state machine, the figures,
 * the cursor lean and the frame budget are the swarm's own.
 *
 *   <QPresence3D variant="hero" />          landing hero: rest, ring on scroll
 *   <QPresence3D variant="stage" state=… /> the Q page's size, with its label
 *   <QPresence3D variant="dock" state=… />  the dock's 40 px mark
 *   <QPresence3D variant="voice" state=… inputLevel=… outputLevel=… />
 *
 * The hero's box is sized by CSS before the first paint and the canvas
 * fills it after mount, so nothing around it moves (no layout shift).
 */

export type QPresence3DVariant = "hero" | "stage" | "dock" | "voice";

export type QPresence3DProps = {
  readonly variant: QPresence3DVariant;
  readonly state?: QApertureState | undefined;
  readonly inputLevel?: (() => number) | undefined;
  readonly outputLevel?: (() => number) | undefined;
  /** Hero only: gather into the working ring as the hero scrolls away. Default true. */
  readonly gatherOnScroll?: boolean | undefined;
  /** The state's word beneath the mark (non-hero variants). */
  readonly label?: string | true | undefined;
  readonly className?: string | undefined;
};

/** The hero's CSS box: 300 px on a phone, 520 px from 1024 px. */
const HERO_PHONE = 300;
const HERO_DESKTOP = 520;

/** Scrolled this share of a viewport, the hero's swarm gathers into its ring. */
export const HERO_GATHER_AT = 0.3;

/** The state the hero shows for a scroll position (pure, for the tests). */
export function heroState(
  rest: QApertureState,
  scrollY: number,
  viewportHeight: number,
  gather: boolean,
): QApertureState {
  if (!gather || viewportHeight <= 0) return rest;
  return scrollY / viewportHeight >= HERO_GATHER_AT ? "WORKING" : rest;
}

export function QPresence3D({
  variant,
  state = "IDLE",
  inputLevel,
  outputLevel,
  gatherOnScroll = true,
  label,
  className,
}: QPresence3DProps) {
  if (variant !== "hero") {
    const size =
      variant === "dock" ? "dock" : variant === "voice" ? 96 : "stage";
    return (
      <QAperture
        state={state}
        size={size}
        inputLevel={inputLevel}
        outputLevel={outputLevel}
        label={label}
        className={className}
      />
    );
  }
  return (
    <HeroPresence3D
      state={state}
      gather={gatherOnScroll}
      inputLevel={inputLevel}
      outputLevel={outputLevel}
      className={className}
    />
  );
}

function HeroPresence3D({
  state,
  gather,
  inputLevel,
  outputLevel,
  className,
}: {
  readonly state: QApertureState;
  readonly gather: boolean;
  readonly inputLevel?: (() => number) | undefined;
  readonly outputLevel?: (() => number) | undefined;
  readonly className?: string | undefined;
}) {
  const [pixels, setPixels] = useState<number | null>(null);
  const [shown, setShown] = useState<QApertureState>(state);

  useEffect(() => {
    const query =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(min-width: 1024px)")
        : null;
    const apply = () =>
      setPixels(query?.matches === true ? HERO_DESKTOP : HERO_PHONE);
    apply();
    query?.addEventListener("change", apply);
    return () => query?.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const update = () =>
      setShown(heroState(state, window.scrollY, window.innerHeight, gather));
    update();
    if (!gather) return;
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [state, gather]);

  return (
    <div
      role="img"
      aria-label="Q"
      className={[
        "relative mx-auto size-[300px] lg:size-[520px]",
        className ?? "",
      ].join(" ")}
      data-q-presence-3d="hero"
    >
      {pixels === null ? null : (
        <QSwarm
          state={shown}
          pixels={pixels}
          inputLevel={inputLevel}
          outputLevel={outputLevel}
        />
      )}
    </div>
  );
}
