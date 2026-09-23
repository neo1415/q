import type { QPresenceState } from "./presence-state";

/**
 * The particle formation behind Q's presence.
 *
 * A ring of points with a short tail at the lower right — the shape of a
 * Q, read at a glance and never drawn as a letter. Every particle has a
 * home on that formation and is eased toward a target that the state
 * moves: outward and loosened by the person's voice, inward and ordered
 * while Q thinks, brightened by Q's own voice, swept sideways once when Q
 * acts, settled with one pulse when it is done, and roughened — not
 * reddened — when something is wrong.
 *
 * Pure arithmetic over a plain array; no DOM here. The component owns the
 * canvas and the clock. Deterministic per particle (seeded), so the same
 * presence looks the same on every mount.
 */

export type Particle = {
  /** Angle on the ring, radians. */
  readonly angle: number;
  /** Which orbit: 0 outer ring, 1 inner ring, 2 tail. */
  readonly orbit: 0 | 1 | 2;
  /** Per-particle phase for drift, 0..2π. */
  readonly phase: number;
  /** Per-particle scalar in 0..1, for size and drift amplitude. */
  readonly seed: number;
  x: number;
  y: number;
  alpha: number;
};

export type Formation = {
  readonly particles: Particle[];
  /** Radius of the outer ring at rest, in canvas units. */
  readonly radius: number;
};

/** A small deterministic generator (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Lay the particles out. The count is the caller's (it follows the size);
 * roughly two thirds sit on the outer ring, a quarter on the inner ring,
 * the rest along the tail.
 */
export function createFormation(count: number, radius: number): Formation {
  const random = seeded(7);
  const particles: Particle[] = [];
  const tail = Math.max(3, Math.round(count * 0.09));
  const inner = Math.max(6, Math.round(count * 0.26));
  const outer = Math.max(8, count - tail - inner);
  const push = (angle: number, orbit: 0 | 1 | 2) => {
    particles.push({
      angle,
      orbit,
      phase: random() * Math.PI * 2,
      seed: random(),
      x: 0,
      y: 0,
      alpha: 0,
    });
  };
  for (let i = 0; i < outer; i += 1) {
    // Evenly spaced with a little jitter so the ring reads as a swarm and
    // not as a dotted line.
    push(((i + (random() - 0.5) * 0.35) / outer) * Math.PI * 2, 0);
  }
  for (let i = 0; i < inner; i += 1) {
    push(((i + (random() - 0.5) * 0.5) / inner) * Math.PI * 2 + 0.3, 1);
  }
  for (let i = 0; i < tail; i += 1) {
    push((i + 0.5) / tail, 2);
  }
  return { particles, radius };
}

/** Where a particle rests, before any state moves it. */
function home(
  particle: Particle,
  radius: number,
): { readonly x: number; readonly y: number } {
  if (particle.orbit === 2) {
    // The tail: a short stroke from the ring's lower-right edge outward,
    // at the angle a Q's tail leaves the bowl.
    const t = particle.angle; // 0..1 along the tail
    const from = Math.PI * 0.25;
    const startX = Math.cos(from) * radius * 0.82;
    const startY = Math.sin(from) * radius * 0.82;
    const length = radius * 0.62;
    return {
      x: startX + Math.cos(from) * length * t,
      y: startY + Math.sin(from) * length * t,
    };
  }
  const r = particle.orbit === 0 ? radius : radius * 0.58;
  return { x: Math.cos(particle.angle) * r, y: Math.sin(particle.angle) * r };
}

export type FieldInput = {
  readonly state: QPresenceState;
  /** Seconds since the field was created. */
  readonly time: number;
  /** Seconds since the last frame. */
  readonly dt: number;
  /** Seconds since the state last changed. */
  readonly sinceState: number;
  /** 0..1 microphone energy, meaningful while listening. */
  readonly input: number;
  /** 0..1 speaker energy, meaningful while speaking. */
  readonly output: number;
  /** True under reduced motion: the field is drawn once, without drift. */
  readonly still: boolean;
};

/** Ease toward a target; frame-rate independent for the usual range. */
function approach(current: number, target: number, rate: number, dt: number) {
  const k = 1 - Math.exp(-rate * dt);
  return current + (target - current) * k;
}

/**
 * Advance every particle one frame. Mutates positions and alpha in place
 * and returns nothing; the caller draws what it finds.
 */
export function stepFormation(formation: Formation, input: FieldInput): void {
  const { particles, radius } = formation;
  const { state, time, dt, sinceState, still } = input;
  const level = state === "LISTENING" ? input.input : 0;
  const voice = state === "SPEAKING" ? input.output : 0;

  // Formation-wide parameters per state.
  let spread = 1;
  let rotation = 0;
  let drift = 0.02;
  let order = 0.6;
  let shear = 0;
  let baseAlpha = 0.55;
  let breathe = still ? 0 : Math.sin(time * 0.55) * 0.012;

  switch (state) {
    case "IDLE":
      break;
    case "LISTENING":
      // Opens with the voice: the ring widens, loosens, and brightens.
      spread = 1.04 + level * 0.22;
      drift = 0.05 + level * 0.06;
      order = 0.4;
      baseAlpha = 0.7 + level * 0.3;
      breathe = 0;
      break;
    case "THINKING":
      // Converges and turns, in order: work, not waiting.
      spread = 0.86;
      rotation = still ? 0 : time * 0.45;
      drift = 0.012;
      order = 0.95;
      baseAlpha = 0.8;
      breathe = still ? 0 : Math.sin(time * 1.6) * 0.02;
      break;
    case "SPEAKING":
      // Q's own voice moves the ring a little; less than the person's.
      spread = 1 + voice * 0.1;
      drift = 0.03;
      order = 0.7;
      baseAlpha = 0.75 + voice * 0.25;
      breathe = 0;
      break;
    case "ACTION": {
      // One purposeful sweep to the right and back, then rest.
      const t = Math.min(1, sinceState / 0.7);
      shear = Math.sin(t * Math.PI) * 0.35;
      spread = 1 - Math.sin(t * Math.PI) * 0.08;
      order = 0.9;
      baseAlpha = 0.85;
      breathe = 0;
      break;
    }
    case "SUCCESS": {
      // A single settle: out a touch, then home, slightly brighter.
      const t = Math.min(1, sinceState / 0.6);
      spread = 1 + Math.sin(t * Math.PI) * 0.06;
      order = 0.95;
      baseAlpha = 0.8;
      breathe = 0;
      break;
    }
    case "ERROR":
      // Disturbed, dimmer, never flashing.
      spread = 0.98;
      drift = still ? 0.05 : 0.07;
      order = 0.25;
      baseAlpha = 0.45;
      breathe = 0;
      break;
  }

  // Under reduced motion the formation is its resting shape for the state,
  // with the same per-particle offsets every time, and nothing moves.
  const ease = still ? 1000 : 6;

  for (const particle of particles) {
    const rest = home(particle, radius);
    const scale = spread + breathe;
    // Drift: a slow, per-particle wander whose amplitude the state sets.
    const wobble = still
      ? (particle.seed - 0.5) * drift * radius * 2
      : Math.sin(time * (0.6 + particle.seed * 0.5) + particle.phase) *
        drift *
        radius;
    const wobbleY = still
      ? (particle.phase / (Math.PI * 2) - 0.5) * drift * radius * 2
      : Math.cos(time * (0.5 + particle.seed * 0.4) + particle.phase) *
        drift *
        radius;
    // Order pulls the wander back toward the formation.
    const wx = wobble * (1 - order * 0.6);
    const wy = wobbleY * (1 - order * 0.6);
    // Rotation applies to the rings, not the tail — a turning tail reads
    // as a spinner, which this must never be.
    const cos = particle.orbit === 2 ? 1 : Math.cos(rotation);
    const sin = particle.orbit === 2 ? 0 : Math.sin(rotation);
    const rx = rest.x * cos - rest.y * sin;
    const ry = rest.x * sin + rest.y * cos;
    const targetX = rx * scale + wx + shear * radius * (0.6 + particle.seed);
    const targetY = ry * scale + wy;
    particle.x = approach(particle.x, targetX, ease, dt);
    particle.y = approach(particle.y, targetY, ease, dt);
    // The inner ring is quieter than the outer; the tail sits between.
    const orbitAlpha =
      particle.orbit === 0 ? 1 : particle.orbit === 1 ? 0.7 : 0.85;
    const targetAlpha = Math.min(
      1,
      baseAlpha * orbitAlpha * (0.75 + particle.seed * 0.35),
    );
    particle.alpha = approach(particle.alpha, targetAlpha, ease * 0.8, dt);
  }
}
