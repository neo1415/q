"use client";

import { useEffect, useId, useRef, useState } from "react";

import { cx } from "@capital-q/ui";

import { ApertureAnimator } from "./aperture-frame";
import { Q_APERTURE_LABELS, type QApertureState } from "./aperture-state";
import { ApertureSvg } from "./aperture-svg";
import { useQMotion } from "./q-motion";

/**
 * The Q Aperture: Q's one presence (ADR 0017 F2; spec §5). Q's ring and
 * tail as an aperture of light — it opens to listen, focuses to think,
 * shows progress while working, projects light from the tail while
 * speaking, and dims to an ember when paused. Never a face, a brain or an
 * orb, and the only thing in the product that glows.
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
  readonly className?: string | undefined;
};

/** 160 on a phone, 224 from the desktop breakpoint; read after mount. */
export function useStageApertureSize(): 160 | 224 {
  const [size, setSize] = useState<160 | 224>(160);
  useEffect(() => {
    // A host with no media queries (a test DOM) keeps the phone size.
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(min-width: 1024px)");
    const apply = () => setSize(query.matches ? 224 : 160);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return size;
}

type Renderer = typeof import("./renderer");
let rendererModule: Promise<Renderer> | null = null;

/** The shader loads once, when the browser is idle after first paint. */
function loadRenderer(): Promise<Renderer> {
  rendererModule ??= new Promise<void>((resolve) => {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(() => resolve(), { timeout: 2000 });
    } else {
      setTimeout(resolve, 200);
    }
  }).then(() => import("./renderer"));
  return rendererModule;
}

export function QAperture({
  state,
  size = "panel",
  inputLevel,
  outputLevel,
  progress = null,
  label,
  detail,
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
  const bloomId = useId().replace(/:/g, "");
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gpu, setGpu] = useState(false);

  // What the draw loop reads each frame. Kept in a ref so a new level
  // function or state never restarts the renderer, only retargets it.
  const live = useRef({
    state,
    progress,
    inputLevel,
    outputLevel,
    motion: environment.motion,
    bloom: environment.bloom,
  });
  const invalidateRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    live.current = {
      state,
      progress,
      inputLevel,
      outputLevel,
      motion: environment.motion,
      bloom: environment.bloom,
    };
    invalidateRef.current?.();
  }, [
    state,
    progress,
    inputLevel,
    outputLevel,
    environment.motion,
    environment.bloom,
  ]);

  const wantGpu = environment.gpu;
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!wantGpu || host === null || canvas === null) return;
    let cancelled = false;
    let teardown: (() => void) | null = null;

    void loadRenderer().then((renderer) => {
      if (cancelled || !renderer.canRender()) return;
      const target = canvas.getContext("2d");
      if (target === null) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const pixels = Math.round(px * dpr);
      canvas.width = pixels;
      canvas.height = pixels;
      const animator = new ApertureAnimator(
        live.current.state,
        performance.now(),
      );
      let colours = renderer.readColours(host);
      let onScreen = true;
      let shown = false;
      const slot = {
        render: (now: number) => {
          if (!onScreen) return false;
          const current = live.current;
          animator.setState(current.state, now);
          const { params, live: moving } = animator.frame(now, {
            input: current.inputLevel,
            output: current.outputLevel,
            progress: current.progress,
            motion: current.motion,
            bloom: current.bloom,
          });
          renderer.drawAperture(target, pixels, params, colours);
          if (!shown) {
            shown = true;
            setGpu(true);
          }
          return moving;
        },
        onLost: () => {
          setGpu(false);
        },
      };
      const unregister = renderer.register(slot);
      const invalidate = () => renderer.invalidate(slot);
      invalidateRef.current = invalidate;

      // The theme, the stage around it, or the device's scheme changing
      // changes the light's colours; one redraw, no loop.
      const recolour = () => {
        colours = renderer.readColours(host);
        invalidate();
      };
      const themeWatch = new MutationObserver(recolour);
      themeWatch.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
      const scheme = window.matchMedia("(prefers-color-scheme: dark)");
      scheme.addEventListener("change", recolour);
      const visibility = new IntersectionObserver((entries) => {
        onScreen = entries.some((entry) => entry.isIntersecting);
        if (onScreen) invalidate();
      });
      visibility.observe(host);
      invalidate();

      teardown = () => {
        unregister();
        themeWatch.disconnect();
        scheme.removeEventListener("change", recolour);
        visibility.disconnect();
        invalidateRef.current = null;
      };
    });

    return () => {
      cancelled = true;
      teardown?.();
      setGpu(false);
    };
  }, [wantGpu, px]);

  const text = label === true ? Q_APERTURE_LABELS[state] : label;

  return (
    <div
      ref={hostRef}
      className={cx("cq-aperture", className)}
      data-q-aperture={state}
      data-q-aperture-size={px}
      data-renderer={gpu && wantGpu ? "webgl" : "svg"}
      data-motion={environment.motion}
      data-bloom={environment.bloom ? undefined : "off"}
    >
      <div className="cq-aperture-mark" style={{ width: px, height: px }}>
        <ApertureSvg
          state={state}
          pixels={px}
          progress={progress}
          bloomId={bloomId}
        />
        <canvas ref={canvasRef} aria-hidden="true" />
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
