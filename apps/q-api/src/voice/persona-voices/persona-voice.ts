import type { QVoiceChoice } from "@capital-q/contracts";

import type {
  SentencePerformance,
  SpeechIntensity,
  SpeechTone,
} from "../speech-performance.js";
import {
  accentForPlace,
  CATALOG_VOICE_IDS,
  pickVoice,
  shapeForAge,
  type AccentKey,
  type AgeGroup,
} from "./catalog.js";

/**
 * REHEARSE: how the person Q plays sounds, from what Q already prepared
 * about them (Kuuza's persona voice config, carried over).
 *
 * Inputs are only what Q holds before the call:
 *   - the voice the person chose in the lobby (male or female); Q never
 *     guesses a gender from a name;
 *   - where the counterpart is based (an investor's HQ country, a
 *     company's HQ, a researched person's public location). An unknown
 *     place stays unknown and the voice is a neutral American or British
 *     one; a nationality is never invented;
 *   - an age band, when one is known (none is today: unknown changes
 *     nothing);
 *   - their patience from the persona's conduct reading, which sets pace
 *     and how quickly they take their turn.
 *
 * Emotion is per line, from the turn's typed mood (rehearsal-temperament):
 * audio tags on v3, voice settings on the turbo models (`toneSettings`).
 */

/** Kuuza's persona voice settings: steady enough for a long call, still alive. */
export const PERSONA_STABILITY = 0.65;
export const PERSONA_SIMILARITY = 0.85;

export type Patience = "SHORT" | "TYPICAL" | "LONG";

/** How quickly the line ends a person's turn (Deepgram Flux end of turn). */
export type TurnTaking = "PATIENT" | "NORMAL" | "EAGER";

export type PersonaVoiceInput = {
  /** Steady per counterpart ("KIND:id"): keeps their voice the same. */
  readonly seed: string;
  readonly voice: QVoiceChoice;
  /** Where they are based, free text or a country code; null when unknown. */
  readonly basedIn: string | null;
  readonly ageGroup: AgeGroup | null;
  readonly patience: Patience | null;
};

export type PersonaVoice = {
  readonly voiceId: string;
  /** The accent the voice speaks with. */
  readonly accent: AccentKey;
  /** What the place asked for; null when the place was unknown (neutral). */
  readonly wanted: AccentKey | null;
  readonly fellBack: boolean;
  readonly speed: number;
  readonly stability: number;
  readonly turnTaking: TurnTaking;
};

const PACE: Readonly<Record<Patience, number>> = {
  SHORT: 1.06,
  TYPICAL: 1,
  LONG: 0.95,
};

const TURNS: Readonly<Record<Patience, TurnTaking>> = {
  SHORT: "EAGER",
  TYPICAL: "NORMAL",
  LONG: "PATIENT",
};

/** The persona's voice; null only when the catalog has no voice at all. */
export function personaVoiceFor(input: PersonaVoiceInput): PersonaVoice | null {
  const wanted = accentForPlace(input.basedIn);
  const pick = pickVoice({
    accent: wanted,
    gender: input.voice === "FEMALE" ? "female" : "male",
    ageGroup: input.ageGroup,
    seed: input.seed,
  });
  if (pick === null) return null;
  const shaped = shapeForAge(
    {
      speed: PACE[input.patience ?? "TYPICAL"],
      stability: PERSONA_STABILITY,
    },
    input.ageGroup,
  );
  return {
    voiceId: pick.voice.id,
    accent: pick.accent,
    wanted,
    fellBack: pick.fellBack,
    speed: shaped.speed,
    stability: shaped.stability,
    turnTaking: TURNS[input.patience ?? "TYPICAL"],
  };
}

/**
 * The persona's voice as the session binding carries it (sealed, never
 * from a request): "<voiceId>" or "<voiceId>;<speed>;<stability>".
 */
export function personaVoiceSpec(voice: PersonaVoice): string {
  return `${voice.voiceId};${voice.speed.toFixed(2)};${voice.stability.toFixed(2)}`;
}

export type ParsedPersonaVoice = {
  readonly voiceId: string;
  /** Present for a catalog persona voice; absent for a legacy bare id. */
  readonly speed?: number | undefined;
  readonly stability?: number | undefined;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** A spec read back; a bare id (older binding) parses with no settings. */
export function parsePersonaVoiceSpec(spec: string): ParsedPersonaVoice {
  const [voiceId = "", speed, stability] = spec.split(";");
  const s = speed === undefined ? Number.NaN : Number(speed);
  const t = stability === undefined ? Number.NaN : Number(stability);
  return {
    voiceId,
    ...(Number.isFinite(s) ? { speed: clamp(s, 0.7, 1.2) } : {}),
    ...(Number.isFinite(t) ? { stability: clamp(t, 0, 1) } : {}),
  };
}

/** Whether an id is a catalog persona voice. */
export function isCatalogVoice(id: string): boolean {
  return CATALOG_VOICE_IDS.has(id);
}

/** Voice settings for one line on a model without audio tags. */
export type ToneSettings = {
  readonly stability?: number | undefined;
  readonly style?: number | undefined;
  /** Multiplies the persona's own speed. */
  readonly pace?: number | undefined;
};

/**
 * Emotion on a model that does not take audio tags (v4 turbo, flash,
 * turbo v2.5): lower stability lets the voice move, `style` exaggerates
 * the speaker's own delivery, and pace carries impatience or hesitation.
 * Shades, not a different voice: no setting here makes the voice read
 * anything aloud, and a neutral line is the voice as it is.
 */
const TONE: Readonly<Record<SpeechTone, ToneSettings>> = {
  WARM: { stability: 0.5, style: 0.25, pace: 0.98 },
  SKEPTICAL: { stability: 0.5, style: 0.3, pace: 0.97 },
  IMPATIENT: { stability: 0.45, style: 0.35, pace: 1.08 },
  ANNOYED: { stability: 0.4, style: 0.4, pace: 1.04 },
  ANGRY: { stability: 0.3, style: 0.6, pace: 1.06 },
  ENTHUSIASTIC: { stability: 0.35, style: 0.5, pace: 1.06 },
  COLD: { stability: 0.75, style: 0.1, pace: 0.96 },
  INDIFFERENT: { stability: 0.8, style: 0, pace: 0.97 },
  SAD: { stability: 0.45, style: 0.35, pace: 0.92 },
  AUTHORITATIVE: { stability: 0.6, style: 0.3, pace: 0.97 },
  MEEK: { stability: 0.5, style: 0.2, pace: 0.94 },
  SARCASTIC: { stability: 0.45, style: 0.45, pace: 1 },
  AMUSED: { stability: 0.45, style: 0.4, pace: 1.02 },
  HAPPY: { stability: 0.45, style: 0.4, pace: 1.03 },
  DISAPPOINTED: { stability: 0.5, style: 0.3, pace: 0.95 },
};

const LOUDNESS: Readonly<Record<SpeechIntensity, ToneSettings>> = {
  SOFT: { stability: 0.6, style: 0.1, pace: 0.96 },
  NORMAL: {},
  RAISED: { stability: 0.25, style: 0.7, pace: 1.05 },
};

export function toneSettings(
  performance: Pick<SentencePerformance, "tone" | "intensity">,
): ToneSettings | undefined {
  const tone =
    performance.tone === null || performance.tone === undefined
      ? undefined
      : TONE[performance.tone];
  const loud = LOUDNESS[performance.intensity ?? "NORMAL"];
  if (tone === undefined && loud.stability === undefined) return undefined;
  // A raised voice overrides the tone's own steadiness; pace compounds.
  return {
    stability: loud.stability ?? tone?.stability,
    style: Math.max(loud.style ?? 0, tone?.style ?? 0),
    pace: (tone?.pace ?? 1) * (loud.pace ?? 1),
  };
}

/**
 * Whether a line is worth v3's extra latency: a laugh, a sigh, crying or a
 * raised voice, which the turbo models cannot do. Ordinary lines stay on
 * the fast model.
 */
export function expressivePeak(
  performances: readonly Pick<
    SentencePerformance,
    "reaction" | "intensity" | "tone"
  >[],
): boolean {
  return performances.some(
    (p) =>
      p.reaction !== null ||
      p.intensity === "RAISED" ||
      p.tone === "ANGRY" ||
      p.tone === "SAD",
  );
}
