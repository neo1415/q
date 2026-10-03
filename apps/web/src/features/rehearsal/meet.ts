import type {
  QRehearsalPersonaDto,
  QRehearsalReviewDto,
  RehearsalOutcome,
} from "@capital-q/contracts";

/**
 * Pure pieces of the rehearsal room (REHEARSE, founder direction
 * 2026-10-01): the clock, the timer, the words for an outcome, initials for
 * a tile, and the shared-screen change test. No React, no browser APIs.
 */

/** "10:32" in the person's own locale. */
export function clockLabel(at: Date, locale?: string): string {
  return at.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

/** "4:07" or "1:02:09" since the call began. */
export function elapsedLabel(fromMs: number, nowMs: number): string {
  const total = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, "0");
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, "0")}:${ss}`
    : `${String(minutes)}:${ss}`;
}

/**
 * How long the rehearsal ran, for its review: seconds under a minute
 * (QA 064ff78f: "Length 0 min" beside a 0:24 header), minutes after.
 */
export function lengthWords(
  createdAt: string,
  endedAt: string | null,
  minutes: number,
): string {
  if (endedAt !== null) {
    const seconds = Math.max(
      0,
      Math.round((Date.parse(endedAt) - Date.parse(createdAt)) / 1_000),
    );
    if (Number.isFinite(seconds) && seconds < 60) {
      return `${String(seconds)} sec`;
    }
  }
  return `${String(minutes)} min`;
}

export function initialsOf(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const first = words[0]?.[0] ?? "?";
  const second = words.length > 1 ? (words.at(-1)?.[0] ?? "") : "";
  return `${first}${second}`.toUpperCase();
}

export const OUTCOME_WORDS: Readonly<Record<RehearsalOutcome, string>> = {
  INDECISIVE: "Undecided",
  STRONG_LATER: "Strong chance later",
  ADJOURNED: "Adjourned: something was missing",
  DEAL_AGREED: "Deal agreed",
  DECLINED: "They passed",
  LEFT_EARLY: "Ended early",
  FOUNDER_ENDED: "You ended the meeting",
};

export const DIMENSION_WORDS: Readonly<
  Record<QRehearsalReviewDto["dimensions"][number]["name"], string>
> = {
  CLARITY: "Clarity",
  EVIDENCE: "Evidence",
  HANDLING_PUSHBACK: "Handling pushback",
  FIT_TO_THIS_PERSON: "Fit to this person",
  THE_ASK: "The ask",
  QUESTION_QUALITY: "Question quality",
  RAPPORT: "Rapport",
  NEXT_STEPS: "Next steps",
  DILIGENCE: "Diligence",
  CONTROL: "Control of the meeting",
  FAIRNESS: "Fairness",
  DECISION_CLARITY: "Decision clarity",
  PROFESSIONALISM: "Professionalism",
};

export const RATING_WORDS = {
  STRONG: "Strong",
  SOLID: "Solid",
  NEEDS_WORK: "Needs work",
} as const;

/**
 * Whether a shared screen changed enough to show the other person again.
 * Signatures are small greyscale thumbnails (one byte per pixel); a slide
 * change moves many pixels a lot, a blinking cursor moves a few a little.
 */
export function screenChanged(
  previous: Uint8Array | null,
  next: Uint8Array,
  threshold = 6,
): boolean {
  if (previous === null || previous.length !== next.length) return true;
  let total = 0;
  for (let index = 0; index < next.length; index += 1) {
    total += Math.abs((next[index] ?? 0) - (previous[index] ?? 0));
  }
  return total / next.length >= threshold;
}

/** RGBA pixels to one grey byte each (Rec. 601 luma). */
export function greySignature(rgba: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(Math.floor(rgba.length / 4));
  for (let index = 0; index < out.length; index += 1) {
    const r = rgba[index * 4] ?? 0;
    const g = rgba[index * 4 + 1] ?? 0;
    const b = rgba[index * 4 + 2] ?? 0;
    out[index] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return out;
}

/** After this long with nobody speaking, the played person reacts once. */
export const SILENCE_MS = 25_000;

/**
 * Whether to tell the played person the line has gone quiet: only while
 * the line is listening (not while they speak or think), only once per
 * silence, never with the microphone off (the person chose quiet) and
 * never after the meeting ended.
 */
export function shouldNudgeSilence(input: {
  readonly state: string;
  readonly lastActivityMs: number;
  readonly nowMs: number;
  readonly alreadyNudged: boolean;
  readonly micOn: boolean;
  readonly ended: boolean;
}): boolean {
  return (
    input.state === "LISTENING" &&
    input.nowMs - input.lastActivityMs > SILENCE_MS &&
    !input.alreadyNudged &&
    input.micOn &&
    !input.ended
  );
}

/**
 * How the played person sounds right now, as a quiet word on their tile
 * (founder ask 2026-10-01: the tile reflects the mood, subtly). Neutral
 * says nothing.
 */
export const MOOD_WORDS: Readonly<Record<string, string>> = {
  WARM: "warm",
  HAPPY: "smiling",
  ENTHUSIASTIC: "excited",
  AMUSED: "amused",
  SKEPTICAL: "sceptical",
  IMPATIENT: "impatient",
  ANNOYED: "annoyed",
  ANGRY: "angry",
  COLD: "cold",
  INDIFFERENT: "unmoved",
  DISAPPOINTED: "disappointed",
  SAD: "upset",
  MEEK: "hesitant",
  AUTHORITATIVE: "firm",
  SARCASTIC: "sarcastic",
};

/** The tile's mood word for their latest line, with a raised voice or tears. */
export function moodWord(
  turn:
    | {
        readonly mood: string | null;
        readonly intensity?: string | undefined;
        readonly reaction?: string | null | undefined;
      }
    | undefined,
): string | null {
  if (turn === undefined || turn.mood === null) return null;
  if (turn.reaction === "CRY") return "in tears";
  if (turn.intensity === "RAISED") return "raising their voice";
  if (turn.reaction === "LAUGH") return "laughing";
  return MOOD_WORDS[turn.mood] ?? null;
}

/**
 * Who leads the meeting and how forward Q reads the person, in words for
 * the lobby (founder live test 2026-10-01). Q's reading, said as one.
 */
export function stanceWords(
  stance: QRehearsalPersonaDto["stance"],
  name: string,
): string {
  const lead =
    stance.leads === "THEM"
      ? `${name} holds the leverage here: you're pitching, so expect them to lead and set the pace.`
      : `You hold the leverage here: ${name} is pitching to you, so they'll answer first and keep their own questions for later.`;
  const why =
    stance.why === null || stance.why === "" ? "" : ` (${stance.why})`;
  const read =
    stance.forwardness === "FORWARD"
      ? ` Q reads them as forward${why}, so they may push back sooner.`
      : stance.forwardness === "RESERVED"
        ? ` Q reads them as reserved${why}.`
        : "";
  return lead + read;
}

export const TRAIT_SOURCE_WORDS: Readonly<
  Record<QRehearsalPersonaDto["traits"][number]["source"], string>
> = {
  PROFILE: "their profile",
  MESSAGES: "their messages",
  CALLS: "your calls",
  PUBLIC: "public sources",
  PITCH: "their pitch",
};

/** The consent, word for word, in the lobby and the room. */
export const SEE_YOU_CONSENT =
  "Let Q see you on camera (frames are analysed for this rehearsal only and never stored)";

/**
 * A fresh frame goes up with every turn they take (a few seconds apart at
 * most, so a voice turn's partials send one), so a turn that asks Q to look
 * ("can you see this?") has a frame from just now. Uploading costs nothing;
 * the server decides when a frame is worth a look (every 8 s, or on an ask).
 */
export const LOOK_MIN_GAP_MS = 2_000;
/** Between turns, one idle look at most this often. */
export const LOOK_IDLE_MS = 30_000;
export const LOOK_WIDTH = 512;
export const LOOK_QUALITY = 0.6;

/**
 * Whether to send a camera frame now: only with consent and the camera on,
 * never more often than the gap, and between turns only once per idle
 * period.
 */
export function shouldLook(input: {
  readonly consent: boolean;
  readonly cameraOn: boolean;
  readonly ended: boolean;
  readonly lastLookMs: number;
  readonly nowMs: number;
  readonly reason: "TURN" | "IDLE";
}): boolean {
  if (!input.consent || !input.cameraOn || input.ended) return false;
  const gap = input.nowMs - input.lastLookMs;
  return input.reason === "TURN" ? gap >= LOOK_MIN_GAP_MS : gap >= LOOK_IDLE_MS;
}

/** After the goodbye has been heard, a beat before they leave. */
export const GOODBYE_PAUSE_MS = 1_400;
/** The goodbye's audio usually starts within this of the line arriving. */
export const GOODBYE_START_MS = 4_000;
/** Never wait longer than this for a goodbye to finish. */
export const GOODBYE_MAX_MS = 25_000;

/**
 * Whether the other person may leave now (founder live 2026-10-02: they
 * left mid-sentence, cutting off their own goodbye). On a voice line: once
 * their goodbye has been heard and the line has been quiet for a beat --
 * or, if no audio came at all, a beat after it should have started. Typed:
 * a beat after the close. Never later than the cap.
 */
export function readyToLeave(input: {
  readonly nowMs: number;
  readonly endedAtMs: number;
  readonly voiceLine: boolean;
  /** Last time their voice was heard (speaking state or output level). */
  readonly lastSoundMs: number;
  readonly speaking: boolean;
}): boolean {
  const since = input.nowMs - input.endedAtMs;
  if (since >= GOODBYE_MAX_MS) return true;
  if (!input.voiceLine) return since >= GOODBYE_PAUSE_MS;
  if (input.speaking) return false;
  const heard = input.lastSoundMs >= input.endedAtMs - 2_000;
  if (heard) return input.nowMs - input.lastSoundMs >= GOODBYE_PAUSE_MS;
  return since >= GOODBYE_START_MS + GOODBYE_PAUSE_MS;
}
