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

    // Owner, 10 Nov (client): "just a cursor, similar colour, an arrow
    // that moves as a pointer" -- one arrow, not a cloud of particles.
    const arrow = (x: number, y: number, alpha: number) => {
      // Tip at (x, y), the shape of a system pointer, 22 px tall.
      context.save();
      context.translate(x, y);
      context.globalAlpha = alpha;
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(0, 20);
      context.lineTo(5, 15.5);
      context.lineTo(8.5, 23);
      context.lineTo(11.5, 21.6);
      context.lineTo(8, 14.4);
      context.lineTo(14.5, 14.4);
      context.closePath();
      context.shadowColor = "rgba(0, 0, 0, 0.35)";
      context.shadowBlur = 4;
      context.shadowOffsetY = 1;
      context.fillStyle = colour();
      context.fill();
      context.shadowColor = "transparent";
      context.lineWidth = 1.25;
      context.strokeStyle = "rgba(255, 255, 255, 0.9)";
      context.stroke();
      context.restore();
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
      // The tip rests just inside the item's lower-left, as a hand would.
      const rest = {
        x: rect.left + Math.min(rect.width * 0.35, 28),
        y: rect.top + rect.height * 0.62,
      };
      let x: number;
      let y: number;
      let alpha = 1;
      if (elapsed < FLY_MS) {
        const t = ease(elapsed / FLY_MS);
        x = current.from.x + (rest.x - current.from.x) * t;
        y = current.from.y + (rest.y - current.from.y) * t;
        alpha = Math.min(1, t * 3);
      } else if (elapsed < FLY_MS + CIRCLE_MS) {
        // A small nudge, as a presenter taps the thing they mean.
        const held = elapsed - FLY_MS;
        const tap = Math.max(0, Math.sin((held / 650) * TAU)) * 3;
        x = rest.x + tap * 0.5;
        y = rest.y + tap;
      } else {
        const t = (elapsed - FLY_MS - CIRCLE_MS) / RETURN_MS;
        x = rest.x;
        y = rest.y;
        alpha = 1 - t;
      }
      arrow(x, y, alpha);
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
