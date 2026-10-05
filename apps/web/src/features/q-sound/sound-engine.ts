import { HUM_MAX_MS, type QSound } from "./sound-rules";

/**
 * Q's sounds, synthesised with WebAudio (I2): no audio files. One family,
 * sine and soft triangle partials tuned to A (A3, E4, A4, E5), one short
 * dark room, peaks at or below -18 dBFS, nothing longer than a second
 * except the hum. The recipes are design B's sound board, kept as data
 * so the tests can hold their levels and lengths.
 *
 * The audio session is "ambient" where the browser supports it, so the
 * phone's silent switch and Focus modes win; sounds follow media volume.
 * The context is created on the first sound after a gesture, never on
 * load, and is suspended again when nothing plays.
 */

type Tone = {
  readonly kind: "tone";
  /** Hz, and an optional glide target. */
  readonly f: number;
  readonly f2?: number;
  /** Seconds after the sound starts. */
  readonly at: number;
  readonly length: number;
  readonly wave: "sine" | "triangle";
  /** dBFS at the peak. */
  readonly peak: number;
  readonly attack: number;
  /** Extra partials: [multiple of f, relative level]. */
  readonly partials: readonly (readonly [number, number])[];
};

type Bell = {
  readonly kind: "bell";
  readonly f: number;
  readonly at: number;
  readonly length: number;
  readonly peak: number;
};

export type SoundPart = Tone | Bell;

const tone = (
  f: number,
  options: Partial<Omit<Tone, "kind" | "f">> = {},
): Tone => ({
  kind: "tone",
  f,
  at: 0,
  length: 0.3,
  wave: "sine",
  peak: -20,
  attack: 0.012,
  partials: [[1, 1]],
  ...options,
});

/** Every short sound as notes. The hum is built live (it holds). */
export const SOUND_RECIPES: Readonly<
  Record<Exclude<QSound, "hum">, readonly SoundPart[]>
> = {
  // A soft fifth that rises, A4 to E5.
  wake: [
    tone(440, {
      f2: 659.25,
      length: 0.45,
      attack: 0.03,
      partials: [
        [1, 1],
        [2, 0.18],
      ],
    }),
  ],
  // Two quick notes up, E5 then A5.
  listenOn: [
    tone(659.25, { length: 0.12, wave: "triangle", peak: -22 }),
    tone(880, { at: 0.09, length: 0.16, wave: "triangle", peak: -22 }),
  ],
  // The same two notes, down.
  listenOff: [
    tone(880, { length: 0.12, wave: "triangle", peak: -24 }),
    tone(659.25, { at: 0.09, length: 0.16, wave: "triangle", peak: -24 }),
  ],
  // A small bell on A5 with a soft octave under it.
  ping: [
    { kind: "bell", f: 880, at: 0, length: 0.9, peak: -20 },
    tone(440, { length: 0.7, peak: -30, attack: 0.01 }),
  ],
  // Two soft knocks on A4.
  needs: [
    tone(440, {
      length: 0.12,
      peak: -22,
      partials: [
        [1, 1],
        [3, 0.08],
      ],
    }),
    tone(440, {
      at: 0.16,
      length: 0.16,
      peak: -24,
      partials: [
        [1, 1],
        [3, 0.08],
      ],
    }),
  ],
  // Two muted notes down a semitone, low and short: never a buzzer.
  error: [
    tone(392, { length: 0.18, wave: "triangle", peak: -24 }),
    tone(369.99, { at: 0.17, length: 0.24, wave: "triangle", peak: -26 }),
  ],
  // Sent: one light tick up from E5, quieter than anything Q says back.
  sent: [tone(659.25, { f2: 880, length: 0.14, wave: "sine", peak: -28 })],
};

/** The hum's level and its partials: a low, warm A2 and E3 that breathes. */
export const HUM = {
  peak: -34,
  settle: -40,
  partials: [
    [110, 1, "sine"],
    [164.81, 0.6, "sine"],
    [220.4, 0.18, "triangle"],
  ] as const,
} as const;

const db = (value: number) => Math.pow(10, value / 20);

type Engine = {
  readonly context: AudioContext;
  readonly master: GainNode;
};

let engine: Engine | null = null;
let stopHum: (() => void) | null = null;
let humTimer: number | null = null;

function ambientSession(): void {
  // Safari 17+: an ambient session respects the silent switch.
  const session = (navigator as Navigator & { audioSession?: { type: string } })
    .audioSession;
  if (session !== undefined) {
    try {
      session.type = "ambient";
    } catch {
      // Not supported: sounds follow media volume as usual.
    }
  }
}

function start(): Engine | null {
  if (engine !== null) return engine;
  if (typeof window === "undefined" || typeof AudioContext === "undefined") {
    return null;
  }
  ambientSession();
  const context = new AudioContext({ latencyHint: "interactive" });
  const master = context.createGain();
  master.gain.value = 0.9;
  // A short, dark room from decaying noise: depth without a wash.
  const length = Math.floor(context.sampleRate * 1.1);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.2);
    }
  }
  const room = context.createConvolver();
  room.buffer = impulse;
  const wet = context.createGain();
  wet.gain.value = 0.22;
  const low = context.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 3800;
  master.connect(low);
  low.connect(context.destination);
  master.connect(room);
  room.connect(wet);
  wet.connect(low);
  engine = { context, master };
  return engine;
}

function playTone(e: Engine, part: Tone): void {
  const now = e.context.currentTime + part.at;
  for (const [multiple, level] of part.partials) {
    const osc = e.context.createOscillator();
    const gain = e.context.createGain();
    osc.type = part.wave;
    osc.frequency.setValueAtTime(part.f * multiple, now);
    if (part.f2 !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(
        part.f2 * multiple,
        now + part.length * 0.4,
      );
    }
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(db(part.peak) * level, now + part.attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + part.length);
    osc.connect(gain);
    gain.connect(e.master);
    osc.start(now);
    osc.stop(now + part.length + 0.05);
  }
}

function playBell(e: Engine, part: Bell): void {
  const now = e.context.currentTime + part.at;
  const carrier = e.context.createOscillator();
  const modulator = e.context.createOscillator();
  const depth = e.context.createGain();
  const gain = e.context.createGain();
  carrier.frequency.value = part.f;
  modulator.frequency.value = part.f * 3.5;
  depth.gain.setValueAtTime(part.f * 1.2, now);
  depth.gain.exponentialRampToValueAtTime(1, now + part.length * 0.6);
  modulator.connect(depth);
  depth.connect(carrier.frequency);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(db(part.peak), now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + part.length);
  carrier.connect(gain);
  gain.connect(e.master);
  carrier.start(now);
  modulator.start(now);
  carrier.stop(now + part.length + 0.05);
  modulator.stop(now + part.length + 0.05);
}

/** Plays a short sound. Silently does nothing where WebAudio is missing. */
export function playSound(sound: Exclude<QSound, "hum">): void {
  const e = start();
  if (e === null) return;
  void e.context.resume().catch(() => undefined);
  for (const part of SOUND_RECIPES[sound]) {
    if (part.kind === "tone") playTone(e, part);
    else playBell(e, part);
  }
}

/** Starts the thinking hum; it softens after 5 s and stops by itself at 20 s. */
export function startHum(): void {
  if (stopHum !== null) return;
  const e = start();
  if (e === null) return;
  void e.context.resume().catch(() => undefined);
  const { context } = e;
  const now = context.currentTime;
  const out = context.createGain();
  out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(db(HUM.peak), now + 0.6);
  out.gain.setTargetAtTime(db(HUM.settle), now + 5, 1.5);
  const low = context.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 520;
  low.Q.value = 0.4;
  const breath = context.createOscillator();
  const breathDepth = context.createGain();
  breath.frequency.value = 0.22;
  breathDepth.gain.value = db(-40);
  breath.connect(breathDepth);
  breathDepth.connect(out.gain);
  const oscillators = HUM.partials.map(([frequency, level, wave]) => {
    const osc = context.createOscillator();
    osc.type = wave;
    osc.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.value = level;
    osc.connect(gain);
    gain.connect(low);
    osc.start();
    return osc;
  });
  low.connect(out);
  out.connect(e.master);
  breath.start();
  stopHum = () => {
    const t = context.currentTime;
    out.gain.cancelScheduledValues(t);
    out.gain.setValueAtTime(out.gain.value, t);
    out.gain.linearRampToValueAtTime(0, t + 0.4);
    for (const osc of [...oscillators, breath]) osc.stop(t + 0.45);
  };
  humTimer = window.setTimeout(endHum, HUM_MAX_MS);
}

/** Stops the hum, gently, if it is playing. */
export function endHum(): void {
  if (humTimer !== null) window.clearTimeout(humTimer);
  humTimer = null;
  const stop = stopHum;
  stopHum = null;
  stop?.();
}

export function humPlaying(): boolean {
  return stopHum !== null;
}
