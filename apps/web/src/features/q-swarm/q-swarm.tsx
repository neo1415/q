"use client";

import { useEffect, useRef, useState } from "react";

import { useQMotion } from "../q-aperture/q-motion";
import type { QApertureState } from "../q-aperture/aperture-state";
import { faceAllowed } from "./presence-machine";
import { surfaceDpr } from "./presence-budget";
import { resolveColour, type Rgb } from "./presence-gl";
import { startPresenceLoop, type PresenceInputs } from "./presence-loop";
import type {
  PresenceWorkerMessage,
  PresenceWorkerNote,
} from "./presence-worker";

export { particleCount } from "./presence-budget";

/**
 * Q's presence as particles (founder direction 2026-09-29, reworked
 * 2026-10-01 -- PRESENCE spec; 3D since ADR 0049). What the particles form
 * follows Q's state only, through one fixed mapping (presenceFor in
 * presence-machine.ts; P11): a shape changes when the state does, never
 * on a timer or a roll of the dice. The microphone and the speaker move
 * the particles within a shape, never choose one.
 * How they move is one continuous, bounded dynamic (presence-dynamics.ts),
 * so a change of figure is a flow, never a snap.
 *
 * Drawn in 3D (presence-3d.ts, loaded on demand so it never weighs on
 * first paint): the swarm turned towards the cursor on a no-overshoot
 * spring, in perspective, nearer points larger and brighter. Where WebGL2
 * is missing, or the device asks for light work, the 2D swarm draws the
 * same particles flat.
 *
 * The free shapes (K1) carry Q's state: cloud, spiral, ring, wave, and
 * the Q mark in knots of light while answer cards are up. The human face (K2,
 * ADR 0051) shows only while Q speaks, and only where the caller says the
 * surface is the Q page's own presence (`face`) at 160 px or more; every
 * other surface has no face. Below 72 px only the cloud, the listening
 * lean, the spiral and the ring are drawn. Reduced motion draws each
 * figure still, in one turned pose. Off screen or in a hidden tab,
 * nothing runs.
 */

/** What the component says to the loop, wherever the loop runs. */
type PresenceChannel = {
  readonly set: (inputs: PresenceInputs) => void;
  readonly setColour: (colour: Rgb, dark: boolean) => void;
  readonly visible: (onScreen: boolean, hidden: boolean) => void;
  readonly levels: (input: number, output: number) => void;
  readonly lean: (x: number, y: number) => void;
  readonly dispose: () => void;
};

/** W7: can this browser draw the presence in a worker? */
export function presenceOffThreadAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof Worker === "function" &&
    typeof OffscreenCanvas === "function" &&
    typeof HTMLCanvasElement.prototype.transferControlToOffscreen ===
      "function"
  );
}

function presenceWorker(): Worker | null {
  try {
    return new Worker(new URL("./presence-worker.ts", import.meta.url), {
      type: "module",
      name: "q-presence",
    });
  } catch {
    return null;
  }
}

export function QSwarm({
  state,
  pixels,
  inputLevel,
  outputLevel,
  face = false,
  showing = false,
}: {
  readonly state: QApertureState;
  readonly pixels: number;
  readonly inputLevel?: (() => number) | undefined;
  readonly outputLevel?: (() => number) | undefined;
  /** This surface is the Q page's own presence: it may show the face. */
  readonly face?: boolean | undefined;
  /** Answer cards are on screen beside this presence: the Q mark. */
  readonly showing?: boolean | undefined;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const environment = useQMotion();
  const { motion, bloom } = environment;
  // Motion Off still deserves the 3D still; only a device asking for
  // light work (Save-Data, low memory, forced colours) keeps to 2D.
  const allow3d = environment.gpu || motion === "off";
  const showsFace = faceAllowed({ face, pixels });
  // W7: the worker is tried once per surface; a failed worker leaves a
  // fresh canvas drawn on the main thread (`key` below).
  const [offThread, setOffThread] = useState(presenceOffThreadAvailable);
  const live = useRef({
    state,
    inputLevel,
    outputLevel,
    showsFace,
    showing,
    motion,
    bloom,
  });
  useEffect(() => {
    live.current = {
      state,
      inputLevel,
      outputLevel,
      showsFace,
      showing,
      motion,
      bloom,
    };
  }, [state, inputLevel, outputLevel, showsFace, showing, motion, bloom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    // Q's own colour: the accent, unless Q's patience is running out
    // (founder direction 2026-09-30): orange when impatient, red when
    // stern, set on the document as data-q-mood.
    const readColour = (): { colour: Rgb; dark: boolean } => {
      const style = getComputedStyle(canvas);
      const mood = style.getPropertyValue("--cq-q-colour").trim();
      const value =
        mood.length > 0 ? mood : style.getPropertyValue("--cq-accent").trim();
      return {
        colour: resolveColour(value.length > 0 ? value : "#6aa8ff"),
        dark: surfaceIsDark(canvas),
      };
    };
    const inputs = (): PresenceInputs => ({
      state: live.current.state,
      showsFace: live.current.showsFace,
      showing: live.current.showing,
      motion: live.current.motion,
      bloom: live.current.bloom,
    });

    // The cursor lean: where the pointer is, relative to Q.
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
    const levels = () => ({
      input: clampLevel(live.current.inputLevel?.() ?? 0),
      output: clampLevel(live.current.outputLevel?.() ?? 0),
    });
    const note = (key: "qFigure" | "qRenderer", value: string) => {
      canvas.dataset[key] = value;
    };
    const start = {
      pixels,
      dpr: surfaceDpr(window.devicePixelRatio),
      cores: navigator.hardwareConcurrency,
      allow3d,
      inputs: inputs(),
      ...readColour(),
    };

    // W7: off the main thread where the browser can hand a canvas to a
    // worker; here otherwise (and in tests). Once handed over, the canvas
    // belongs to the worker; if the worker fails, a fresh canvas is drawn
    // here instead.
    const worker = offThread ? presenceWorker() : null;
    let port: PresenceChannel;
    if (worker !== null) {
      const offscreen = canvas.transferControlToOffscreen();
      canvas.dataset["qWorker"] = "1";
      worker.onmessage = (event: MessageEvent<PresenceWorkerNote>) => {
        if (event.data.type === "note") note(event.data.key, event.data.value);
      };
      worker.onerror = () => {
        worker.terminate();
        setOffThread(false);
      };
      const post = (message: PresenceWorkerMessage) => {
        worker.postMessage(message);
      };
      post({ type: "start", canvas: offscreen, ...start });
      port = {
        set: (next) => post({ type: "inputs", inputs: next }),
        setColour: (colour, dark) => post({ type: "colour", colour, dark }),
        visible: (onScreen, hidden) =>
          post({ type: "visible", onScreen, hidden }),
        levels: (input, output) => post({ type: "levels", input, output }),
        lean: (x, y) => post({ type: "lean", x, y }),
        dispose: () => {
          post({ type: "stop" });
          worker.terminate();
        },
      };
    } else {
      const loop = startPresenceLoop({
        canvas,
        ...start,
        levels,
        leanTarget,
        hidden: () => document.hidden,
        note,
        load3d: () => import("./presence-3d"),
        requestFrame: (callback) => requestAnimationFrame(callback),
        cancelFrame: (handle) => cancelAnimationFrame(handle),
        now: () => performance.now(),
      });
      if (loop === null) return;
      port = {
        set: loop.set,
        setColour: loop.setColour,
        visible: (onScreen, hidden) => loop.setOnScreen(onScreen && !hidden),
        levels: () => undefined,
        lean: () => undefined,
        dispose: loop.dispose,
      };
    }

    // In the worker the levels and the lean are sent, at most once a
    // frame, and only while there is something to send.
    let relay = 0;
    let onScreen = true;
    const relayFrame = () => {
      relay = 0;
      if (worker === null || !onScreen || document.hidden) return;
      const current = live.current;
      const voiced =
        current.inputLevel !== undefined || current.outputLevel !== undefined;
      if (voiced) {
        const raw = levels();
        port.levels(raw.input, raw.output);
      }
      if (voiced && current.motion === "full") {
        relay = requestAnimationFrame(relayFrame);
      }
    };
    const relayLean = () => {
      if (worker === null) return;
      const aim = leanTarget();
      port.lean(aim.x, aim.y);
    };
    let leanFrame = 0;
    const onPointer = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      if (worker !== null && leanFrame === 0) {
        leanFrame = requestAnimationFrame(() => {
          leanFrame = 0;
          relayLean();
        });
      }
    };
    const onPointerGone = (event: PointerEvent) => {
      // Touch has no hover: a lifted finger lets Q settle back.
      if (event.type === "pointerup" && event.pointerType === "mouse") return;
      if (event.type === "pointerout" && event.relatedTarget !== null) return;
      pointer = null;
      relayLean();
    };
    const redraw = () => {
      port.set(inputs());
      if (worker !== null && relay === 0) {
        relay = requestAnimationFrame(relayFrame);
      }
    };

    const themeWatch = new MutationObserver(() => {
      const next = readColour();
      port.setColour(next.colour, next.dark);
    });
    themeWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-q-mood"],
    });
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pointerdown", onPointer, { passive: true });
    window.addEventListener("pointerup", onPointerGone, { passive: true });
    window.addEventListener("pointercancel", onPointerGone, { passive: true });
    document.addEventListener("pointerout", onPointerGone, { passive: true });
    const visibility = new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      port.visible(onScreen, document.hidden);
      if (onScreen) redraw();
    });
    visibility.observe(canvas);
    const onHidden = () => {
      port.visible(onScreen, document.hidden);
      if (!document.hidden) redraw();
    };
    document.addEventListener("visibilitychange", onHidden);
    canvas.addEventListener("cq:redraw", redraw);
    return () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("pointerup", onPointerGone);
      window.removeEventListener("pointercancel", onPointerGone);
      document.removeEventListener("pointerout", onPointerGone);
      canvas.removeEventListener("cq:redraw", redraw);
      cancelAnimationFrame(relay);
      cancelAnimationFrame(leanFrame);
      themeWatch.disconnect();
      visibility.disconnect();
      document.removeEventListener("visibilitychange", onHidden);
      port.dispose();
    };
  }, [pixels, allow3d, offThread]);

  // A state, face, cards or motion change restarts a stopped loop (reduced
  // motion, or after a hidden tab): with no timers, this is the only way a
  // still presence changes shape, and it is exactly when it should.
  useEffect(() => {
    canvasRef.current?.dispatchEvent(new Event("cq:redraw"));
  }, [state, showsFace, showing, motion, bloom]);

  return (
    <canvas
      key={offThread ? "worker" : "page"}
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
