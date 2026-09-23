import type { QPresenceState } from "./presence-state";

/**
 * The swarm behind Q's presence.
 *
 * Not a letter. A loose annulus of points — a band, with a sparser cloud
 * inside it — whose radius, density and coherence carry what Q is doing.
 * At rest the band is loose and drifting; the person's voice opens and
 * loosens it; Q's thinking draws it in, tightens it into near-order and
 * turns it; Q's own voice pulses it outward in rhythm; an action sweeps
 * it once to the side; a settle pulses it once and stills it; an error
 * scatters and dims it — never reddens, never flashes.
 *
 * Pure arithmetic over a plain array; no DOM here. The component owns the
 * canvas and the clock. Deterministic per particle (seeded), so the same
 * presence looks the same on every mount, and the still frame under
 * reduced motion is the same still frame every time.
 */

export type Particle = {
  /** Angle on the annulus, radians. */
  readonly angle: number;
  /** Which population: 0 the band, 1 the inner cloud. */
  readonly orbit: 0 | 1;
  /** Where in its population's radial range this particle rests, 0..1. */
  readonly depth: number;
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
  /** Outer radius of the band at rest, in canvas units. */
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

/** The band occupies this share of the radius; the cloud sits inside it. */
const BAND_INNER = 0.66;
const BAND_OUTER = 1;
const CLOUD_INNER = 0.12;
const CLOUD_OUTER = 0.52;
/** Where the band gathers when it is fully coherent. */
const BAND_MEAN = 0.84;

/**
 * Lay the particles out. The count is the caller's (it follows the size);
 * roughly three quarters form the band, the rest the inner cloud.
 */
export function createFormation(count: number, radius: number): Formation {
  const random = seeded(7);
  const particles: Particle[] = [];
  const cloud = Math.max(6, Math.round(count * 0.26));
  const band = Math.max(12, count - cloud);
  const push = (angle: number, orbit: 0 | 1) => {
    particles.push({
      angle,
      orbit,
      depth: random(),
      phase: random() * Math.PI * 2,
      seed: random(),
      x: 0,
      y: 0,
      alpha: 0,
    });
  };
  for (let i = 0; i < band; i += 1) {
    // Evenly spread with jitter, so the band reads as a swarm and never
    // as a dotted line.
    push(((i + (random() - 0.5) * 0.7) / band) * Math.PI * 2, 0);
  }
  for (let i = 0; i < cloud; i += 1) {
    push(random() * Math.PI * 2, 1);
  }
  return { particles, radius };
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
  /** Overall scale of the field. */
  let spread = 1;
  /** Rotation of the band, radians. */
  let rotation = 0;
  /** Amplitude of per-particle wander, as a share of the radius. */
  let drift = 0.035;
  /** 0 loose cloud … 1 a near-perfect ring. */
  let coherence = 0.25;
  /** Sideways sweep, as a share of the radius. */
  let shear = 0;
  let baseAlpha = 0.55;
  let breathe = still ? 0 : Math.sin(time * 0.55) * 0.012;

  switch (state) {
    case "IDLE":
      break;
    case "LISTENING":
      // Opens with the voice: wider, looser, brighter — receptive.
      spread = 1.04 + level * 0.2;
      drift = 0.05 + level * 0.05;
      coherence = 0.15;
      baseAlpha = 0.7 + level * 0.3;
      breathe = 0;
      break;
    case "THINKING":
      // Draws in, tightens toward order, and turns: work, not waiting.
      spread = 0.84;
      rotation = still ? 0 : time * 0.5;
      drift = 0.012;
      coherence = 0.9;
      baseAlpha = 0.8;
      breathe = still ? 0 : Math.sin(time * 1.6) * 0.02;
      break;
    case "SPEAKING":
      // Q's own voice pulses the field outward in rhythm; gathered enough
      // to read as one voice, looser than thought.
      spread = 1 + voice * 0.14;
      drift = 0.03;
      coherence = 0.55;
      baseAlpha = 0.75 + voice * 0.25;
      breathe = 0;
      break;
    case "ACTION": {
      // One purposeful sweep to the right and back, then rest.
      const t = Math.min(1, sinceState / 0.7);
      shear = Math.sin(t * Math.PI) * 0.35;
      spread = 1 - Math.sin(t * Math.PI) * 0.08;
      coherence = 0.8;
      baseAlpha = 0.85;
      breathe = 0;
      break;
    }
    case "SUCCESS": {
      // A single settle: out a touch, then home, gathered and brighter.
      const t = Math.min(1, sinceState / 0.6);
      spread = 1 + Math.sin(t * Math.PI) * 0.06;
      coherence = 0.85;
      baseAlpha = 0.8;
      breathe = 0;
      break;
    }
    case "ERROR":
      // Scattered, dimmer, never flashing.
      spread = 0.98;
      drift = still ? 0.06 : 0.08;
      coherence = 0;
      baseAlpha = 0.45;
      breathe = 0;
      break;
  }

  // Under reduced motion the formation is its resting shape for the state,
  // with the same per-particle offsets every time, and nothing moves.
  const ease = still ? 1000 : 6;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  for (const particle of particles) {
    // Where this particle rests in its population's radial range, pulled
    // toward the band's mean as coherence rises. The cloud gathers too,
    // but keeps its own inner place: it never joins the band.
    const loose =
      particle.orbit === 0
        ? BAND_INNER + (BAND_OUTER - BAND_INNER) * particle.depth
        : CLOUD_INNER + (CLOUD_OUTER - CLOUD_INNER) * particle.depth;
    // The cloud gathers less than the band, so an ordered field is a ring
    // around a cluster and never a bullseye.
    const gathered = particle.orbit === 0 ? BAND_MEAN : CLOUD_OUTER * 0.7;
    const pull = particle.orbit === 0 ? coherence : coherence * 0.5;
    const r = (loose + (gathered - loose) * pull) * radius;
    const rx = Math.cos(particle.angle) * r;
    const ry = Math.sin(particle.angle) * r;
    // Drift: a slow, per-particle wander whose amplitude the state sets;
    // coherence damps it so an ordered field is also a calmer one.
    const wander = drift * radius * (1 - coherence * 0.7);
    const wx = still
      ? (particle.seed - 0.5) * wander * 2
      : Math.sin(time * (0.6 + particle.seed * 0.5) + particle.phase) * wander;
    const wy = still
      ? (particle.phase / (Math.PI * 2) - 0.5) * wander * 2
      : Math.cos(time * (0.5 + particle.seed * 0.4) + particle.phase) * wander;
    const scale = spread + breathe;
    const targetX =
      (rx * cos - ry * sin) * scale +
      wx +
      shear * radius * (0.6 + particle.seed);
    const targetY = (rx * sin + ry * cos) * scale + wy;
    particle.x = approach(particle.x, targetX, ease, dt);
    particle.y = approach(particle.y, targetY, ease, dt);
    // The cloud is quieter than the band.
    const orbitAlpha = particle.orbit === 0 ? 1 : 0.6;
    const targetAlpha = Math.min(
      1,
      baseAlpha * orbitAlpha * (0.75 + particle.seed * 0.35),
    );
    particle.alpha = approach(particle.alpha, targetAlpha, ease * 0.8, dt);
  }
}
