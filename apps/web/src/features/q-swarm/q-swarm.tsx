"use client";

import { useEffect, useRef } from "react";

import { useQMotion } from "../q-aperture/q-motion";
import type { QApertureState } from "../q-aperture/aperture-state";
import { FINE_FIGURES } from "./presence-figures";
import { createPresenceMachine, faceAllowed } from "./presence-machine";
import { createPresenceSim, MAX_DT } from "./presence-dynamics";
import {
  budgetSettings,
  createBudget,
  scaledParticleCount,
  stepBudget,
  surfaceDpr,
} from "./presence-budget";
import { drawPresence, resolveColour, type Rgb } from "./presence-gl";
import { presenceUniforms, stepLean, type Lean } from "./presence-uniforms";
import { gesturesDetail, Q_GESTURES_EVENT } from "./q-gestures";

export { particleCount } from "./presence-budget";

/**
 * Q's presence as particles (founder direction 2026-09-29, reworked
 * 2026-10-01 -- PRESENCE spec; 3D since ADR 0049). What the particles form
 * follows real signals only: the surface's Q state, the microphone and
 * the speaker, and the gestures Q's answer asked for (`cq:q-gestures`).
 * How they move is one continuous, bounded dynamic (presence-dynamics.ts),
 * so a change of figure is a flow, never a snap.
 *
 * Drawn in 3D (presence-3d.ts, loaded on demand so it never weighs on
 * first paint): the swarm turned towards the cursor on a no-overshoot
 * spring, in perspective, nearer points larger and brighter. Where WebGL2
 * is missing, or the device asks for light work, the 2D swarm draws the
 * same particles flat.
 *
 * The free shapes (K1) carry Q's state: cloud, spiral, ring, wave, the
 * Q mark in knots of light, a ribbon on arrival. The human face (K2,
 * ADR 0051) shows only while Q speaks, and only where the caller says the
 * surface is the Q page's own presence (`face`) at 160 px or more; every
 * other surface has no face. Below 72 px only the cloud, the listening
 * lean, the spiral and the ring are drawn. Reduced motion draws each
 * figure still, in one turned pose. Off screen or in a hidden tab,
 * nothing runs.
 */

type Renderer = "pending" | "3d" | "2d";
type Draw3d = typeof import("./presence-3d").drawPresence3d;

export function QSwarm({
  state,
  pixels,
  inputLevel,
  outputLevel,
  face = false,
  travels = false,
}: {
  readonly state: QApertureState;
  readonly pixels: number;
  readonly inputLevel?: (() => number) | undefined;
  readonly outputLevel?: (() => number) | undefined;
  /** This surface is the Q page's own presence: it may show the face. */
  readonly face?: boolean | undefined;
  /** Q travels to this surface (dock, Q page): a ribbon on arrival. */
  readonly travels?: boolean | undefined;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const environment = useQMotion();
  const { motion, bloom } = environment;
  // Motion Off still deserves the 3D still; only a device asking for
  // light work (Save-Data, low memory, forced colours) keeps to 2D.
  const allow3d = environment.gpu || motion === "off";
  const showsFace = faceAllowed({ face, pixels });
  const live = useRef({
    state,
    inputLevel,
    outputLevel,
    showsFace,
    motion,
    bloom,
  });
  useEffect(() => {
    live.current = { state, inputLevel, outputLevel, showsFace, motion, bloom };
  }, [state, inputLevel, outputLevel, showsFace, motion, bloom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;
    const baseDpr = surfaceDpr(window.devicePixelRatio);
    let device = 0;
    const fit = (dprScale: number) => {
      // The canvas's CSS size never changes: a lower DPR is no layout shift.
      device = Math.max(1, Math.round(pixels * baseDpr * dprScale));
      canvas.width = device;
      canvas.height = device;
    };
    fit(1);
    const small = pixels < 72;
    const machine = createPresenceMachine({ arrive: travels });
    const sim = createPresenceSim({
      count: scaledParticleCount(pixels, navigator.hardwareConcurrency),
      initial: travels ? "RIBBON" : "CLOUD",
      seed: pixels * 7 + 3,
    });

    let renderer: Renderer = allow3d ? "pending" : "2d";
    let draw3d: Draw3d | null = null;
    let disposed = false;
    const setRenderer = (next: Renderer) => {
      renderer = next;
      canvas.dataset["qRenderer"] = next;
    };
    setRenderer(renderer);

    // Q's own colour: the accent, unless Q's patience is running out
    // (founder direction 2026-09-30): orange when impatient, red when
    // stern, set on the document as data-q-mood.
    let colour: Rgb = [0.42, 0.66, 1];
    let dark = true;
    const readColour = () => {
      const style = getComputedStyle(canvas);
      const mood = style.getPropertyValue("--cq-q-colour").trim();
      const value =
        mood.length > 0 ? mood : style.getPropertyValue("--cq-accent").trim();
      colour = resolveColour(value.length > 0 ? value : "#6aa8ff");
      dark = surfaceIsDark(canvas);
    };
    readColour();

    const eased = { input: 0, output: 0 };
    const levels = () => ({
      input: clampLevel(live.current.inputLevel?.() ?? 0),
      output: clampLevel(live.current.outputLevel?.() ?? 0),
    });
    let figure = "";
    const note = (next: string) => {
      if (next === figure) return;
      figure = next;
      canvas.dataset["qFigure"] = next;
    };

    // The cursor lean: where the pointer is, relative to Q, on a spring.
    const lean: Lean = { x: 0, y: 0, vx: 0, vy: 0 };
    let pointer: { x: number; y: number } | null = null;
    const leanTarget = () => {
      if (pointer === null) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const reach = Math.max(240, Math.max(window.innerWidth, 1) / 2);
      return {
        x: clampUnit((pointer.x - (rect.left + rect.width / 2)) / reach),
        y: clampUnit((pointer.y - (rect.top + rect.height / 2)) / reach),
      };
    };

    let budget = createBudget();
    let raf = 0;
    let onScreen = true;
    let last = 0;
    let clock = 0;
    let core = 1;
    let stepped = 0;
    const frame = (now: number) => {
      const began = performance.now();
      const current = live.current;
      const view = machine.step({
        state: current.state,
        small,
        now,
        face: current.showsFace,
      });
      const moving = current.motion === "full";
      const interval = last === 0 ? 0 : now - last;
      if (moving) {
        sim.setFigure(view.figure);
        // The swarm's own clock advances by the step it integrates, so a
        // slow device sees the same swarm, slower -- never one whose
        // particles trail a figure that runs on ahead in real time.
        const dt = Math.min(MAX_DT, last === 0 ? 1 / 60 : interval / 1000);
        last = now;
        clock += dt;
        stepped = dt;
        const raw = levels();
        sim.step(clock, dt, raw);
        const k = (was: number, next: number) =>
          1 - Math.exp(-Math.min(dt, 1 / 30) * (next > was ? 26 : 8));
        eased.input += (raw.input - eased.input) * k(eased.input, raw.input);
        eased.output +=
          (raw.output - eased.output) * k(eased.output, raw.output);
        const aim = leanTarget();
        stepLean(lean, aim.x, aim.y, dt);
      } else if (sim.figure() !== view.figure || figure === "") {
        // Reduced motion: each figure drawn still, no flow between.
        sim.settle(view.figure, clock, { input: 0, output: 0 });
      }
      note(view.figure);
      const target = presenceUniforms({
        state: current.state,
        figure: sim.figure(),
        input: moving ? eased.input : 0,
        output: moving ? eased.output : 0,
        leanX: lean.x,
        leanY: lean.y,
        t: clock,
        motion: current.motion,
        dim: view.dim,
        keep: budgetSettings(budget).keep,
      });
      // The white core follows the particles, not the figure's name: it
      // fades in as a glyph flows back into the cloud, never ahead of it.
      core = moving
        ? core + (target.core - core) * (1 - Math.exp(-stepped * 1.8))
        : target.core;
      const uniforms = { ...target, core };
      if (renderer === "3d" && draw3d !== null) {
        const drawn = draw3d(context, sim, {
          pixels: device,
          colour,
          dark,
          bloom: current.bloom,
          uniforms,
        });
        // A lost context: the 2D swarm from here on.
        if (!drawn) setRenderer("2d");
      }
      if (renderer === "2d") {
        drawPresence(context, sim, {
          pixels: device,
          colour,
          dim: view.dim,
          fine: FINE_FIGURES.has(sim.figure()),
        });
      }
      if (moving && renderer !== "pending") {
        const before = budget.level;
        budget = stepBudget(budget, interval, performance.now() - began);
        if (budget.level !== before) fit(budgetSettings(budget).dprScale);
      }
      if (moving && onScreen && !document.hidden) {
        raf = requestAnimationFrame(frame);
      } else {
        last = 0;
      }
    };
    const redraw = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    };

    if (renderer === "pending") {
      import("./presence-3d")
        .then((module) => {
          if (disposed) return;
          if (module.presence3dAvailable()) {
            draw3d = module.drawPresence3d;
            setRenderer("3d");
          } else {
            setRenderer("2d");
          }
          redraw();
        })
        .catch(() => {
          if (disposed) return;
          setRenderer("2d");
          redraw();
        });
    }

    const themeWatch = new MutationObserver(() => {
      readColour();
      redraw();
    });
    themeWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-q-mood"],
    });
    const onGestures = (event: Event) => {
      const detail = gesturesDetail(event);
      if (detail === null) return;
      machine.schedule(
        { gestures: detail.gestures, spoken: detail.spoken, text: detail.text },
        performance.now(),
      );
      redraw();
    };
    window.addEventListener(Q_GESTURES_EVENT, onGestures);
    const onPointer = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
    };
    const onPointerGone = (event: PointerEvent) => {
      // Touch has no hover: a lifted finger lets Q settle back.
      if (event.type === "pointerup" && event.pointerType === "mouse") return;
      if (event.type === "pointerout" && event.relatedTarget !== null) return;
      pointer = null;
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pointerdown", onPointer, { passive: true });
    window.addEventListener("pointerup", onPointerGone, { passive: true });
    window.addEventListener("pointercancel", onPointerGone, { passive: true });
    document.addEventListener("pointerout", onPointerGone, { passive: true });
    // Reduced motion still changes figure with the state and with the
    // gestures' timing: a quiet timer looks four times a second.
    const stillTimer = window.setInterval(() => {
      if (live.current.motion !== "full" && onScreen && !document.hidden) {
        redraw();
      }
    }, 250);
    const visibility = new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      if (onScreen) redraw();
    });
    visibility.observe(canvas);
    const onHidden = () => {
      if (!document.hidden) redraw();
    };
    document.addEventListener("visibilitychange", onHidden);
    canvas.addEventListener("cq:redraw", redraw);
    redraw();
    return () => {
      disposed = true;
      window.removeEventListener(Q_GESTURES_EVENT, onGestures);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("pointerup", onPointerGone);
      window.removeEventListener("pointercancel", onPointerGone);
      document.removeEventListener("pointerout", onPointerGone);
      canvas.removeEventListener("cq:redraw", redraw);
      cancelAnimationFrame(raf);
      window.clearInterval(stillTimer);
      themeWatch.disconnect();
      visibility.disconnect();
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [pixels, allow3d, travels]);

  // A state or motion change restarts a stopped loop (reduced motion, or
  // after a hidden tab).
  useEffect(() => {
    canvasRef.current?.dispatchEvent(new Event("cq:redraw"));
  }, [state, motion, bloom]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ width: pixels, height: pixels }}
      className="block"
      data-q-swarm={state}
    />
  );
}

function clampLevel(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

/**
 * Whether the surface behind Q is dark: the first opaque background up
 * the tree, by its luminance. A light surface gets no whitened core and a
 * fainter halo, so the swarm keeps its contrast there.
 */
export function surfaceIsDark(element: Element): boolean {
  let node: Element | null = element;
  while (node !== null) {
    const rgba = readRgba(getComputedStyle(node).backgroundColor);
    if (rgba !== null && rgba[3] > 0.5) {
      const [r, g, b] = rgba;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.45;
    }
    node = node.parentElement;
  }
  return document.documentElement.dataset["theme"] !== "light";
}

let probe: CanvasRenderingContext2D | null | undefined;

/** Any CSS colour as 0..1 RGBA, resolved by the browser; null if unreadable. */
function readRgba(colour: string): [number, number, number, number] | null {
  if (colour.length === 0 || colour === "transparent") return null;
  if (probe === undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    probe = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (probe === null) return null;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "rgba(0,0,0,0)";
  probe.fillStyle = colour;
  probe.fillRect(0, 0, 1, 1);
  const data = probe.getImageData(0, 0, 1, 1).data;
  return [
    (data[0] ?? 0) / 255,
    (data[1] ?? 0) / 255,
    (data[2] ?? 0) / 255,
    (data[3] ?? 0) / 255,
  ];
}
