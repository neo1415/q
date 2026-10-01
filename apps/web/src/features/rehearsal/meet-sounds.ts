/**
 * Meeting sounds for the rehearsal room (founder live test 2026-10-01:
 * "join chime, the other side leaving, hand raise, screen-share start",
 * and the call ending with a leave sound). Synthesised here with WebAudio
 * as short, quiet sine notes -- never Google's audio assets, never a file.
 *
 * Quiet by design (peak gain well under a tenth of full scale), off when
 * the person turned meeting sounds off, and off by default when they ask
 * the system for reduced motion -- they can still turn them on.
 */

export const MEET_SOUNDS = [
  "JOIN",
  "LEAVE",
  "THEY_LEFT",
  "HAND",
  "SHARE",
] as const;
export type MeetSound = (typeof MEET_SOUNDS)[number];

export type Note = {
  /** Hz. */
  readonly frequency: number;
  /** Seconds from the start of the sound. */
  readonly at: number;
  /** Seconds. */
  readonly length: number;
};

/** Peak gain of any note: quiet next to a voice at full level. */
export const MEET_SOUND_GAIN = 0.06;

/**
 * Each sound as notes: a rising pair to join, a falling pair to leave,
 * a single soft note for a hand, a quick rise for presenting.
 */
export const MEET_SOUND_NOTES: Readonly<Record<MeetSound, readonly Note[]>> = {
  JOIN: [
    { frequency: 660, at: 0, length: 0.14 },
    { frequency: 880, at: 0.12, length: 0.22 },
  ],
  LEAVE: [
    { frequency: 784, at: 0, length: 0.14 },
    { frequency: 523, at: 0.13, length: 0.26 },
  ],
  THEY_LEFT: [
    { frequency: 659, at: 0, length: 0.14 },
    { frequency: 494, at: 0.13, length: 0.24 },
  ],
  HAND: [{ frequency: 988, at: 0, length: 0.16 }],
  SHARE: [
    { frequency: 587, at: 0, length: 0.09 },
    { frequency: 740, at: 0.08, length: 0.09 },
    { frequency: 880, at: 0.16, length: 0.16 },
  ],
};

/** How long a sound lasts, in milliseconds, so a leave can wait for it. */
export function meetSoundMs(sound: MeetSound): number {
  const notes = MEET_SOUND_NOTES[sound];
  return Math.ceil(Math.max(...notes.map((n) => n.at + n.length)) * 1_000);
}

const PREFERENCE_KEY = "cq.rehearsal.sounds";

/**
 * Whether meeting sounds play: the person's own choice when they made one,
 * otherwise on -- unless they ask the system for reduced motion.
 */
export function meetSoundsOn(
  stored: string | null,
  reducedMotion: boolean,
): boolean {
  if (stored === "on") return true;
  if (stored === "off") return false;
  return !reducedMotion;
}

function storedPreference(): string | null {
  try {
    return window.localStorage.getItem(PREFERENCE_KEY);
  } catch {
    return null;
  }
}

export function readMeetSoundsPreference(): boolean {
  if (typeof window === "undefined") return false;
  const stored = storedPreference();
  const reduced =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return meetSoundsOn(stored, reduced);
}

export function saveMeetSoundsPreference(on: boolean): void {
  try {
    window.localStorage.setItem(PREFERENCE_KEY, on ? "on" : "off");
  } catch {
    // A private window: the choice lasts this visit only.
  }
}

let context: AudioContext | null = null;

/** Plays a sound when sounds are on; silent when the browser has no audio. */
export function playMeetSound(sound: MeetSound, on: boolean): void {
  if (!on || typeof window === "undefined") return;
  const Context = window.AudioContext as typeof AudioContext | undefined;
  if (Context === undefined) return;
  try {
    context ??= new Context();
    if (context.state === "suspended") void context.resume();
    const start = context.currentTime + 0.02;
    for (const note of MEET_SOUND_NOTES[sound]) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = "sine";
      osc.frequency.value = note.frequency;
      const t0 = start + note.at;
      const t1 = t0 + note.length;
      // A soft attack and decay: no click, no harsh edge.
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(MEET_SOUND_GAIN, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t1);
      osc.connect(gain).connect(context.destination);
      osc.start(t0);
      osc.stop(t1 + 0.02);
    }
  } catch {
    // Audio blocked or unavailable: the meeting carries on in silence.
  }
}
