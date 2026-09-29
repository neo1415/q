"use client";

import { useEffect, useRef } from "react";

import { useQMotion } from "../q-aperture/q-motion";
import type { QApertureState } from "../q-aperture/aperture-state";
import { useVoicePreference } from "../voice/voice-preference";
import {
  createSwarmEngine,
  type SwarmActivity,
  type SwarmFrameInput,
  type SwarmMode,
} from "./swarm-engine";

/**
 * Q's presence as a particle swarm (founder direction 2026-09-29). What it
 * forms is read from Q's real state, never a decorative loop:
 *
 *   IDLE        the Q, breathing; now and then it becomes a face and looks
 *               around, then settles back into the Q
 *   LISTENING   a face, eyes lit with the person's voice
 *   THINKING    a face with lights firing across its brain
 *   SPEAKING    a face whose mouth moves with Q's voice, head nodding
 *   NEEDS_INPUT a face, head tilted, brows up
 *   WORKING     a ring the swarm runs round (the loading state)
 *   COMPLETE    a thumbs up, then the Q
 *   ERROR       the Q, dimmed
 *
 * The face follows the chosen voice: female voice, female face. Below
 * 72 px a face cannot be read, so small sizes keep to the Q and the ring.
 */

export type QSwarmGesture = "LAUGH" | null;

export function modeFor(
  state: QApertureState,
  small: boolean,
  now: number,
  gesture: QSwarmGesture,
  glyph: string | null,
): {
  mode: SwarmMode;
  activity: SwarmActivity;
  dim: boolean;
  glyph: string | null;
} {
  if (glyph !== null && !small) {
    return { mode: "GLYPH", activity: "IDLE", dim: false, glyph };
  }
  if (gesture === "LAUGH" && !small) {
    return { mode: "FACE", activity: "LAUGHING", dim: false, glyph: null };
  }
  const face = (activity: SwarmActivity) =>
    small
      ? { mode: "Q" as const, activity, dim: false, glyph: null }
      : { mode: "FACE" as const, activity, dim: false, glyph: null };
  switch (state) {
    case "LISTENING":
      return face("LISTENING");
    case "THINKING":
      return small
        ? { mode: "RING", activity: "THINKING", dim: false, glyph: null }
        : face("THINKING");
    case "SPEAKING":
      return face("SPEAKING");
    case "NEEDS_INPUT":
      return face("ASKING");
    case "WORKING":
      return { mode: "RING", activity: "THINKING", dim: false, glyph: null };
    case "NEEDS_APPROVAL":
      return { mode: "Q", activity: "ASKING", dim: false, glyph: null };
    case "COMPLETE":
      return small
        ? { mode: "Q", activity: "IDLE", dim: false, glyph: null }
        : { mode: "GLYPH", activity: "IDLE", dim: false, glyph: "👍" };
    case "ERROR":
      return { mode: "Q", activity: "IDLE", dim: true, glyph: null };
    case "IDLE": {
      // Alive at rest: every twenty seconds, six of them as a face that
      // looks around, on the larger surfaces only.
      const cycle = (now / 1000) % 20;
      return !small && cycle > 14
        ? { mode: "FACE", activity: "IDLE", dim: false, glyph: null }
        : { mode: "Q", activity: "IDLE", dim: false, glyph: null };
    }
  }
}

export function QSwarm({
  state,
  pixels,
  inputLevel,
  outputLevel,
  gesture = null,
  glyph = null,
}: {
  readonly state: QApertureState;
  readonly pixels: number;
  readonly inputLevel?: (() => number) | undefined;
  readonly outputLevel?: (() => number) | undefined;
  readonly gesture?: QSwarmGesture | undefined;
  /** An emoji or symbol for the swarm to form, when Q has one to show. */
  readonly glyph?: string | null | undefined;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const face = useVoicePreference();
  const { motion } = useQMotion();
  const live = useRef({
    state,
    inputLevel,
    outputLevel,
    gesture,
    glyph,
    face,
    motion,
  });
  useEffect(() => {
    live.current = {
      state,
      inputLevel,
      outputLevel,
      gesture,
      glyph,
      face,
      motion,
    };
  }, [state, inputLevel, outputLevel, gesture, glyph, face, motion]);

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
    const readColour = () => {
      const value = getComputedStyle(canvas)
        .getPropertyValue("--cq-accent")
        .trim();
      engine.setColour(value.length > 0 ? value : "#6aa8ff");
    };
    readColour();
    const themeWatch = new MutationObserver(readColour);
    themeWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    let raf = 0;
    let onScreen = true;
    const frame = (now: number) => {
      const current = live.current;
      const small = pixels < 72;
      const shape = modeFor(
        current.state,
        small,
        now,
        current.gesture,
        current.glyph,
      );
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
