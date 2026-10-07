import { z } from "zod";

import type { QVisibleStage } from "./stage.js";

/**
 * The silence ladder (ADR 0062; Q room R7: "never an awkward silence").
 *
 * While a Q run is still working and nothing of the answer has been heard,
 * Q fills the wait the way a colleague would, decided here in code and
 * never by a model:
 *
 *   0.7 s   a soft tone (the browser plays it; sound settings apply)
 *   1.5 s   one line about what Q is actually doing, from the run's real
 *           visible stage and, when code knows it, the subject's name
 *   4 s     a progress line; then every 6 s a hum, a line, or (past 8 s)
 *           one remembered small-talk thread; never more than three
 *
 * Quiet while the person speaks, once the answer has started, and while an
 * approval is waiting. Pure and shared: the server's voice turn and the
 * browser's duplex line run the same decisions, and a fake clock tests
 * every rung. Lines are composed from parts (opener x verb x object x
 * tail) with a seeded choice, so phrasing varies without a fixed short
 * list, and the same line never comes twice running. They name only the
 * approved visible stages: never a specialist, a tool or a prompt.
 */

export const Q_SILENCE_LADDER = {
  toneAtMs: 700,
  stageLineAtMs: 1_500,
  progressAtMs: 4_000,
  progressEveryMs: 6_000,
  /** Beats after the stage line: progress lines, hums and the one thread. */
  maxLaterBeats: 3,
  /** The remembered thread is for a long wait only. */
  threadAfterMs: 8_000,
} as const;

/** What the subject is, in a word, when code knows it. */
export const Q_SILENCE_THINGS = [
  "profile",
  "deck",
  "pitch",
  "data room",
  "document",
  "documents",
  "chat",
  "mandate",
  "calendar",
  "round",
] as const;
export type QSilenceThing = (typeof Q_SILENCE_THINGS)[number];

/** The subject of the wait: a name its own service gave, never a model's. */
export const QSilenceFocusSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    thing: z.enum(Q_SILENCE_THINGS).optional(),
  })
  .strict();
export type QSilenceFocus = z.infer<typeof QSilenceFocusSchema>;

export const Q_SILENCE_BEAT_KINDS = [
  "TONE",
  "STAGE_LINE",
  "PROGRESS_LINE",
  "HUM",
  "THREAD",
] as const;
export type QSilenceBeatKind = (typeof Q_SILENCE_BEAT_KINDS)[number];

/** Flat or sing-song: how a voiced hum is written for the voice. */
export const Q_HUM_STYLES = ["FLAT", "SING_SONG"] as const;
export type QHumStyle = (typeof Q_HUM_STYLES)[number];

export const QSilenceBeatSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TONE") }).strict(),
  z
    .object({
      kind: z.enum(["STAGE_LINE", "PROGRESS_LINE"]),
      text: z.string().min(1).max(200),
    })
    .strict(),
  z
    .object({
      kind: z.literal("HUM"),
      text: z.string().min(1).max(40),
      style: z.enum(Q_HUM_STYLES),
    })
    .strict(),
  z
    .object({
      kind: z.literal("THREAD"),
      text: z.string().min(1).max(200),
      memoryItemId: z.string().uuid(),
    })
    .strict(),
]);
export type QSilenceBeat = z.infer<typeof QSilenceBeatSchema>;

/** One small-talk thread the ladder may bring back (the person's own). */
export type QSilenceThread = {
  readonly memoryItemId: string;
  readonly followUp: string;
};

export type QSilenceState = {
  readonly toned: boolean;
  readonly stageLined: boolean;
  /** Later beats given so far (progress lines, hums, the thread). */
  readonly later: number;
  readonly threaded: boolean;
  readonly lastText: string | null;
};

export const Q_SILENCE_START: QSilenceState = {
  toned: false,
  stageLined: false,
  later: 0,
  threaded: false,
  lastText: null,
};

export type QSilenceInput = {
  /** Milliseconds since the person stopped and Q began working. */
  readonly elapsedMs: number;
  /** The run's current visible stage, or null before the first. */
  readonly stage: QVisibleStage | null;
  readonly focus: QSilenceFocus | null;
  /** The person is speaking, the answer has started, or Q is otherwise talking. */
  readonly hushed: boolean;
  /** An approval is waiting: Q has asked, and silence is theirs. */
  readonly approvalWaiting: boolean;
  /** A thread, only when one is allowed this wait (own memory, unused this session). */
  readonly thread: QSilenceThread | null;
  /** Varies the phrasing; any integer. */
  readonly seed: number;
};

export type QSilenceStep = {
  readonly beat: QSilenceBeat | null;
  readonly state: QSilenceState;
  /** When to ask again (elapsed ms), or null when the ladder is done. */
  readonly nextAtMs: number | null;
};

// --- phrasing ---------------------------------------------------------------

/** A seeded choice: deterministic for a seed, varied across seeds. */
function choose<T>(options: readonly T[], seed: number, salt: number): T {
  let x = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  const picked = options[x % options.length];
  if (picked === undefined) throw new Error("choose from an empty list");
  return picked;
}

function possessive(name: string): string {
  return /s$/iu.test(name) ? `${name}'` : `${name}'s`;
}

type Phrase = { readonly verbs: readonly string[]; readonly object: string };

/** What Q is doing at a stage, as verbs and an object. Null: say nothing. */
function phraseFor(
  stage: QVisibleStage | null,
  focus: QSilenceFocus | null,
): Phrase | null {
  const name = focus?.name;
  const thing = focus?.thing;
  const theirs = (fallback: string) =>
    name === undefined ? fallback : `${possessive(name)} ${thing ?? fallback}`;
  switch (stage) {
    case null:
    case "UNDERSTANDING_REQUEST":
      return {
        verbs: ["looking into", "thinking about", "working through"],
        object:
          name === undefined
            ? "that"
            : thing === undefined
              ? name
              : `${possessive(name)} ${thing}`,
      };
    case "REVIEWING_COMPANY":
      return {
        verbs: ["looking at", "going through", "reading"],
        object: theirs("profile"),
      };
    case "CHECKING_EVIDENCE":
      return {
        verbs: ["checking", "going over", "looking at"],
        object:
          name === undefined ? "the evidence" : `the evidence behind ${name}`,
      };
    case "SEARCHING_PUBLIC_SOURCES":
      return {
        verbs: ["looking up", "checking", "reading up on"],
        object:
          name === undefined
            ? "what's public on this"
            : `what's public on ${name}`,
      };
    case "REVIEWING_INVESTOR_CRITERIA":
      return {
        verbs: ["looking at", "reading", "going through"],
        object:
          name === undefined ? "the investor's criteria" : theirs("mandate"),
      };
    case "COMPARING_OPPORTUNITIES":
      return {
        verbs: ["comparing", "weighing up", "lining up"],
        object: "the options",
      };
    case "REVIEWING_RELATIONSHIP":
      return {
        verbs: ["checking", "looking at", "catching up on"],
        object:
          name === undefined
            ? "where things stand"
            : `where things stand with ${name}`,
      };
    case "PREPARING_ANALYSIS":
      return {
        verbs: ["pulling together", "putting together", "working on"],
        object: "your answer",
      };
    case "PREPARING_DOCUMENT":
      return {
        verbs: ["writing", "drafting", "putting together"],
        object: name === undefined ? "your document" : theirs("document"),
      };
    case "REVISING_DOCUMENT":
      return {
        verbs: ["making the changes to", "working your edits into", "updating"],
        object: "the document",
      };
    case "COMPLETING_APPROVED_ACTION":
      return {
        verbs: ["finishing", "wrapping up", "completing"],
        object: "what you approved",
      };
    case "WAITING_FOR_REPLY":
    case "WAITING_FOR_APPROVAL":
      return null;
  }
}

const capitalise = (text: string) =>
  text.length === 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

const STAGE_OPENERS = ["", "", "Okay, ", "Right, ", "Just "] as const;
const STAGE_TAILS = ["…", " now…", ", one moment…", "…"] as const;
const PROGRESS_SHAPES = [
  (verb: string, object: string) => `Still ${verb} ${object}…`,
  (verb: string, object: string) => `Bear with me, still ${verb} ${object}…`,
  (verb: string, object: string) => `Still on it: ${verb} ${object}…`,
  (verb: string, object: string) =>
    `This one takes a moment. Still ${verb} ${object}…`,
] as const;
const HUMS: Readonly<Record<QHumStyle, readonly string[]>> = {
  FLAT: ["Mmm…", "Hmm…", "Mm-mm…"],
  SING_SONG: ["Mm-hm-hmm…", "Hmm, hm-hmm…", "Mm, mm-hmm…"],
};
const THREAD_OPENERS = [
  "By the way, ",
  "While that runs, ",
  "Oh, before I forget: ",
  "Meanwhile, ",
] as const;

/** The 1.5 s line, or null when there is nothing honest to say. */
export function silenceStageLine(
  stage: QVisibleStage | null,
  focus: QSilenceFocus | null,
  seed: number,
  avoid: string | null = null,
): string | null {
  const phrase = phraseFor(stage, focus);
  if (phrase === null) return null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const opener = choose(STAGE_OPENERS, seed + attempt, 1);
    const verb = choose(phrase.verbs, seed + attempt, 2);
    const tail = choose(STAGE_TAILS, seed + attempt, 3);
    const line = capitalise(`${opener}${verb} ${phrase.object}${tail}`);
    if (line !== avoid) return line;
  }
  return null;
}

export function silenceProgressLine(
  stage: QVisibleStage | null,
  focus: QSilenceFocus | null,
  seed: number,
  avoid: string | null = null,
): string | null {
  const phrase = phraseFor(stage, focus);
  if (phrase === null) return null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const shape = choose(PROGRESS_SHAPES, seed + attempt, 4);
    const line = shape(choose(phrase.verbs, seed + attempt, 5), phrase.object);
    if (line !== avoid) return line;
  }
  return null;
}

export function silenceHum(
  seed: number,
  avoid: string | null = null,
): { readonly text: string; readonly style: QHumStyle } {
  const style = choose(Q_HUM_STYLES, seed, 6);
  const options = HUMS[style].filter((hum) => hum !== avoid);
  return { text: choose(options, seed, 7), style };
}

/** "By the way, how was Lagos?" from the person's own remembered thread. */
export function silenceThreadLine(followUp: string, seed: number): string {
  const opener = choose(THREAD_OPENERS, seed, 8);
  const trimmed = followUp.trim().replace(/[.!…]+$/u, "");
  const question = trimmed.endsWith("?") ? trimmed : `${trimmed}?`;
  const body = opener.endsWith(": ")
    ? capitalise(question)
    : `${question.charAt(0).toLowerCase()}${question.slice(1)}`;
  return `${opener}${body}`;
}

// --- the ladder -------------------------------------------------------------

function laterAt(index: number): number {
  return (
    Q_SILENCE_LADDER.progressAtMs + index * Q_SILENCE_LADDER.progressEveryMs
  );
}

/**
 * The next beat at `elapsedMs`, if one is due, and when to look again.
 * Call it on a timer (at `nextAtMs`) and on every stage change; it never
 * gives the same rung twice.
 */
export function nextSilenceBeat(
  state: QSilenceState,
  input: QSilenceInput,
): QSilenceStep {
  const L = Q_SILENCE_LADDER;
  const done = state.later >= L.maxLaterBeats;
  const nextDue = (s: QSilenceState): number | null => {
    if (!s.toned) return L.toneAtMs;
    if (!s.stageLined) return L.stageLineAtMs;
    if (s.later >= L.maxLaterBeats) return null;
    return laterAt(s.later);
  };
  // Hushed: nothing now, look again later (the wait may still be long).
  if (
    input.hushed ||
    input.approvalWaiting ||
    input.stage === "WAITING_FOR_APPROVAL"
  ) {
    return {
      beat: null,
      state,
      nextAtMs: done
        ? null
        : Math.max(input.elapsedMs + 500, nextDue(state) ?? 0),
    };
  }
  const t = input.elapsedMs;
  if (!state.toned) {
    if (t < L.toneAtMs) return { beat: null, state, nextAtMs: L.toneAtMs };
    const next = { ...state, toned: true };
    return { beat: { kind: "TONE" }, state: next, nextAtMs: nextDue(next) };
  }
  if (!state.stageLined) {
    if (t < L.stageLineAtMs) {
      return { beat: null, state, nextAtMs: L.stageLineAtMs };
    }
    const text = silenceStageLine(
      input.stage,
      input.focus,
      input.seed,
      state.lastText,
    );
    const next = {
      ...state,
      stageLined: true,
      lastText: text ?? state.lastText,
    };
    return {
      beat: text === null ? null : { kind: "STAGE_LINE", text },
      state: next,
      nextAtMs: nextDue(next),
    };
  }
  if (done) return { beat: null, state, nextAtMs: null };
  const due = laterAt(state.later);
  if (t < due) return { beat: null, state, nextAtMs: due };
  const seed = input.seed + state.later * 31;
  const bump = (lastText: string | null, threaded = state.threaded) => ({
    ...state,
    later: state.later + 1,
    threaded,
    lastText,
  });
  // The remembered thread: once, only in a long wait, only if there is one.
  if (
    !state.threaded &&
    input.thread !== null &&
    t >= L.threadAfterMs &&
    state.later >= 1
  ) {
    const text = silenceThreadLine(input.thread.followUp, seed);
    const next = bump(text, true);
    return {
      beat: { kind: "THREAD", text, memoryItemId: input.thread.memoryItemId },
      state: next,
      nextAtMs: nextDue(next),
    };
  }
  // A line on even rungs, a hum on odd ones: a person does not narrate
  // every few seconds.
  if (state.later % 2 === 0) {
    const text = silenceProgressLine(
      input.stage,
      input.focus,
      seed,
      state.lastText,
    );
    if (text !== null) {
      const next = bump(text);
      return {
        beat: { kind: "PROGRESS_LINE", text },
        state: next,
        nextAtMs: nextDue(next),
      };
    }
  }
  const hum = silenceHum(seed, state.lastText);
  const next = bump(hum.text);
  return {
    beat: { kind: "HUM", text: hum.text, style: hum.style },
    state: next,
    nextAtMs: nextDue(next),
  };
}

/** Where the person is, as the thing the ladder may name. */
export function silenceThingForRoute(route: string): QSilenceThing | undefined {
  switch (route) {
    case "PITCH":
      return "pitch";
    case "RELATIONSHIP_COMPANY":
    case "RELATIONSHIP_INVESTOR":
      return "chat";
    case "CAPITAL":
      return "round";
    case "DOCUMENTS":
      return "documents";
    case "COMPANY":
    case "PROFILE":
      return "profile";
    default:
      return undefined;
  }
}
