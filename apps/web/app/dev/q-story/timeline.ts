import type { QApertureState } from "@/features/q-aperture";

import { STORY_LINES } from "./story-lines";

/**
 * The storyboard's fixed clock (Q Story S2). It replays the plan's beat
 * table (docs/specs/q-pitch/Q-STORY-PLAN-2026-10-21.md §3) with no audio:
 * every word gets a start time from the act's pace (§2), the written
 * pauses add real silence, and each cue is anchored to a word and fires
 * 120 ms before it, as the S1 engine will on the audio clock. The state at
 * any instant is a pure function of the time, so a frame can be taken at
 * any `?t=` and the recording is the same on every run.
 *
 * This is a design rehearsal, not the engine: S1 replaces the estimated
 * word times with the rendered alignment.
 */

/** Words per minute by act (plan §2: slow, varied, brisk, slow and final). */
const ACT_WPM: readonly number[] = [128, 116, 126, 112, 150, 132, 118];

/** Cues land on their word: visuals lead the voice by this much (plan §1). */
export const CUE_LEAD_S = 0.12;

/** Silence after a line, by source line, beyond the default gap (seconds). */
const EXTRA_PAUSE: ReadonlyMap<number, number> = new Map([
  [3, 0.5], // "Hi. I'm Q." — the smile lands before the lean-in
  [5, 0.9],
  [7, 0.7], // 11:47 — let the hour sit
  [18, 0.6], // "Opportunity everywhere." — the montage breathes
  [32, 0.5],
  [38, 1.6], // "...never know how much" trails off into silence
  [42, 0.9],
  [57, 0.5], // "Go raise." — the chuckle
  [79, 0.5], // down round, hushed
  [91, 0.6],
  [113, 1.2], // "Then..." — 1.2 s of real silence (plan §2)
  [115, 0.7],
  [119, 0.6],
  [123, 0.8],
  [141, 0.6],
  [153, 0.6],
  [155, 1.0], // "There has to be a better way." — a breath
  [157, 0.4],
  [159, 0.9], // "CapitalQ." — the proud beat
  [199, 0.5],
  [221, 0.6],
  [249, 0.8], // "Who should."
  [253, 0.4],
  [257, 0.5], // the gruff investor
  [293, 0.8],
  [295, 0.9], // trillions — reverent and slow
  [297, 0.9], // "What it still doesn't have..."
  [299, 1.1], // "HOME" lands, and the page is home
  [301, 0.6],
]);

/** Gap between lines of one paragraph, and between paragraphs (seconds). */
const LINE_GAP_S = 0.18;
const PARAGRAPH_GAP_S = 0.42;
/** A trailing ellipsis is a written pause. */
const ELLIPSIS_S = 0.45;

export type Frame =
  | "home"
  | "shell"
  | "discover"
  | "mandate"
  | "top3"
  | "compare"
  | "diligence"
  | "prep"
  | "interview"
  | "gate"
  | "inbox"
  | "readiness"
  | "investors";

/** Each real page behind the story: an existing dev harness (fixtures only). */
export const FRAMES: Readonly<Record<Frame, string>> = {
  home: "/dev/brand-preview?view=q",
  shell: "/dev/brand-preview?view=dock",
  discover: "/dev/discover",
  mandate: "/dev/crm?view=capital",
  top3: "/dev/match?view=top3",
  compare: "/dev/canvas?state=compare",
  diligence: "/dev/profile?tab=diligence",
  prep: "/dev/crm?view=record",
  interview: "/dev/gateq-v2?view=inbox-detail",
  gate: "/dev/gateq-v2?view=gate",
  inbox: "/dev/gateq-v2?view=inbox",
  readiness: "/dev/crm?view=raise&tab=readiness",
  investors: "/dev/crm?view=raise&tab=investors",
};

export type Scene =
  | "hello"
  | "clock"
  | "inbox"
  | "montage"
  | "questions"
  | "scale"
  | "founder"
  | "goraise"
  | "rounds"
  | "established"
  | "twobeat"
  | "verbs"
  | "hope"
  | "silence"
  | "bubbles"
  | "fadewords"
  | "still"
  | "wordmark"
  | "callback"
  | "qcard"
  | "split"
  | "shots"
  | "time"
  | "outcomes"
  | "trillions"
  | "channels"
  | "echo"
  | "handover";

export type Chips = "none" | "mismatch" | "readiness" | "mandate" | "findings";

/** A section of a real page, found by its visible text (see storyboard.tsx). */
export type LitTarget = {
  readonly frame: Frame;
  readonly text: string;
  /** Light the enclosing section rather than the label itself. */
  readonly section?: boolean;
  /** A short note beside the ring, e.g. a gap the plan names. */
  readonly note?: string;
  /** For a control with no visible words of its own (the composer). */
  readonly selector?: string;
};

export type StoryState = {
  readonly act: number;
  /** night (Act 1), day (Act 2 onward in story mode), or the app itself. */
  readonly mode: "night" | "day";
  /** 0: the app is the stage; 1: story mode (app at 35% behind); 2: deep. */
  readonly scrim: 0 | 1 | 2;
  readonly frame: Frame;
  readonly scene: Scene | null;
  readonly step: number;
  readonly lit: LitTarget | null;
  readonly presence: "centre" | "dock-right" | "dock-left";
  readonly aperture: QApertureState;
  /** Increments on each shutter flash (COMPLETE), so each one replays. */
  readonly flash: number;
  readonly chips: Chips;
  readonly chipStep: number;
  readonly captions: boolean;
  /** Feed cards advanced on Discover (#38). */
  readonly swipes: number;
  /** A short label for the beat, shown in the review HUD. */
  readonly beat: string;
  /** Fictional companies are on screen (blueprint §4). */
  readonly demo: boolean;
};

type Patch = Partial<Omit<StoryState, "step" | "chipStep" | "flash">> & {
  readonly step?: number | "+";
  readonly chipStep?: number | "+";
  readonly flash?: true;
};

const INITIAL: StoryState = {
  act: 0,
  mode: "day",
  scrim: 0,
  frame: "home",
  scene: null,
  step: 0,
  lit: null,
  presence: "centre",
  aperture: "IDLE",
  flash: 0,
  chips: "none",
  chipStep: 0,
  captions: true,
  swipes: 0,
  beat: "Before",
  demo: false,
};

const lit = (
  frame: Frame,
  text: string,
  section = true,
  note?: string,
): LitTarget =>
  note === undefined
    ? { frame, text, section }
    : { frame, text, section, note };

/**
 * The cue table: [source line, word index (0-based), patch]. Read with the
 * plan's §3 rows (#n) beside it; every row is here, in order.
 */
const CUES: readonly (readonly [number, number, Patch])[] = [
  // Act 0 — Hello (#1–2)
  [3, 0, { act: 0, beat: "#1 Hello", aperture: "SPEAKING", scene: "hello" }],
  [5, 8, { beat: "#2 Story mode", scrim: 1, mode: "night" }],
  // Act 1 — The investor's night (#3–14)
  [7, 1, { act: 1, beat: "#3 11:47", scene: "clock", presence: "dock-right" }],
  [9, 0, { beat: "#4 Inbox", scene: "inbox", step: 1 }],
  [11, 0, { beat: "#5 Inbox full", step: "+" }],
  [13, 0, { beat: "#6 Decks", step: "+" }],
  [14, 0, { step: "+" }],
  [15, 0, { step: "+" }],
  [16, 0, { step: "+" }],
  [18, 0, { beat: "#7 Opportunity everywhere", scene: "montage", step: 1 }],
  [20, 8, { beat: "#8 The needle", step: 2 }],
  [22, 0, { beat: "#9 Doesn't announce itself", step: 3 }],
  [24, 0, { beat: "#10 Every deal takes time", step: 4 }],
  [28, 0, { beat: "#11 A fund" }],
  [32, 0, { beat: "#12 The two questions", scene: "questions", step: 1 }],
  [32, 5, { step: 2 }],
  [34, 0, { beat: "#13 Every bad investment", scene: "scale", step: 1 }],
  [36, 3, { step: 2 }],
  [38, 0, { step: 3 }],
  [40, 0, { beat: "#14 Afraid", scene: "montage", step: 5 }],
  // Act 2 — The founder (#15–32)
  [
    44,
    0,
    {
      act: 2,
      beat: "#15 The table turns",
      mode: "day",
      scene: "founder",
      step: 0,
    },
  ],
  [48, 0, { beat: "#16 First raise" }],
  [50, 0, { step: 1 }],
  [51, 0, { step: 2 }],
  [52, 0, { step: 3 }],
  [53, 0, { step: 4 }],
  [57, 0, { beat: "#17 Go raise", scene: "goraise", step: 1 }],
  [61, 3, { beat: "#18 Seed → A", scene: "rounds", step: 1 }],
  [63, 3, { step: 2 }],
  [67, 3, { beat: "#19 The bar is higher", step: 3 }],
  [69, 0, { step: 4 }],
  [71, 0, { step: 5 }],
  [73, 0, { step: 6 }],
  [75, 0, { step: 7 }],
  [77, 0, { step: 8 }],
  [79, 0, { beat: "#20 Down round", step: 9 }],
  [81, 0, { beat: "#21 A to B, B to C", step: 10 }],
  [87, 2, { beat: "#22 Established business", scene: "established", step: 1 }],
  [87, 7, { step: 2 }],
  [87, 11, { step: 3 }],
  [89, 0, { beat: "#23 Different stage", scene: "twobeat", step: 1 }],
  [91, 0, { step: 2 }],
  [95, 2, { beat: "#24 Search, pitch, fly", scene: "verbs", step: 1 }],
  [97, 0, { step: 2 }],
  [99, 0, { step: 3 }],
  [101, 0, { step: 4 }],
  [103, 0, { step: 5 }],
  [107, 0, { beat: "#25 Hope rises", scene: "hope", step: 1 }],
  [111, 0, { step: 2 }],
  [
    113,
    0,
    { beat: "#26 Silence", scene: "silence", scrim: 2, captions: false },
  ],
  [115, 0, { captions: true }],
  [117, 0, { beat: "#27 Nothing", scene: "bubbles", scrim: 1, step: 1 }],
  [119, 0, { step: 2 }],
  [121, 0, { step: 3 }],
  [123, 0, { step: 4 }],
  [125, 0, { beat: "#28 Mercy", scene: "still" }],
  [129, 0, { beat: "#29 Trapped", scene: "fadewords", step: 1 }],
  [129, 13, { step: 2 }],
  [129, 14, { step: 3 }],
  [131, 0, { step: 4 }],
  [
    131,
    4,
    {
      beat: "#30 Wrong stage",
      scene: null,
      chips: "mismatch",
      chipStep: 1,
    },
  ],
  [133, 0, { chipStep: 2 }],
  [135, 0, { chipStep: 3 }],
  [137, 0, { chipStep: 4 }],
  [139, 0, { beat: "#30 They were right", scene: "echo", chips: "none" }],
  [141, 0, { beat: "…you just weren't ready" }],
  [143, 0, { beat: "#31 Weak governance", chips: "readiness", chipStep: 1 }],
  [145, 0, { chipStep: 2 }],
  [147, 0, { chipStep: 3 }],
  [149, 0, { chipStep: 4 }],
  [151, 0, { beat: "#32 Pitch more", chips: "none", scene: "still" }],
  // Act 3 — The turn (#33–34)
  [155, 0, { act: 3, beat: "#32 A better way" }],
  [
    157,
    0,
    {
      beat: "#33 And there is",
      scene: null,
      scrim: 0,
      presence: "centre",
      aperture: "COMPLETE",
      flash: true,
    },
  ],
  [157, 2, { aperture: "SPEAKING" }],
  [159, 0, { beat: "#34 CapitalQ", scene: "wordmark", step: 1 }],
  // Act 4 — For investors (#35–44)
  [
    161,
    1,
    {
      act: 4,
      beat: "#35 TikTok for discovery",
      scene: null,
      frame: "discover",
      presence: "dock-right",
      demo: true,
    },
  ],
  [163, 1, { beat: "#35 Jarvis", aperture: "LISTENING" }],
  [163, 3, { aperture: "SPEAKING" }],
  [
    165,
    2,
    {
      beat: "#35 The entire journey",
      frame: "shell",
      lit: lit("shell", "Discover", false),
    },
  ],
  [165, 3, { lit: lit("shell", "Explore", false) }],
  [165, 4, { lit: lit("shell", "CRM", false) }],
  [165, 5, { lit: lit("shell", "Work", false) }],
  [167, 0, { beat: "#36 I learn how you invest", frame: "mandate", lit: null }],
  [169, 1, { lit: lit("mandate", "Thesis"), chips: "mandate", chipStep: 1 }],
  [171, 0, { lit: lit("mandate", "Stage"), chipStep: 2 }],
  [173, 0, { lit: lit("mandate", "Sectors") }],
  [175, 0, { lit: lit("mandate", "Geography"), chipStep: 3 }],
  [177, 0, { lit: lit("mandate", "Cheque"), chipStep: 4 }],
  [179, 0, { lit: lit("mandate", "Business models") }],
  [181, 0, { lit: lit("mandate", "Never shown") }],
  [
    183,
    0,
    {
      beat: "#37 Configure discovery",
      frame: "discover",
      lit: null,
      chips: "none",
    },
  ],
  [185, 1, { beat: "#38 Swipe like TikTok", swipes: 1 }],
  [185, 4, { swipes: 2 }],
  [
    187,
    1,
    {
      beat: "#39 Swipe to match",
      scene: null,
      lit: lit(
        "discover",
        "Express interest",
        false,
        "Highlighted, never pressed",
      ),
    },
  ],
  [
    189,
    0,
    {
      beat: "#40 Ask me anything",
      frame: "top3",
      lit: lit("top3", "Your top three", false),
    },
  ],
  [
    191,
    0,
    {
      beat: "#40 Compare businesses",
      frame: "compare",
      lit: lit("compare", "Side by side"),
    },
  ],
  [
    193,
    0,
    {
      beat: "#40 Interrogate assumptions",
      frame: "diligence",
      lit: lit("diligence", "Questions to investigate"),
    },
  ],
  [
    195,
    0,
    {
      beat: "#40 Prepare for meetings",
      frame: "prep",
      lit: lit("prep", "Open call brief", false),
    },
  ],
  [
    197,
    10,
    {
      beat: "#41 Interview Before the Interview",
      frame: "interview",
      lit: lit("interview", "Their answers"),
    },
  ],
  [199, 3, { lit: lit("interview", "One-page summary") }],
  [201, 0, { beat: "#42 For inbound", frame: "gate", lit: null }],
  [203, 1, { beat: "#42 GateQ", lit: lit("gate", "GateQ", false) }],
  [
    205,
    5,
    {
      beat: "#43 Plug it in",
      lit: lit("gate", "Your gate link"),
      scene: "channels",
      step: 1,
    },
  ],
  [205, 6, { step: 2 }],
  [205, 8, { step: 3 }],
  [205, 10, { step: 4 }],
  [205, 11, { step: 5 }],
  [209, 0, { beat: "#44 One place", frame: "inbox", scene: null, lit: null }],
  [211, 0, { lit: lit("inbox", "Their answers") }],
  [
    213,
    0,
    {
      lit: lit(
        "inbox",
        "One-page summary",
        true,
        "No score is shown today (plan §8.3)",
      ),
    },
  ],
  [215, 0, { lit: lit("inbox", "Your gate's rules") }],
  [
    217,
    0,
    {
      lit: lit(
        "inbox",
        "Look at first",
        false,
        "Ranking by suitability: owner decision (plan §8.3)",
      ),
    },
  ],
  [221, 4, { beat: "#44 Rise to the top" }],
  // Act 5 — For businesses (#45–47)
  [
    223,
    0,
    {
      act: 5,
      beat: "#45 The investment associate",
      scrim: 1,
      scene: "callback",
      step: 0,
      presence: "dock-left",
    },
  ],
  [225, 4, { step: 1 }],
  [227, 1, { step: 2 }],
  [229, 1, { step: 3 }],
  [231, 1, { step: 4 }],
  [233, 2, { step: 5 }],
  [
    237,
    0,
    {
      beat: "#46 Investability IQ",
      scene: null,
      scrim: 0,
      frame: "readiness",
      chips: "findings",
      chipStep: 1,
      presence: "dock-right",
      lit: lit("readiness", "Team", false),
    },
  ],
  [239, 0, { chipStep: 2, lit: lit("readiness", "Market", false) }],
  [241, 0, { chipStep: 3, lit: lit("readiness", "Legal", false) }],
  [243, 4, { chipStep: 4, lit: lit("readiness", "What could stop") }],
  [
    245,
    0,
    {
      beat: "#47 Investors you suit",
      chips: "none",
      frame: "investors",
      lit: null,
    },
  ],
  [249, 0, { beat: "#47 Who should" }],
  // Act 6 — The close (#48–56)
  [
    251,
    0,
    {
      act: 6,
      beat: "#48 Behavior changes",
      scrim: 1,
      scene: "qcard",
      step: 0,
      lit: null,
    },
  ],
  [257, 0, { beat: "#48 Send me your deck", step: 1 }],
  [261, 0, { beat: "#48 What's your Q Card?", step: 2 }],
  [263, 6, { beat: "#49 Your story", step: 3 }],
  [263, 8, { step: 4 }],
  [263, 10, { step: 5 }],
  [263, 12, { step: 6 }],
  [263, 15, { step: 7 }],
  [263, 16, { beat: "#50 One platform", scene: "split", step: 1 }],
  [265, 0, { step: 2 }],
  [267, 0, { beat: "#51 Discovery…", scene: "shots", step: 1 }],
  [269, 0, { step: 2 }],
  [271, 0, { step: 3 }],
  [273, 0, { step: 4 }],
  [275, 0, { step: 5 }],
  [277, 0, { step: 6 }],
  [279, 0, { step: 7 }],
  [281, 0, { step: 8 }],
  [283, 3, { beat: "#52 Weeks, months, years", scene: "time", step: 1 }],
  [285, 1, { step: 2 }],
  [
    285,
    3,
    {
      beat: "#53 Better opportunities",
      scene: "outcomes",
      step: 1,
      captions: false,
    },
  ],
  [287, 0, { step: 2 }],
  [289, 0, { step: 3 }],
  [291, 0, { step: 4 }],
  [293, 0, { step: 5 }],
  [
    295,
    0,
    { beat: "#54 Trillions", scene: "trillions", step: 1, captions: true },
  ],
  [297, 0, { step: 2 }],
  [
    299,
    2,
    {
      beat: "#54 HOME",
      scene: "trillions",
      step: 3,
      scrim: 0,
      frame: "home",
      demo: false,
      presence: "centre",
    },
  ],
  [301, 0, { beat: "#55 I'm Q", scene: null }],
  [309, 0, { beat: "#56 Without me", scene: "handover", step: 1 }],
  [
    309,
    6,
    {
      lit: {
        frame: "home",
        text: "",
        selector: "form:has(textarea)",
        note: "Q&A mode: ask me anything",
      },
      // At rest on its stage Q forms its own mark: the grin.
      aperture: "IDLE",
    },
  ],
];

export type TimedWord = {
  readonly text: string;
  readonly start: number;
  readonly end: number;
};

export type TimedLine = {
  readonly source: number;
  readonly act: number;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly words: readonly TimedWord[];
};

export type Timeline = {
  readonly lines: readonly TimedLine[];
  readonly total: number;
  /** Cue times, ascending, and the state after each cue. */
  readonly cueTimes: readonly number[];
  readonly states: readonly StoryState[];
};

function wordWeight(word: string): number {
  // Longer words take longer; punctuation carries a little breath.
  const letters = word.replace(/[^\p{L}\p{N}]/gu, "").length;
  const breath = /[.,:;?!]$/.test(word) ? 2.2 : 0;
  return 3 + letters + breath;
}

function applyPatch(state: StoryState, patch: Patch): StoryState {
  const { step, chipStep, flash, ...rest } = patch;
  const sceneChanged = rest.scene !== undefined && rest.scene !== state.scene;
  const nextStep =
    step === "+"
      ? state.step + 1
      : step !== undefined
        ? step
        : sceneChanged
          ? 1
          : state.step;
  const nextChip =
    chipStep === "+"
      ? state.chipStep + 1
      : chipStep !== undefined
        ? chipStep
        : state.chipStep;
  return {
    ...state,
    ...rest,
    step: nextStep,
    chipStep: nextChip,
    flash: flash === true ? state.flash + 1 : state.flash,
  };
}

export function buildTimeline(): Timeline {
  const lines: TimedLine[] = [];
  let t = 1.2; // a moment of the Q page before Q speaks
  STORY_LINES.forEach(([source, act, text], index) => {
    const parts = text.split(/\s+/).filter((w) => w.length > 0);
    const wpm = ACT_WPM[act] ?? 130;
    const lineSeconds = (parts.length * 60) / wpm;
    const weights = parts.map(wordWeight);
    const sum = weights.reduce((a, b) => a + b, 0);
    const words: TimedWord[] = [];
    let cursor = t;
    parts.forEach((w, i) => {
      const d = (lineSeconds * (weights[i] ?? 0)) / sum;
      words.push({ text: w, start: cursor, end: cursor + d });
      cursor += d;
    });
    lines.push({ source, act, text, start: t, end: cursor, words });
    const next = STORY_LINES[index + 1];
    const sameParagraph = next !== undefined && next[0] === source + 1;
    t =
      cursor +
      (sameParagraph ? LINE_GAP_S : PARAGRAPH_GAP_S) +
      (/\.\.\.\s*$|…\s*$/.test(text) ? ELLIPSIS_S : 0) +
      (EXTRA_PAUSE.get(source) ?? 0);
  });
  const bySource = new Map(lines.map((l) => [l.source, l]));
  const timed = CUES.map(([source, word, patch]) => {
    const line = bySource.get(source);
    if (line === undefined) {
      throw new Error(`Cue on missing source line ${String(source)}`);
    }
    const w = line.words[Math.min(word, line.words.length - 1)];
    return { t: Math.max(0, (w?.start ?? line.start) - CUE_LEAD_S), patch };
  });
  const cueTimes: number[] = [];
  const states: StoryState[] = [];
  let state = INITIAL;
  for (const cue of timed) {
    state = applyPatch(state, cue.patch);
    cueTimes.push(cue.t);
    states.push(state);
  }
  return { lines, total: t + 4, cueTimes, states };
}

export function stateAt(timeline: Timeline, t: number): StoryState {
  let lo = 0;
  let hi = timeline.cueTimes.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((timeline.cueTimes[mid] ?? Infinity) <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found < 0 ? INITIAL : (timeline.states[found] ?? INITIAL);
}

/** The cue index at t (changes only when the picture does). */
export function cueIndexAt(timeline: Timeline, t: number): number {
  let i = -1;
  for (let k = 0; k < timeline.cueTimes.length; k++) {
    if ((timeline.cueTimes[k] ?? Infinity) <= t) i = k;
    else break;
  }
  return i;
}

/** The line being said, or just said; the newer line wins at a boundary. */
export function lineAt(timeline: Timeline, t: number): TimedLine | null {
  let hit: TimedLine | null = null;
  for (const line of timeline.lines) {
    if (line.start - 0.05 > t) break;
    if (t <= line.end + 0.6) hit = line;
  }
  return hit;
}
