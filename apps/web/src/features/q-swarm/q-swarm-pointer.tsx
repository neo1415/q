"use client";

import { useEffect, useRef } from "react";

import { useQMotion } from "../q-aperture/q-motion";
import { Q_SAID_EVENT, saidText } from "./q-said";
import { pointTargetFor, type PointCandidate } from "./point-target";

/**
 * Q leaving its corner (founder direction 2026-09-29: "the particles can
 * go all over the page, pointing at stuff at exact parts of the page...
 * Q doesn't even have to be one thing in one place").
 *
 * When a sentence of Q's names something on the screen -- a navigation
 * item, a button, a heading -- part of the swarm flies from Q's presence
 * to it, circles it while the sentence is said, and flies home. The
 * overlay never takes a click (pointer-events none), draws only while
 * travelling, and stays still under reduced motion.
 */

const FLY_MS = 900;
const CIRCLE_MS = 2_600;
const RETURN_MS = 900;
const PARTICLES = 150;
const TAU = Math.PI * 2;

type Flight = {
  readonly started: number;
  readonly from: { x: number; y: number };
  readonly target: Element;
};

function candidates(): PointCandidate[] {
  const found: PointCandidate[] = [];
  const nodes = document.querySelectorAll(
    "[data-q-point], nav a, main h1, main h2, main button, main a[href]",
  );
  for (const element of nodes) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
    const label =
      element.getAttribute("data-q-point") ??
      element.getAttribute("aria-label") ??
      element.textContent;
    if (label === null) continue;
    found.push({ label, element });
  }
  return found;
}

function presenceOrigin(): { x: number; y: number } {
  for (const canvas of document.querySelectorAll("canvas[data-q-swarm]")) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight) {
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
  }
  return { x: window.innerWidth - 48, y: window.innerHeight - 48 };
}

/** A point on the rounded outline of `rect`, `u` in 0..1 around it. */
function outline(rect: DOMRect, u: number, pad: number) {
  const w = rect.width + pad * 2;
  const h = rect.height + pad * 2;
  const perimeter = 2 * (w + h);
  let d = (((u % 1) + 1) % 1) * perimeter;
  const left = rect.left - pad;
  const top = rect.top - pad;
  if (d < w) return { x: left + d, y: top };
  d -= w;
  if (d < h) return { x: left + w, y: top + d };
  d -= h;
  if (d < w) return { x: left + w - d, y: top + h };
  d -= w;
  return { x: left, y: top + h - d };
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export function QSwarmPointer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { motion } = useQMotion();
  const motionRef = useRef(motion);
  useEffect(() => {
    motionRef.current = motion;
  }, [motion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;
    let flight: Flight | null = null;
    let raf = 0;
    const seeds = Array.from({ length: PARTICLES }, (_, i) => ({
      u: i / PARTICLES,
      bend: (Math.sin(i * 12.9898) * 43_758.5453) % 1,
      size: 0.8 + ((i * 7) % 5) * 0.25,
    }));

    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    window.addEventListener("resize", fit);

    const colour = () => {
      const value = getComputedStyle(canvas)
        .getPropertyValue("--cq-accent")
        .trim();
      return value.length > 0 ? value : "#6aa8ff";
    };

    const draw = (now: number) => {
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      const current = flight;
      if (current === null) return;
      const elapsed = now - current.started;
      const total = FLY_MS + CIRCLE_MS + RETURN_MS;
      if (elapsed > total || !current.target.isConnected) {
        flight = null;
        return;
      }
      const rect = current.target.getBoundingClientRect();
      context.fillStyle = colour();
      for (const seed of seeds) {
        const spin = seed.u + (elapsed / 1000) * 0.35;
        const home = outline(rect, spin, 8 + seed.bend * 6);
        let x: number;
        let y: number;
        let alpha = 0.85;
        if (elapsed < FLY_MS) {
          // Each point leaves at its own moment and arcs to its place.
          const t = ease(
            Math.min(1, Math.max(0, (elapsed - seed.u * 240) / (FLY_MS - 240))),
          );
          const lift = Math.sin(t * Math.PI) * (60 + seed.bend * 80);
          x = current.from.x + (home.x - current.from.x) * t;
          y = current.from.y + (home.y - current.from.y) * t - lift;
        } else if (elapsed < FLY_MS + CIRCLE_MS) {
          const shimmer = Math.sin(now / 180 + seed.u * TAU * 3);
          x = home.x + shimmer * 1.5;
          y = home.y + Math.cos(now / 210 + seed.u * TAU * 2) * 1.5;
          alpha = 0.6 + 0.4 * Math.max(0, shimmer);
        } else {
          const t = ease((elapsed - FLY_MS - CIRCLE_MS) / RETURN_MS);
          const origin = presenceOrigin();
          x = home.x + (origin.x - home.x) * t;
          y = home.y + (origin.y - home.y) * t + Math.sin(t * Math.PI) * 40;
          alpha = 0.85 * (1 - t * 0.7);
        }
        context.globalAlpha = alpha;
        context.beginPath();
        context.arc(x, y, seed.size * 1.4, 0, TAU);
        context.fill();
        context.globalAlpha = alpha * 0.25;
        context.beginPath();
        context.arc(x, y, seed.size * 4, 0, TAU);
        context.fill();
      }
      context.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };

    const onSaid = (event: Event) => {
      if (motionRef.current === "off") return;
      const text = saidText(event);
      if (text === null) return;
      const target = pointTargetFor(text, candidates());
      if (target === null) return;
      flight = {
        started: performance.now(),
        from: presenceOrigin(),
        target,
      };
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };
    window.addEventListener(Q_SAID_EVENT, onSaid);
    return () => {
      window.removeEventListener(Q_SAID_EVENT, onSaid);
      window.removeEventListener("resize", fit);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-(--cq-z-presence) h-screen w-screen"
      data-q-swarm-pointer
    />
  );
}
