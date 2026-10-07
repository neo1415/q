import {
  buildFigure,
  createFigureFrame,
  type Figure,
  type FigureFrame,
  type FigureKind,
} from "./presence-figures";

/**
 * How Q's particles move (PRESENCE spec §4; founder 2026-10-01: "truly
 * continuous: never slow drift then a sudden bounce into a shape...
 * variable speed, sometimes fast, sometimes slow, never jumpy").
 *
 * One dynamic for everything:
 *
 * 1. Each particle's target blends from the old figure to the new one
 *    with smootherstep easing over a fixed duration per destination
 *    (longer for a drift back to rest), staggered per
 *    particle so the swarm flows rather than marching in step, and
 *    swirls aside on the way (a detour that is zero at both ends: K1,
 *    "morphing", never a straight slide). A change mid-change starts from
 *    where the targets are, never from the old figure.
 * 2. A divergence-free flow field (the curl of a moving potential) is
 *    added under every figure; its strength eases between figures, so the
 *    current never switches on or off.
 * 3. Particles follow their targets as a critically damped spring with a
 *    hard cap on acceleration and on speed: no frame moves any particle
 *    further than MAX_SPEED x dt, and no frame changes its velocity by
 *    more than MAX_ACCEL x dt. That bound is what the tests hold.
 */

/** Frame units per second (the frame is about 2.3 units wide). */
export const MAX_SPEED = 2.4;
/** Frame units per second squared. */
export const MAX_ACCEL = 14;
/** Longer gaps (a dropped frame, a background tab) are taken as this. */
export const MAX_DT = 1 / 30;
/** Spring stiffness: critically damped, so it never overshoots. */
const OMEGA = 11;
/** Particles start their move at most this share of the way in. */
const STAGGER = 0.3;

const GESTURE_FIGURES: ReadonlySet<FigureKind> = new Set([
  "QUESTION",
  "EXCLAIM",
  "MONEY",
  "BUILDINGS",
  "CHART_UP",
  "CLAP",
  "HANDS",
]);

/**
 * Seconds a change of figure takes: fixed per destination (P11), so the
 * same change always takes the same time. Settling back to rest is the
 * slowest; the face forms a little slower than a shape so it reads as
 * arriving, not snapping in.
 */
export function morphSeconds(to: FigureKind): number {
  if (GESTURE_FIGURES.has(to)) return 0.8;
  if (to === "CLOUD" || to === "ATTENTIVE") return 1.2;
  if (to === "FACE") return 1.3;
  // The Q moment gathers as calmly as the cloud settles (presence-q-moment).
  if (to === "LETTER_Q") return 1.2;
  return 1;
}

/** smootherstep: zero velocity and acceleration at both ends. */
export function ease(x: number): number {
  const t = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** How far a change carries a particle sideways at its midpoint, frame units. */
export const DETOUR = 0.2;

/**
 * One particle's weight through a change: 0 until its staggered start,
 * then eased to 1. `progress` runs 0..1+STAGGER over the change.
 */
export function morphWeight(progress: number, stagger: number): number {
  return ease((progress - stagger) / (1 - STAGGER));
}

/**
 * A particle's target part-way through a change: the straight blend plus
 * a swirl that grows and dies away (sin(pi w)), keyed to where the
 * particle came from, so neighbours curl together like smoke. Zero
 * detour at w = 0 and w = 1: a change starts and lands exactly.
 */
export function morphPoint(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  w: number,
  t: number,
  phase: number,
  out: { x: number; y: number },
): void {
  const bell = Math.sin(Math.PI * Math.min(1, Math.max(0, w)));
  out.x = ax + (bx - ax) * w + DETOUR * bell * Math.sin(ay * 3 + t * 2 + phase);
  out.y = ay + (by - ay) * w + DETOUR * bell * Math.cos(ax * 3 - t * 1.7);
}

/** The flow field's potential: three travelling waves. */
const WAVES = [
  { a: 1, kx: 1.7, ky: 1.1, w: 0.42, p: 0 },
  { a: 0.6, kx: -1.2, ky: 2.6, w: 0.67, p: 1.3 },
  { a: 0.35, kx: 3.1, ky: -2.2, w: 0.91, p: 2.7 },
] as const;

/** Curl of the potential at (x, y): a swirl that never piles up. */
export function flowAt(
  x: number,
  y: number,
  t: number,
  out: { fx: number; fy: number },
): void {
  let fx = 0;
  let fy = 0;
  for (const wave of WAVES) {
    const c = Math.cos(wave.kx * x + wave.ky * y + wave.w * t + wave.p);
    fx += wave.a * wave.ky * c;
    fy -= wave.a * wave.kx * c;
  }
  // Normalised so the strongest swirl is about 1.
  out.fx = fx / 3.2;
  out.fy = fy / 3.2;
}

export type PresenceLevels = {
  /** 0..1 microphone. */
  readonly input: number;
  /** 0..1 speaker. */
  readonly output: number;
};

export type PresenceSim = {
  readonly count: number;
  /** Where every particle is now. */
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Velocity, frame units per second. */
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  /** Depth and brightness of each particle's target, for shading. */
  readonly z: Float32Array;
  readonly b: Float32Array;
  readonly figure: () => FigureKind;
  /** Begin flowing to a figure (no-op when it is already the target). */
  readonly setFigure: (kind: FigureKind) => void;
  /** Advance by `dt` seconds at time `t`. */
  readonly step: (t: number, dt: number, levels: PresenceLevels) => void;
  /** Reduced motion: put every particle on the figure, still. */
  readonly settle: (
    kind: FigureKind,
    t: number,
    levels: PresenceLevels,
  ) => void;
};

export function createPresenceSim(options: {
  readonly count: number;
  readonly initial?: FigureKind | undefined;
  readonly seed?: number | undefined;
}): PresenceSim {
  const count = options.count;
  let seed = (options.seed ?? 7) >>> 0;
  const random = () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed / 4_294_967_296;
  };

  const figures = new Map<FigureKind, Figure>();
  const figureOf = (kind: FigureKind): Figure => {
    let figure = figures.get(kind);
    if (figure === undefined) {
      figure = buildFigure(kind, count);
      figures.set(kind, figure);
    }
    return figure;
  };

  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const vx = new Float32Array(count);
  const vy = new Float32Array(count);
  const z = new Float32Array(count);
  const b = new Float32Array(count);
  const stagger = new Float32Array(count);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    stagger[i] = random() * STAGGER;
    phase[i] = random() * Math.PI * 2;
  }

  const toFrame: FigureFrame = createFigureFrame(count);
  /** The blended targets, last frame: where a new change starts from. */
  const target: FigureFrame = createFigureFrame(count);

  let current: FigureKind = options.initial ?? "CLOUD";
  /** Static targets a change flows out of; null when no change is under way. */
  let from: FigureFrame | null = null;
  let fromFlow = 0;
  let started = 0;
  let duration = 1;
  let flowAmp = figureOf(current).flow;
  let output = 0;
  let input = 0;
  let nextBlink = 2 + random() * 3;
  let blinkStart = -1;
  const flow = { fx: 0, fy: 0 };
  const blended = { x: 0, y: 0 };

  // Start on the figure, so the first frame is already a presence.
  figureOf(current).evaluate({ t: 0, input: 0, output: 0, blink: 0 }, toFrame);
  for (let i = 0; i < count; i += 1) {
    x[i] = toFrame.x[i] ?? 0;
    y[i] = toFrame.y[i] ?? 0;
    target.x[i] = x[i] ?? 0;
    target.y[i] = y[i] ?? 0;
    target.z[i] = toFrame.z[i] ?? 0;
    target.b[i] = toFrame.b[i] ?? 0;
  }

  const blinkAt = (t: number): number => {
    if (blinkStart < 0 && t >= nextBlink) blinkStart = t;
    if (blinkStart < 0) return 0;
    const u = (t - blinkStart) / 0.16;
    if (u >= 1) {
      blinkStart = -1;
      nextBlink = t + 2.4 + random() * 3.6;
      return 0;
    }
    return Math.sin(u * Math.PI);
  };

  const easeLevels = (dt: number, levels: PresenceLevels) => {
    // Fast attack, slow release: a voice opens the mouth at once and lets
    // it close gently, as a jaw does.
    const k = (was: number, now: number) =>
      1 - Math.exp(-dt * (now > was ? 26 : 8));
    output += (levels.output - output) * k(output, levels.output);
    input += (levels.input - input) * k(input, levels.input);
  };

  const begin = (kind: FigureKind, t: number) => {
    // Flow out of where the targets are now, whatever was under way.
    const snapshot = createFigureFrame(count);
    snapshot.x.set(target.x);
    snapshot.y.set(target.y);
    snapshot.z.set(target.z);
    snapshot.b.set(target.b);
    from = snapshot;
    fromFlow = flowAmp;
    current = kind;
    started = t;
    // Each particle keeps the stagger it was seeded with: one change flows
    // the same way as the last, never re-rolled.
    duration = morphSeconds(kind);
  };

  let pending: FigureKind | null = null;

  return {
    count,
    x,
    y,
    vx,
    vy,
    z,
    b,
    figure: () => pending ?? current,
    setFigure: (kind) => {
      if (kind === (pending ?? current)) return;
      pending = kind;
    },
    settle: (kind, t, levels) => {
      current = kind;
      pending = null;
      from = null;
      output = levels.output;
      input = levels.input;
      const figure = figureOf(kind);
      flowAmp = figure.flow;
      figure.evaluate({ t, input, output, blink: 0 }, toFrame);
      for (let i = 0; i < count; i += 1) {
        x[i] = toFrame.x[i] ?? 0;
        y[i] = toFrame.y[i] ?? 0;
        vx[i] = 0;
        vy[i] = 0;
        z[i] = toFrame.z[i] ?? 0;
        b[i] = toFrame.b[i] ?? 0;
        target.x[i] = x[i] ?? 0;
        target.y[i] = y[i] ?? 0;
        target.z[i] = z[i] ?? 0;
        target.b[i] = b[i] ?? 0;
      }
    },
    step: (t, rawDt, levels) => {
      const dt = Math.min(MAX_DT, Math.max(0, rawDt));
      if (pending !== null) {
        begin(pending, t);
        pending = null;
      }
      easeLevels(dt, levels);
      const blink = blinkAt(t);
      const figure = figureOf(current);
      figure.evaluate({ t, input, output, blink }, toFrame);

      let progress = 1;
      if (from !== null) {
        progress = (t - started) / duration;
        if (progress >= 1 + STAGGER) from = null;
      }
      // The current's strength flows between figures too.
      const flowTarget =
        from === null
          ? figure.flow
          : fromFlow + (figure.flow - fromFlow) * ease(progress);
      flowAmp += (flowTarget - flowAmp) * (1 - Math.exp(-dt * 3));
      const source = from;

      const maxDv = MAX_ACCEL * dt;
      const maxV = MAX_SPEED;
      for (let i = 0; i < count; i += 1) {
        let tx = toFrame.x[i] ?? 0;
        let ty = toFrame.y[i] ?? 0;
        let tz = toFrame.z[i] ?? 0;
        let tb = toFrame.b[i] ?? 0;
        if (source !== null) {
          const w = morphWeight(progress, stagger[i] ?? 0);
          morphPoint(
            source.x[i] ?? 0,
            source.y[i] ?? 0,
            tx,
            ty,
            w,
            t,
            phase[i] ?? 0,
            blended,
          );
          tx = blended.x;
          ty = blended.y;
          tz = (source.z[i] ?? 0) + (tz - (source.z[i] ?? 0)) * w;
          tb = (source.b[i] ?? 0) + (tb - (source.b[i] ?? 0)) * w;
        }
        target.x[i] = tx;
        target.y[i] = ty;
        target.z[i] = tz;
        target.b[i] = tb;

        flowAt(tx, ty, t, flow);
        const p = phase[i] ?? 0;
        const gx = tx + flow.fx * flowAmp + Math.sin(t * 0.9 + p) * 0.006;
        const gy = ty + flow.fy * flowAmp + Math.cos(t * 1.1 + p * 1.3) * 0.006;

        // Critically damped spring, acceleration and speed capped.
        const px = x[i] ?? 0;
        const py = y[i] ?? 0;
        let ux = vx[i] ?? 0;
        let uy = vy[i] ?? 0;
        const ax = OMEGA * OMEGA * (gx - px) - 2 * OMEGA * ux;
        const ay = OMEGA * OMEGA * (gy - py) - 2 * OMEGA * uy;
        let dvx = ax * dt;
        let dvy = ay * dt;
        const dv = Math.hypot(dvx, dvy);
        if (dv > maxDv) {
          dvx *= maxDv / dv;
          dvy *= maxDv / dv;
        }
        ux += dvx;
        uy += dvy;
        const speed = Math.hypot(ux, uy);
        if (speed > maxV) {
          ux *= maxV / speed;
          uy *= maxV / speed;
        }
        vx[i] = ux;
        vy[i] = uy;
        x[i] = px + ux * dt;
        y[i] = py + uy * dt;
        z[i] = tz;
        b[i] = tb;
      }
    },
  };
}
