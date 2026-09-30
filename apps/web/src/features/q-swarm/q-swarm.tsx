"use client";

import { useEffect, useRef } from "react";

import { useQMotion } from "../q-aperture/q-motion";
import type { QApertureState } from "../q-aperture/aperture-state";
import { useVoicePreference } from "../voice/voice-preference";
import {
  choreograph,
  cueForSentence,
  type SwarmCue,
} from "./swarm-choreography";
import { createSwarmEngine, type SwarmFrameInput } from "./swarm-engine";
import { Q_SAID_EVENT, saidText } from "./q-said";

/**
 * Q's presence as a particle swarm (founder direction 2026-09-29). What it
 * forms is read from Q's real state and from what Q is saying, never a
 * decorative loop: each state has its own sequence of figures (the Q, a
 * face, a mouth, a sound wave, a galaxy, a bloom, a ring, a glyph), none
 * held more than nine seconds, and a sentence of Q's takes the swarm for
 * its moment -- a laugh, a 💰 when it talks about money -- as it is said.
 *
 * The face follows the chosen voice: female voice, female face. Below
 * 72 px a face cannot be read, so small sizes keep to the moving figures.
 */

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
    canvas.width = Math.round(pixels * dpr);
    canvas.height = Math.round(pixels * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const engine = createSwarmEngine(context, pixels);
    // Q's own colour: the accent, unless Q's patience is running out
    // (founder direction 2026-09-30): orange when impatient, red when
    // stern, set on the document as data-q-mood.
    const readColour = () => {
      const style = getComputedStyle(canvas);
      const mood = style.getPropertyValue("--cq-q-colour").trim();
      const value =
        mood.length > 0 ? mood : style.getPropertyValue("--cq-accent").trim();
      engine.setColour(value.length > 0 ? value : "#6aa8ff");
    };
    readColour();
    const themeWatch = new MutationObserver(readColour);
    themeWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-q-mood"],
    });

    // What Q is saying, as it says it: a cue for the moment.
    let cue: SwarmCue | null = null;
    const onSaid = (event: Event) => {
      const text = saidText(event);
      if (text === null) return;
      const next = cueForSentence(text, performance.now());
      if (next !== null) cue = next;
    };
    window.addEventListener(Q_SAID_EVENT, onSaid);

    let raf = 0;
    let onScreen = true;
    let lastState: QApertureState | null = null;
    let since = 0;
    const frame = (now: number) => {
      const current = live.current;
      if (current.state !== lastState) {
        lastState = current.state;
        since = now;
      }
      const shape = choreograph({
        state: current.state,
        small: pixels < 72,
        now,
        since,
        cue,
      });
      const input: SwarmFrameInput = {
        mode: shape.mode,
        activity: shape.activity,
        face: current.face,
        glyph: shape.glyph,
        input: current.inputLevel?.() ?? 0,
        output: current.outputLevel?.() ?? 0,
        motion:
          current.motion === "off"
            ? "off"
            : current.motion === "calm"
              ? "calm"
              : "full",
        dim: shape.dim,
      };
      engine.draw(now, input);
      if (input.motion !== "off" && onScreen && !document.hidden) {
        raf = requestAnimationFrame(frame);
      }
    };
    const start = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    };
    const visibility = new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      if (onScreen) start();
    });
    visibility.observe(canvas);
    const onHidden = () => {
      if (!document.hidden) start();
    };
    document.addEventListener("visibilitychange", onHidden);
    canvas.addEventListener("cq:redraw", start);
    start();
    return () => {
      window.removeEventListener(Q_SAID_EVENT, onSaid);
      canvas.removeEventListener("cq:redraw", start);
      cancelAnimationFrame(raf);
      themeWatch.disconnect();
      visibility.disconnect();
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [pixels]);

  // With motion off the frame loop stops after one frame; a state change
  // must still redraw the settled shape.
  useEffect(() => {
    if (motion !== "off") return;
    const canvas = canvasRef.current;
    canvas?.dispatchEvent(new Event("cq:redraw"));
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
