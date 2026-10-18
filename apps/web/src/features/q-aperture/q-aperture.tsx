"use client";

import { useEffect, useRef, useState } from "react";

import { cx } from "@capital-q/ui";

import { Q_APERTURE_LABELS, type QApertureState } from "./aperture-state";
import { useQMotion } from "./q-motion";
import { QSwarm } from "../q-swarm/q-swarm";

/**
 * The Q Aperture: Q's one presence (ADR 0017 F2; spec §5). Q's ring and
 * tail as an aperture of light — it opens to listen, focuses to think,
 * shows progress while working, projects light from the tail while
 * speaking, and dims to an ember when paused. Never a brain or an orb,
 * and the only thing in the product that glows. Never a human face; the
 * Q page's own presence is marked `stage` (the Q moment shows there).
 *
 * The API is the state and the real signals behind it; nothing here runs
 * a decorative loop:
 *
 *   <QAperture state={apertureStateFor(signals)} size="stage"
 *     inputLevel={voice.inputLevel} outputLevel={voice.outputLevel}
 *     label />
 *
 * Rendering: the SVG ring paints in the server HTML (so it is there at
 * first paint and never the LCP element); the shared WebGL2 renderer loads
 * when the browser is idle and takes over with the same composition. At
 * rest it draws once and schedules nothing.
 *
 * Meaning never rests on the light: the label (or the caller's own words
 * beside it) says what Q is doing, and it sits outside the mark's box so
 * no text is ever drawn on the glow.
 */

export const Q_APERTURE_SIZES = {
  /** Inline in the chrome: a button's icon. */
  chrome: 28,
  /** The floating dock's aperture, inside its 44 px target. */
  dock: 40,
  /** A panel or sheet header. */
  panel: 48,
} as const;

/** Named sizes, "stage" (160 on a phone, 224 from desktop), or pixels. */
export type QApertureSize = keyof typeof Q_APERTURE_SIZES | "stage" | number;

export type QApertureProps = {
  readonly state: QApertureState;
  readonly size?: QApertureSize | undefined;
  /** 0..1 microphone energy, sampled per frame while listening. */
  readonly inputLevel?: (() => number) | undefined;
  /** 0..1 speaker energy, sampled per frame while Q speaks. */
  readonly outputLevel?: (() => number) | undefined;
  /** 0..1 of a durable task, when it reports progress (WORKING). */
  readonly progress?: number | null | undefined;
  /** The state's word beneath the mark (`true`), or the caller's own. */
  readonly label?: string | true | undefined;
  /** A second line: an approved stage, a subject. */
  readonly detail?: string | undefined;
  /** The Q page's own presence (the stage): the Q moment shows here. */
  readonly stage?: boolean | undefined;
  /** Answer cards are on screen beside this presence (P11: the Q mark). */
  readonly showing?: boolean | undefined;
  readonly className?: string | undefined;
};

/**
 * 240 on a phone, 360 from the desktop breakpoint; read after mount
 * (founder live 2026-09-29: the presence should be bigger).
 */
export function useStageApertureSize(): 240 | 360 {
  const [size, setSize] = useState<240 | 360>(240);
  useEffect(() => {
    // A host with no media queries (a test DOM) keeps the phone size.
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(min-width: 1024px)");
    const apply = () => setSize(query.matches ? 360 : 240);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return size;
}

export function QAperture({
  state,
  size = "panel",
  inputLevel,
  outputLevel,
  // A durable task's progress is said by its own surface; the swarm runs its ring.
  progress: _progress = null,
  label,
  detail,
  stage: onStage = false,
  showing = false,
  className,
}: QApertureProps) {
  const stage = useStageApertureSize();
  const px =
    size === "stage"
      ? stage
      : typeof size === "number"
        ? size
        : Q_APERTURE_SIZES[size];
  const environment = useQMotion();
  const hostRef = useRef<HTMLDivElement>(null);

  const text = label === true ? Q_APERTURE_LABELS[state] : label;

  return (
    <div
      ref={hostRef}
      className={cx("cq-aperture", className)}
      data-q-aperture={state}
      data-q-aperture-size={px}
      data-renderer="swarm"
      data-motion={environment.motion}
      data-bloom={environment.bloom ? undefined : "off"}
    >
      <div className="cq-aperture-mark" style={{ width: px, height: px }}>
        {/* Q as a particle swarm (founder direction 2026-09-29). */}
        <QSwarm
          state={state}
          pixels={px}
          inputLevel={inputLevel}
          outputLevel={outputLevel}
          stage={onStage}
          showing={showing}
        />
      </div>
      {text !== undefined || detail !== undefined ? (
        <div className="cq-aperture-label" role="status">
          {text !== undefined ? (
            <span className="cq-label text-(--cq-text-primary)">{text}</span>
          ) : null}
          {detail !== undefined ? (
            <span className="cq-caption text-(--cq-text-secondary)">
              {detail}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
