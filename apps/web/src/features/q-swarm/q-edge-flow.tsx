"use client";

import { useEffect, useRef } from "react";

import { useQSessionOptional } from "../q/q-session";
import { edgeFlowing, edgeParticles } from "./edge-flow";

/**
 * Particles travelling around the page edge while Q works (ADR 0062,
 * Q room R7). Driven by Q's real state from the one Q session; drawn on
 * one fixed, click-through canvas, only while Q is thinking or working.
 * Under reduced motion nothing moves: a still edge line shows instead.
 * Decorative: hidden from assistive technology, since Q's label and
 * presence already say that it is working.
 */
export function QEdgeFlow() {
  const session = useQSessionOptional();
  const state = session?.presence?.state ?? "IDLE";
  const flowing = edgeFlowing(state);
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const element = canvas.current;
    if (!flowing || element === null) return;
    const context = element.getContext("2d");
    if (context === null) return;
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const started = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (element.width !== Math.round(width * ratio)) {
        element.width = Math.round(width * ratio);
        element.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = getComputedStyle(element).color;
      for (const particle of edgeParticles(now - started, width, height)) {
        context.globalAlpha = particle.alpha;
        context.beginPath();
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      context.clearRect(0, 0, element.width, element.height);
    };
  }, [flowing]);

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      data-q-edge-flow={flowing ? "on" : "off"}
      className="cq-q-edge-flow"
    />
  );
}
