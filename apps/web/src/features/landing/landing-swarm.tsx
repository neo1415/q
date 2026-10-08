"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Q's presence on the landing (ADR 0045): the particle swarm, at landing
 * scale. Everything about the swarm lives in this one file behind a small
 * interface, so it can be swapped for the shared 3D presence without
 * touching the scenes that drive it.
 *
 * Why not the app's QSwarm: it draws a square, state-shaped presence
 * (a lean while listening, a wave while speaking), with no full-stage bloom.
 * The landing's approved motion keeps Q a cloud that gathers into its
 * working ring and pulses while speaking, across a wide stage.
 *
 * Particles spring toward a target figure, so every change of state is a
 * short flow. The figure leans toward the pointer through a critically
 * damped spring rather than tracking it 1:1. Off screen or in a hidden tab
 * nothing runs; the device pixel ratio is capped at 2; a frame-budget
 * guard sheds particles when frames run long; reduced motion draws the
 * settled figure once.
 */

export type SwarmMode = "cloud" | "listening" | "working" | "speaking";
export type SwarmVariant = "hero" | "demo" | "call";

export type LandingSwarmProps = {
  readonly variant: SwarmVariant;
  /** What Q is doing. Working gathers the cloud into its ring. */
  readonly mode?: SwarmMode | undefined;
  /** 0..1: an extra pull into the ring (the hero, as it scrolls away). */
  readonly gather?: number | undefined;
  /** Bump to give a short burst of attention (a backchannel "Mm-hm"). */
  readonly pulse?: number | undefined;
  /** The area whose pointer Q leans toward and parts around. */
  readonly pointerArea?: RefObject<HTMLElement | null> | undefined;
  readonly reducedMotion: boolean;
  readonly small: boolean;
};

type Variant = {
  readonly count: [desktop: number, phone: number];
  readonly scale: [desktop: number, phone: number];
  readonly centre: [x: number, y: [desktop: number, phone: number]];
};

const VARIANTS: Readonly<Record<SwarmVariant, Variant>> = {
  hero: { count: [2000, 1000], scale: [0.3, 0.3], centre: [0.5, [0.4, 0.38]] },
  demo: {
    count: [1300, 700],
    scale: [0.34, 0.36],
    centre: [0.5, [0.42, 0.45]],
  },
  call: {
    count: [1800, 900],
    scale: [0.27, 0.28],
    centre: [0.5, [0.36, 0.36]],
  },
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/* One hue family, light only on Q. Canvas paint, so literal channels. */
const BANDS = ["255,248,232", "190,212,255", "120,160,255"] as const;
const ALPHA_STEPS = 12;
/** The brightest the glow gets (rest, attention, voice and ring at once). */
const MAX_GLOW = 0.75 + 0.3 + 0.5 + 0.2;

type Home = {
  hx: number;
  hy: number;
  hz: number;
  ring: number;
  rr: number;
  seed: number;
  s: number;
};

/** A small deterministic PRNG: the same cloud on every visit. */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Swarm {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly n: number;
  private active: number;
  private readonly home: Home[] = [];
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly pz: Float32Array;
  private readonly bucket: Uint16Array;
  private readonly order: Uint16Array;
  private readonly counts = new Uint16Array(BANDS.length * (ALPHA_STEPS + 1));
  private w = 0;
  private h = 0;
  private cx = 0;
  private cy = 0;
  private R = 1;
  private t = 0;
  private amp = 0;
  private ampT = 0;
  private ampTarget = 0;
  private orbitMix = 0;
  private frameAvg = 16;
  private sinceShed = 0;
  private readonly lean = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };
  readonly ptr = { x: -9999, y: -9999, on: false };
  mode: SwarmMode = "cloud";
  gather = 0;
  energy = 0;

  private readonly canvas: HTMLCanvasElement;
  private readonly bloom: HTMLElement | null;
  private readonly core: HTMLElement | null;
  private readonly scale: number;
  private readonly ox: number;
  private readonly oy: number;

  constructor(
    canvas: HTMLCanvasElement,
    bloom: HTMLElement | null,
    core: HTMLElement | null,
    count: number,
    scale: number,
    ox: number,
    oy: number,
  ) {
    this.canvas = canvas;
    this.bloom = bloom;
    this.core = core;
    this.scale = scale;
    this.ox = ox;
    this.oy = oy;
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("no 2d context");
    this.ctx = ctx;
    this.n = count;
    this.active = count;
    this.px = new Float32Array(count);
    this.py = new Float32Array(count);
    this.vx = new Float32Array(count);
    this.vy = new Float32Array(count);
    this.pz = new Float32Array(count);
    this.bucket = new Uint16Array(count);
    this.order = new Uint16Array(count);
    const rnd = mulberry(count * 31 + 7);
    for (let i = 0; i < count; i++) {
      // a soft sphere: denser core, feathered edge
      const th = 2 * Math.PI * rnd();
      const ph = Math.acos(2 * rnd() - 1);
      const r = Math.pow(rnd(), 0.55) * (0.75 + 0.25 * rnd());
      this.home.push({
        hx: r * Math.sin(ph) * Math.cos(th),
        hy: r * Math.sin(ph) * Math.sin(th),
        hz: r * Math.cos(ph),
        ring: rnd() * Math.PI * 2,
        rr: 0.92 + rnd() * 0.16,
        seed: rnd() * 1000,
        s: 0.9 + rnd() * 1.5,
      });
      const a = rnd() * Math.PI * 2;
      const d = 1.2 + rnd() * 1.6;
      this.px[i] = Math.cos(a) * d;
      this.py[i] = Math.sin(a) * d;
    }
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const b = this.canvas.getBoundingClientRect();
    this.w = b.width;
    this.h = b.height;
    this.canvas.width = Math.round(b.width * dpr);
    this.canvas.height = Math.round(b.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cx = this.w * this.ox;
    this.cy = this.h * this.oy;
    this.R = Math.min(this.w, this.h) * this.scale;
    const place = (el: HTMLElement | null, radius: number) => {
      if (el === null) return;
      el.style.left = `${this.cx - radius}px`;
      el.style.top = `${this.cy - radius}px`;
      el.style.width = `${radius * 2}px`;
      el.style.height = `${radius * 2}px`;
    };
    place(this.bloom, this.R * 2.2);
    place(this.core, this.R * 0.38);
  }

  pointer(clientX: number, clientY: number) {
    const b = this.canvas.getBoundingClientRect();
    this.ptr.x = clientX - b.left;
    this.ptr.y = clientY - b.top;
    this.ptr.on = true;
    // lean toward the pointer, capped: Q attends, it doesn't chase
    const nx = clamp((clientX - (b.left + this.cx)) / (b.width || 1), -1, 1);
    const ny = clamp((clientY - (b.top + this.cy)) / (b.height || 1), -1, 1);
    this.lean.tx = nx * 0.16;
    this.lean.ty = ny * 0.12;
    this.energy = Math.min(1, this.energy + 0.04);
  }

  pointerLeave() {
    this.ptr.on = false;
    this.lean.tx = 0;
    this.lean.ty = 0;
  }

  /**
   * Frame-budget guard: only while frames run long for a sustained spell
   * (an average above 28 ms, under ~35 fps), shed a tenth of the
   * particles every half second or so, never below 60%, so a passing
   * stall never thins Q. Shed particles stay shed for this visit.
   */
  budget(frameMs: number) {
    this.frameAvg += (Math.min(frameMs, 100) - this.frameAvg) * 0.05;
    if (++this.sinceShed < 30) return;
    if (this.frameAvg > 28 && this.active > this.n * 0.6) {
      this.active = Math.floor(this.active * 0.9);
      this.sinceShed = 0;
    }
  }

  step(dt: number) {
    this.t += dt;
    const L = this.lean;
    const k = 60;
    const c = 2 * Math.sqrt(k); // critically damped
    L.vx += (k * (L.tx - L.x) - c * L.vx) * dt;
    L.vy += (k * (L.ty - L.y) - c * L.vy) * dt;
    L.x += L.vx * dt;
    L.y += L.vy * dt;
    this.energy *= Math.pow(0.4, dt);
    const targetOrbit = this.mode === "working" ? 1 : this.gather;
    this.orbitMix += (targetOrbit - this.orbitMix) * Math.min(1, dt * 2.4);
    if (this.mode === "speaking") {
      this.ampT -= dt;
      if (this.ampT <= 0) {
        this.ampTarget = 0.25 + Math.random() * 0.75;
        this.ampT = 0.08 + Math.random() * 0.12;
      }
    } else this.ampTarget = 0;
    this.amp += (this.ampTarget - this.amp) * Math.min(1, dt * 14);
    const rot = this.t * (0.12 + this.orbitMix * 0.5);
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const listen = this.mode === "listening" ? 1 : 0;
    const tilt = 0.45;
    const damp = Math.pow(0.02, dt);
    const grow = 1 + this.amp * 0.22;
    const om = this.orbitMix;
    const ptr = this.ptr;
    for (let i = 0; i < this.active; i++) {
      const h = this.home[i];
      if (h === undefined) continue;
      // cloud: rotating sphere with a slow current
      const sx = h.hx * cr - h.hz * sr;
      const sz = h.hx * sr + h.hz * cr;
      const cur = 0.05 * Math.sin(this.t * 0.7 + h.seed);
      let tx = sx * (grow + cur);
      let ty = h.hy * (grow + cur) - listen * 0.04;
      // orbit: a tilted ring, the shape Q takes while it works
      const a = h.ring + this.t * 0.9;
      const rx = Math.cos(a) * h.rr;
      const ry = Math.sin(a) * h.rr * tilt + h.hy * 0.08;
      tx += (rx - tx) * om;
      ty += (ry - ty) * om;
      tx += L.x * (1.2 - sz * 0.4);
      ty += L.y * (1.2 - sz * 0.4);
      let vx = ((this.vx[i] ?? 0) + (tx - (this.px[i] ?? 0)) * 9 * dt) * damp;
      let vy = ((this.vy[i] ?? 0) + (ty - (this.py[i] ?? 0)) * 9 * dt) * damp;
      if (ptr.on) {
        // particles part around the pointer
        const sxp = this.cx + (this.px[i] ?? 0) * this.R;
        const syp = this.cy + (this.py[i] ?? 0) * this.R;
        const dx = sxp - ptr.x;
        const dy = syp - ptr.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 6400) {
          const f = (((1 - d2 / 6400) * 2.2) / this.R) * 60;
          const d = Math.sqrt(d2) || 1;
          vx += (dx / d) * f * dt;
          vy += (dy / d) * f * dt;
        }
      }
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.px[i] = (this.px[i] ?? 0) + vx * dt;
      this.py[i] = (this.py[i] ?? 0) + vy * dt;
      this.pz[i] = sz;
    }
  }

  draw() {
    const x = this.ctx;
    const R = this.R;
    x.clearRect(0, 0, this.w, this.h);
    // bloom and core: Q only, one hue family, brighter while speaking or
    // attended to. Painted by the compositor as two gradient layers that
    // only move and fade, so the canvas rasterises particles alone.
    const glow =
      0.75 + this.energy * 0.3 + this.amp * 0.5 + this.orbitMix * 0.2;
    const lean = `translate3d(${this.lean.x * R}px,${this.lean.y * R}px,0)`;
    const fade = String(Math.min(1, glow / MAX_GLOW));
    for (const layer of [this.bloom, this.core]) {
      if (layer === null) continue;
      layer.style.transform = lean;
      layer.style.opacity = fade;
    }
    x.globalCompositeOperation = "lighter";
    // Batch by colour band and quantised alpha: a few fills, not thousands.
    const counts = this.counts;
    counts.fill(0);
    const sizes = this.sizes();
    for (let i = 0; i < this.active; i++) {
      const p = Math.hypot(this.px[i] ?? 0, this.py[i] ?? 0);
      const near = 1 - Math.min(1, p);
      const depth = (1 - (this.pz[i] ?? 0)) * 0.5;
      const al = clamp(0.4 + near * 0.6 - depth * 0.18, 0, 1);
      const band = near > 0.72 ? 0 : near > 0.4 ? 1 : 2;
      const b = band * (ALPHA_STEPS + 1) + Math.round(al * ALPHA_STEPS);
      this.bucket[i] = b;
      counts[b] = (counts[b] ?? 0) + 1;
      sizes[i] =
        (this.home[i]?.s ?? 1) * (1.35 - depth * 0.6) * (1 + this.amp * 0.25);
    }
    // counting sort into buckets
    let acc = 0;
    const starts = this.starts;
    for (let b = 0; b < counts.length; b++) {
      starts[b] = acc;
      acc += counts[b] ?? 0;
    }
    const fillAt = this.fillAt;
    fillAt.set(starts);
    for (let i = 0; i < this.active; i++) {
      const b = this.bucket[i] ?? 0;
      const at = fillAt[b] ?? 0;
      this.order[at] = i;
      fillAt[b] = at + 1;
    }
    for (let b = 0; b < counts.length; b++) {
      const count = counts[b] ?? 0;
      if (count === 0) continue;
      const band = Math.floor(b / (ALPHA_STEPS + 1));
      const al = (b % (ALPHA_STEPS + 1)) / ALPHA_STEPS;
      x.fillStyle = `rgba(${BANDS[band] ?? BANDS[2]},${al})`;
      x.beginPath();
      const s0 = starts[b] ?? 0;
      for (let j = s0; j < s0 + count; j++) {
        const i = this.order[j] ?? 0;
        const s = sizes[i] ?? 1;
        x.rect(
          this.cx + (this.px[i] ?? 0) * R - s / 2,
          this.cy + (this.py[i] ?? 0) * R - s / 2,
          s,
          s,
        );
      }
      x.fill();
    }
    x.globalCompositeOperation = "source-over";
  }

  private readonly starts = new Uint16Array(BANDS.length * (ALPHA_STEPS + 1));
  private readonly fillAt = new Uint16Array(BANDS.length * (ALPHA_STEPS + 1));
  private sizeBuf: Float32Array | null = null;
  private sizes(): Float32Array {
    if (this.sizeBuf === null) this.sizeBuf = new Float32Array(this.n);
    return this.sizeBuf;
  }
}

export function LandingSwarm({
  variant,
  mode = "cloud",
  gather = 0,
  pulse = 0,
  pointerArea,
  reducedMotion,
  small,
}: LandingSwarmProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bloomRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<HTMLDivElement>(null);
  const swarmRef = useRef<Swarm | null>(null);
  const kickRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const v = VARIANTS[variant];
    const pick = (pair: readonly [number, number]) =>
      small ? pair[1] : pair[0];
    let swarm: Swarm;
    try {
      swarm = new Swarm(
        canvas,
        bloomRef.current,
        coreRef.current,
        pick(v.count),
        pick(v.scale),
        v.centre[0],
        pick(v.centre[1]),
      );
    } catch {
      return;
    }
    swarmRef.current = swarm;
    let raf = 0;
    let running = false;
    let visible = false;
    let last = 0;

    const settle = () => {
      for (let k = 0; k < 240; k++) swarm.step(1 / 60);
      swarm.draw();
    };
    const frame = (now: number) => {
      if (!visible || document.hidden) {
        running = false;
        return;
      }
      const ms = now - last;
      last = now;
      swarm.budget(ms);
      swarm.step(Math.min(0.033, ms / 1000));
      swarm.draw();
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (reducedMotion) {
        settle();
        return;
      }
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    kickRef.current = start;

    const resize = new ResizeObserver(() => {
      swarm.resize();
      if (reducedMotion) swarm.draw();
    });
    resize.observe(canvas);
    const seen = new IntersectionObserver(
      (entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (visible) start();
      },
      { rootMargin: "100px" },
    );
    seen.observe(canvas);
    const onVisibility = () => {
      if (!document.hidden && visible) start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const area = pointerArea?.current ?? null;
    const onMove = (e: PointerEvent) => swarm.pointer(e.clientX, e.clientY);
    const onLeave = () => swarm.pointerLeave();
    if (area !== null && !reducedMotion) {
      area.addEventListener("pointermove", onMove, { passive: true });
      area.addEventListener("pointerleave", onLeave);
    }
    if (reducedMotion) settle();

    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      seen.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      area?.removeEventListener("pointermove", onMove);
      area?.removeEventListener("pointerleave", onLeave);
      swarmRef.current = null;
    };
  }, [variant, small, reducedMotion, pointerArea]);

  useEffect(() => {
    const swarm = swarmRef.current;
    if (swarm === null) return;
    swarm.mode = mode;
    swarm.gather = gather;
    if (reducedMotion) kickRef.current();
  }, [mode, gather, reducedMotion]);

  useEffect(() => {
    const swarm = swarmRef.current;
    if (swarm !== null && pulse > 0) swarm.energy = 1;
  }, [pulse]);

  return (
    <>
      <div ref={bloomRef} className="lp-swarm-bloom" aria-hidden="true" />
      <canvas ref={canvasRef} aria-hidden="true" className="lp-swarm" />
      <div ref={coreRef} className="lp-swarm-core" aria-hidden="true" />
    </>
  );
}
