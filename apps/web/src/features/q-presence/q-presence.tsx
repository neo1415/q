"use client";

import { useEffect, useRef } from "react";

import { cx } from "@capital-q/ui";

import {
  createFormation,
  stepFormation,
  type Formation,
} from "./particle-field";
import { Q_PRESENCE_LABELS, type QPresenceState } from "./presence-state";

/**
 * Q's presence: a field of particles in the shape of a Q, alive to what is
 * happening (doc 18 §33-§41, as amended by the prototype brief).
 *
 * A canvas rather than DOM nodes because a hundred-odd points at sixty
 * frames a second is exactly what a canvas is for and exactly what layout
 * is not. The loop runs only while the element is on screen and the tab
 * is visible, and not at all under reduced motion, where the formation is
 * drawn once per state and left still.
 *
 * Colour is read from the `--cq-*` tokens on the element itself, so the
 * presence follows the theme and never carries a hex of its own. Quiet
 * states use the secondary text tone; active states the accent; an error
 * dims rather than reddens — the label says what is wrong.
 *
 * The visual never carries meaning alone: a caller either renders the
 * label here or beside it, and the wrapper names the state for tests.
 */

export const Q_PRESENCE_SIZES = { sm: 28, md: 48, lg: 160, xl: 240 } as const;
export type QPresenceSize = keyof typeof Q_PRESENCE_SIZES | number;

export type QPresenceProps = {
  readonly state: QPresenceState;
  readonly size?: QPresenceSize | undefined;
  /** 0..1 microphone energy, sampled each frame while listening. */
  readonly inputLevel?: (() => number) | undefined;
  /** 0..1 speaker energy, sampled each frame while Q speaks. */
  readonly outputLevel?: (() => number) | undefined;
  /** Render the state's word beneath (or a caller's own). */
  readonly label?: string | true | undefined;
  /** A second line under the label: an approved stage, a context. */
  readonly detail?: string | undefined;
  readonly className?: string | undefined;
};

/** Tokens the field paints with, in the order the tone blends them. */
const TONES = [
  "--cq-text-secondary",
  "--cq-accent",
  "--cq-text-tertiary",
] as const;

function pixelSize(size: QPresenceSize): number {
  return typeof size === "number" ? size : Q_PRESENCE_SIZES[size];
}

function particleCount(px: number): number {
  return Math.max(24, Math.min(150, Math.round(px * 0.62)));
}

/** Which tone a state paints in: 0 quiet, 1 accent, 2 dimmed. */
function toneFor(state: QPresenceState): number {
  if (state === "IDLE") return 0;
  if (state === "ERROR") return 2;
  return 1;
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function QPresence({
  state,
  size = "lg",
  inputLevel,
  outputLevel,
  label,
  detail,
  className,
}: QPresenceProps) {
  const px = pixelSize(size);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const formationRef = useRef<Formation | null>(null);
  const stateRef = useRef(state);
  const stateAtRef = useRef(0);
  const levelsRef = useRef({ input: inputLevel, output: outputLevel });
  useEffect(() => {
    levelsRef.current = { input: inputLevel, output: outputLevel };
  }, [inputLevel, outputLevel]);

  // The state is read by the loop, not captured by it, so a change never
  // restarts the field: particles ease from where they are.
  useEffect(() => {
    if (stateRef.current !== state) {
      stateRef.current = state;
      stateAtRef.current = performance.now();
    }
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (canvas === null || host === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;

    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(px * dpr);
    canvas.height = Math.round(px * dpr);
    const radius = px * 0.36;
    const dot = Math.max(0.9, Math.min(2.4, px / 95));
    const formation = createFormation(particleCount(px), radius);
    formationRef.current = formation;

    // Colours come from the tokens on this element, at mount and again
    // whenever the theme attribute changes.
    let colours: readonly string[] = [];
    const readColours = () => {
      const style = getComputedStyle(host);
      colours = TONES.map((token) => {
        const value = style.getPropertyValue(token).trim();
        return value.length > 0 ? value : style.color;
      });
    };
    readColours();
    const themeWatch = new MutationObserver(readColours);
    themeWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });

    const started = performance.now();
    let last = started;
    let frame = 0;
    let visible = true;
    let onScreen = true;
    let running = false;
    let still = reducedMotion();
    // Smoothed levels and the tone blend, so a state change is a crossfade
    // rather than a cut.
    let input = 0;
    let output = 0;
    let tone = toneFor(stateRef.current);

    const draw = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.scale(dpr, dpr);
      context.translate(px / 2, px / 2);
      const quiet = colours[0] ?? "";
      const accent = colours[1] ?? "";
      const dim = colours[2] ?? "";
      // tone: 0 → quiet, 1 → accent, 2 → dim. Blend by drawing the two
      // neighbouring tones with complementary alpha.
      const a = tone <= 1 ? tone : 2 - tone;
      const lower = tone <= 1 ? quiet : dim;
      const upper = accent;
      for (const particle of formation.particles) {
        const r = dot * (0.75 + particle.seed * 0.5);
        if (a < 1 && lower.length > 0) {
          context.globalAlpha = particle.alpha * (1 - a);
          context.fillStyle = lower;
          context.beginPath();
          context.arc(particle.x, particle.y, r, 0, Math.PI * 2);
          context.fill();
        }
        if (a > 0 && upper.length > 0) {
          context.globalAlpha = particle.alpha * a;
          context.fillStyle = upper;
          context.beginPath();
          context.arc(particle.x, particle.y, r, 0, Math.PI * 2);
          context.fill();
        }
      }
      context.restore();
    };

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const current = stateRef.current;
      const levels = levelsRef.current;
      const inTarget =
        current === "LISTENING" && levels.input !== undefined
          ? Math.min(1, Math.max(0, levels.input()))
          : 0;
      const outTarget =
        current === "SPEAKING" && levels.output !== undefined
          ? Math.min(1, Math.max(0, levels.output()))
          : 0;
      // Fast attack, slow release: a word lands at once and lets go gently.
      input += (inTarget - input) * (inTarget > input ? 0.5 : 0.12);
      output += (outTarget - output) * (outTarget > output ? 0.5 : 0.12);
      tone += (toneFor(current) - tone) * 0.08;
      stepFormation(formation, {
        state: current,
        time: (now - started) / 1000,
        dt,
        sinceState: (now - stateAtRef.current) / 1000,
        input,
        output,
        still: false,
      });
      draw();
    };

    const loop = (now: number) => {
      if (!running) return;
      step(now);
      frame = window.requestAnimationFrame(loop);
    };

    /** Under reduced motion: settle the formation for this state, once. */
    const drawStill = () => {
      tone = toneFor(stateRef.current);
      stepFormation(formation, {
        state: stateRef.current,
        time: 0,
        dt: 1,
        sinceState: 1,
        input: 0,
        output: 0,
        still: true,
      });
      draw();
    };

    const reconcile = () => {
      const shouldRun = visible && onScreen && !still;
      if (shouldRun && !running) {
        running = true;
        last = performance.now();
        frame = window.requestAnimationFrame(loop);
      } else if (!shouldRun && running) {
        running = false;
        window.cancelAnimationFrame(frame);
      }
      if (still) drawStill();
    };

    // First frame: settle the field so it is never seen assembling from
    // the centre, then run (or leave still).
    stepFormation(formation, {
      state: stateRef.current,
      time: 0,
      dt: 1,
      sinceState: 1,
      input: 0,
      output: 0,
      still: true,
    });
    tone = toneFor(stateRef.current);
    draw();

    const onVisibility = () => {
      visible = document.visibilityState !== "hidden";
      reconcile();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const intersection = new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      reconcile();
    });
    intersection.observe(host);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => {
      still = motion.matches;
      reconcile();
    };
    motion.addEventListener("change", onMotion);
    // A state change under reduced motion is a new still frame.
    const stillWatch = new MutationObserver(() => {
      if (still) drawStill();
    });
    stillWatch.observe(host, {
      attributes: true,
      attributeFilter: ["data-q-presence"],
    });
    reconcile();

    return () => {
      running = false;
      window.cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisibility);
      motion.removeEventListener("change", onMotion);
      intersection.disconnect();
      themeWatch.disconnect();
      stillWatch.disconnect();
      formationRef.current = null;
    };
  }, [px]);

  const text = label === true ? Q_PRESENCE_LABELS[state] : label;

  return (
    <div
      ref={hostRef}
      className={cx(
        "inline-flex flex-col items-center gap-3 text-(--cq-text-secondary)",
        className,
      )}
      data-q-presence={state}
      data-q-presence-size={px}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{ width: px, height: px }}
        className="block select-none"
      />
      {text !== undefined || detail !== undefined ? (
        <div
          className="flex flex-col items-center gap-0.5 text-center"
          role="status"
        >
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
