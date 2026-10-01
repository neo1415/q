"use client";

import { useEffect, useRef } from "react";

import { useQMotion } from "../q-aperture/q-motion";
import type { QApertureState } from "../q-aperture/aperture-state";
import { useVoicePreference } from "../voice/voice-preference";
import { createPresenceMachine } from "./presence-machine";
import { createPresenceSim } from "./presence-dynamics";
import { drawPresence, resolveColour, type Rgb } from "./presence-gl";
import { gesturesDetail, Q_GESTURES_EVENT } from "./q-gestures";

/**
 * Q's presence as particles (founder direction 2026-09-29, reworked
 * 2026-10-01 -- PRESENCE spec). What the particles form follows real
 * signals only: the surface's Q state, the microphone and the speaker,
 * and the gestures Q's answer asked for (`cq:q-gestures`). How they move
 * is one continuous, bounded dynamic (presence-dynamics.ts), so a change
 * of figure is a flow, never a snap.
 *
 * The face follows the chosen voice: female voice, female face. Below
 * 72 px a face cannot be read, so small sizes keep to the cloud, the
 * listening lean and the orbit. Reduced motion draws each figure still.
 * Off screen or in a hidden tab, nothing runs.
 */

/** Particles per surface size: enough to read a face, cheap on a phone. */
export function particleCount(pixels: number): number {
  return pixels >= 300 ? 1100 : pixels >= 150 ? 800 : pixels >= 72 ? 420 : 160;
}

export function QSwarm({
  state,
  pixels,
  inputLevel,
  outputLevel,
}: {
  readonly state: QApertureState;
  readonly pixels: number;
  readonly inputLevel?: (() => number) | undefined;
  readonly outputLevel?: (() => number) | undefined;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const face = useVoicePreference();
  const { motion } = useQMotion();
  const live = useRef({ state, inputLevel, outputLevel, face, motion });
  useEffect(() => {
    live.current = { state, inputLevel, outputLevel, face, motion };
  }, [state, inputLevel, outputLevel, face, motion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const device = Math.round(pixels * dpr);
    canvas.width = device;
    canvas.height = device;
    const small = pixels < 72;
    const machine = createPresenceMachine();
    const sim = createPresenceSim({
      count: particleCount(pixels),
      voice: live.current.face,
      initial: "CLOUD",
      seed: pixels * 7 + 3,
    });

    // Q's own colour: the accent, unless Q's patience is running out
    // (founder direction 2026-09-30): orange when impatient, red when
    // stern, set on the document as data-q-mood.
    let colour: Rgb = [0.42, 0.66, 1];
    const readColour = () => {
      const style = getComputedStyle(canvas);
      const mood = style.getPropertyValue("--cq-q-colour").trim();
      const value =
        mood.length > 0 ? mood : style.getPropertyValue("--cq-accent").trim();
      colour = resolveColour(value.length > 0 ? value : "#6aa8ff");
    };
    readColour();

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

    let raf = 0;
    let onScreen = true;
    let last = 0;
    const frame = (now: number) => {
      const current = live.current;
      sim.setVoice(current.face);
      const view = machine.step({ state: current.state, small, now });
      const moving = current.motion === "full";
      if (moving) {
        sim.setFigure(view.figure);
        const dt = last === 0 ? 1 / 60 : (now - last) / 1000;
        last = now;
        sim.step(now / 1000, dt, levels());
      } else if (sim.figure() !== view.figure || figure === "") {
        // Reduced motion: each figure drawn still, no flow between.
        sim.settle(view.figure, now / 1000, { input: 0, output: 0 });
      }
      note(view.figure);
      drawPresence(context, sim, { pixels: device, colour, dim: view.dim });
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
      window.removeEventListener(Q_GESTURES_EVENT, onGestures);
      canvas.removeEventListener("cq:redraw", redraw);
      cancelAnimationFrame(raf);
      window.clearInterval(stillTimer);
      themeWatch.disconnect();
      visibility.disconnect();
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [pixels]);

  // A state or motion change restarts a stopped loop (reduced motion, or
  // after a hidden tab).
  useEffect(() => {
    canvasRef.current?.dispatchEvent(new Event("cq:redraw"));
  }, [state, motion]);

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
