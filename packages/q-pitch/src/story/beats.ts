import { z } from "zod";

import {
  StoryCueSchema,
  type StoryAct,
  type StoryAnchor,
  type StoryCue,
  type StoryFigure,
  type StoryMood,
  type StoryRoute,
  type StoryVisual,
} from "./acts.js";

/**
 * Q Story, the sealed script (plan 2026-10-21 §3): the owner's story in 56
 * beats, word for word. The words never change: a test rebuilds the whole
 * text from these beats and compares it with
 * `docs/specs/q-pitch/story/Q_STORY_VERBATIM.txt`, ignoring only line-break
 * layout, so one changed word fails CI.
 *
 * Delivery is kept apart from the words. `tags` are ElevenLabs audio
 * tags placed before a word (or at the end), sent to the renderer only;
 * `delivery` is the same direction in prose for the live-voice fallback.
 * Cues are anchored to word indices, never to times, so a re-render with a
 * different voice keeps every cue on its word.
 */

export const STORY_VERSION = "story-v7.1" as const;

/** The document's title line: shown, never spoken. */
export const STORY_TITLE = "Q Story" as const;

/** The audio tags the story may use (ElevenLabs delivery, v3 and v4 turbo; not words). */
export const STORY_AUDIO_TAGS = [
  "[warmly]",
  "[softly]",
  "[whispers]",
  "[sighs]",
  "[laughs softly]",
  "[chuckles]",
  "[laughs]",
  "[pause]",
  "[short pause]",
  "[long pause]",
  "[curious]",
  "[excited]",
  "[serious]",
  "[sad]",
  "[gruff]",
  "[slowly]",
  "[confident]",
  "[playful]",
  "[proud]",
] as const;
export const StoryAudioTagSchema = z.enum(STORY_AUDIO_TAGS);
export type StoryAudioTag = z.infer<typeof StoryAudioTagSchema>;

export const STORY_PACES = ["slower", "slow", "normal", "brisk"] as const;
export type StoryPace = (typeof STORY_PACES)[number];

/** Words per minute by pace (plan §4: 125-135 wpm overall). */
export const PACE_WPM: Readonly<Record<StoryPace, number>> = {
  slower: 105,
  slow: 118,
  normal: 135,
  brisk: 150,
};

export const StoryBeatSchema = z
  .object({
    /** 1-based, as the plan's table and the viewer count. */
    n: z.number().int().min(1).max(56),
    id: z.string().regex(/^beat-\d{2}$/u),
    /** The plan's act (0 Hello … 6 The close). */
    act: z.number().int().min(0).max(6),
    /** Verbatim lines, as the owner wrote them (line breaks are layout). */
    lines: z.array(z.string().min(1)).min(1),
    /** The beat's words: `lines` split on whitespace. */
    words: z.array(z.string().min(1)).min(1),
    pace: z.enum(STORY_PACES),
    /** Delivery direction for the live-voice fallback (never spoken). */
    delivery: z.string().trim().min(8).max(400),
    /** Audio tags before word `at` (`at` = words.length: at the end). */
    tags: z
      .array(
        z.object({ at: z.number().int().min(0), tag: StoryAudioTagSchema }),
      )
      .default([]),
    cues: z.array(StoryCueSchema),
    /** Real silence after the beat (#26: 1.2 s). */
    silenceAfterMs: z.number().int().min(0).max(3_000).default(0),
  })
  .strict()
  .superRefine((beat, context) => {
    for (const cue of beat.cues) {
      if (cue.at >= beat.words.length) {
        context.addIssue({
          code: "custom",
          message: `cue on word ${String(cue.at)} past the beat's end`,
        });
      }
    }
    for (const tag of beat.tags) {
      if (tag.at > beat.words.length) {
        context.addIssue({ code: "custom", message: "tag past the beat" });
      }
    }
  });
export type StoryBeat = z.infer<typeof StoryBeatSchema>;

/** A word as compared for cue anchors: letters and digits, lower case. */
export function wordKey(word: string): string {
  return word
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * The index of the word `on` names: "Decks", or "Nothing#2" for the second
 * "Nothing". Throws at module load when a cue names a word the beat does
 * not have, so a script edit can never silently move a cue.
 */
function wordIndex(words: readonly string[], on: string | number): number {
  if (typeof on === "number") return on;
  const [raw, nth] = on.split("#");
  const key = wordKey(raw ?? "");
  const wanted = nth === undefined ? 1 : Number(nth);
  let seen = 0;
  for (const [index, word] of words.entries()) {
    if (wordKey(word) === key && ++seen === wanted) return index;
  }
  throw new Error(`Q Story: no word "${on}" in "${words.join(" ")}"`);
}

type On = string | number;
type BeatInput = {
  readonly act: number;
  readonly lines: readonly string[];
  readonly pace: StoryPace;
  readonly delivery: string;
  /** `on` is a word (see wordIndex), or "$end" for after the last word. */
  readonly tags?: readonly (readonly [On, StoryAudioTag])[];
  readonly cues?: readonly (readonly [On, StoryAct])[];
  readonly silenceAfterMs?: number;
};

const mood = (value: StoryMood): StoryAct => ({ kind: "mood", mood: value });
const stage = (visual: StoryVisual, step = 0, text?: string): StoryAct =>
  text === undefined
    ? { kind: "stage", visual, step }
    : { kind: "stage", visual, step, text };
const go = (route: StoryRoute): StoryAct => ({ kind: "navigate", route });
const light = (anchor: StoryAnchor): StoryAct => ({ kind: "light", anchor });
const unlight: StoryAct = { kind: "unlight" };
const figure = (name: StoryFigure, holdMs = 2_400): StoryAct => ({
  kind: "figure",
  figure: name,
  holdMs,
});

const inputs: readonly BeatInput[] = [
  // ── Act 0: Hello ──────────────────────────────────────────────────────
  {
    act: 0,
    lines: ["Hi. I’m Q."],
    pace: "normal",
    delivery:
      "Warm and bright, a smile in the voice. A friendly first hello, unhurried.",
    tags: [[0, "[warmly]"]],
    cues: [[0, stage("aperture", 1)]],
  },
  {
    act: 0,
    lines: ["But before I tell you what I do, let me tell you a story."],
    pace: "slower",
    delivery:
      "Lean in: lower, a little conspiratorial, as if sharing something personal. Slow down on 'let me tell you a story'.",
    tags: [
      [0, "[short pause]"],
      ["let", "[softly]"],
    ],
    cues: [["let", mood("STORY")]],
  },
  // ── Act 1: The investor's night ───────────────────────────────────────
  {
    act: 1,
    lines: ["It’s 11:47 at night."],
    pace: "slow",
    delivery:
      "Quiet, close to the microphone, late at night. Let the time sit for a moment.",
    tags: [[0, "[softly]"]],
    cues: [
      [0, mood("NIGHT")],
      ["11:47", stage("type", 1, "11:47 PM")],
      ["11:47", figure("CLOCK", 3_000)],
    ],
  },
  {
    act: 1,
    lines: ["You’re still at your desk."],
    pace: "slow",
    delivery: "Quiet and close, a little tired, sympathetic.",
    cues: [[0, stage("inbox", 0)]],
  },
  {
    act: 1,
    lines: ["Your inbox is full."],
    pace: "slow",
    delivery: "Quiet, a slight weight on 'full'.",
    cues: [
      ["inbox", stage("inbox", 0)],
      ["inbox", figure("INBOX", 6_000)],
    ],
  },
  {
    act: 1,
    lines: ["Decks.", "Introductions.", "Referrals.", "Applications."],
    pace: "slow",
    delivery:
      "Staccato: one beat each, a small pause between the four words, like items landing one after another.",
    tags: [
      ["Introductions", "[short pause]"],
      ["Referrals", "[short pause]"],
      ["Applications", "[short pause]"],
    ],
    cues: [
      ["Decks", stage("inbox", 1)],
      ["Introductions", stage("inbox", 2)],
      ["Referrals", stage("inbox", 3)],
      ["Applications", stage("inbox", 4)],
    ],
  },
  {
    act: 1,
    lines: ["Opportunity everywhere."],
    pace: "slow",
    delivery: "A hint of awe, softly widening.",
    tags: [[0, "[pause]"]],
    cues: [["Opportunity", stage("montage", 1)]],
  },
  {
    act: 1,
    lines: [
      "And somewhere in that noise might be the investment that makes it all worth it.",
    ],
    pace: "slow",
    delivery: "Hopeful and quiet, a little wistful on 'makes it all worth it'.",
    cues: [["investment", stage("montage", 2)]],
  },
  {
    act: 1,
    lines: ["But it doesn’t announce itself."],
    pace: "slow",
    delivery: "Gentle, knowing, a soft landing.",
    tags: [[0, "[sighs]"]],
    cues: [["announce", stage("montage", 3)]],
  },
  {
    act: 1,
    lines: [
      "Every deal takes time.",
      "Every meeting starts from scratch.",
      "So you keep going while capital sits waiting.",
    ],
    pace: "slow",
    delivery:
      "Measured and tired, the weight of repetition; slow on 'capital sits waiting'.",
    cues: [
      [0, stage("montage", 4)],
      ["meeting", stage("calendar", 1)],
      ["waiting", stage("calendar", 2)],
    ],
  },
  {
    act: 1,
    lines: ["If it’s a fund, your investors want results."],
    pace: "slow",
    delivery: "Plain and serious, matter of fact.",
    cues: [[0, stage("none")]],
  },
  {
    act: 1,
    lines: [
      "If it’s your own money, the question is simpler and sharper:",
      "Is this worth the risk? Do I trust this business?",
    ],
    pace: "slow",
    delivery:
      "Intimate. The two questions almost whispered, the voice of someone asking themselves at midnight.",
    tags: [
      ["Is", "[whispers]"],
      ["Do", "[short pause]"],
    ],
    cues: [
      ["Is", stage("questions", 1)],
      ["Do", stage("questions", 2)],
    ],
  },
  {
    act: 1,
    lines: [
      "Every bad investment costs you.",
      "Truth is, every great one you never discover cost you too.",
      "And you just might never know how much",
    ],
    pace: "slow",
    delivery:
      "Steady, then softer. 'And you just might never know how much' trails off into silence.",
    tags: [
      ["Truth", "[pause]"],
      ["And", "[softly]"],
      ["$end", "[long pause]"],
    ],
    cues: [
      [0, stage("scale", 1)],
      ["great", stage("scale", 2)],
      ["know", stage("scale", 3)],
    ],
  },
  {
    act: 1,
    lines: [
      "Most times, you’re afraid of saying yes to the wrong one...",
      "Other times, you are wondering if you already missed the right one.",
    ],
    pace: "slow",
    delivery: "Quiet and honest, two sides of the same worry.",
    cues: [
      [0, stage("montage", 5)],
      ["missed", stage("montage", 5)],
    ],
  },
  // ── Act 2: The founder ────────────────────────────────────────────────
  {
    act: 2,
    lines: ["Now, come with me to the other side of the table."],
    pace: "normal",
    delivery:
      "A lift: a warm invitation, a gear change, brighter and more awake.",
    tags: [
      [0, "[pause]"],
      [0, "[warmly]"],
    ],
    cues: [
      ["come", mood("DAY")],
      ["table", stage("none")],
    ],
  },
  {
    act: 2,
    lines: [
      "You’re the business raising capital.",
      "Maybe this is your first raise.",
      "You’ve spent years building.",
      "Put your own money in.",
      "Survived payroll.",
      "Won customers.",
    ],
    pace: "normal",
    delivery:
      "Warm and respectful, proud of the founder. Each short line its own small beat.",
    cues: [
      ["building", stage("photos", 14)],
      ["money", stage("photos", 15)],
      ["payroll", stage("photos", 16)],
      ["customers", stage("photos", 17)],
    ],
  },
  {
    act: 2,
    lines: ["And now you think:", "“Go raise.”"],
    pace: "normal",
    delivery: "'Go raise.' with a fond, knowing chuckle.",
    tags: [["“Go", "[chuckles]"]],
    cues: [["“Go", stage("type", 2, "“Go raise.”")]],
  },
  {
    act: 2,
    lines: [
      "Or maybe you’ve done this before.",
      "You raised a seed round.",
      "Maybe even a Series A.",
      "You know the process.",
    ],
    pace: "normal",
    delivery: "Confident, a nod to experience.",
    cues: [
      ["seed", stage("timeline", 1)],
      ["Series", stage("timeline", 2)],
    ],
  },
  {
    act: 2,
    lines: [
      "But now the bar is higher.",
      "The story that worked last time no longer works.",
      "The metrics are scrutinized harder.",
      "Maybe growth slowed.",
      "Maybe the market changed.",
      "Maybe the valuation you once celebrated has become the very thing making the next round harder.",
    ],
    pace: "normal",
    delivery:
      "Building tension; each 'Maybe' a little heavier than the one before.",
    cues: [["bar", stage("timeline", 3)]],
  },
  {
    act: 2,
    lines: ["Maybe you’re staring at a down round."],
    pace: "slow",
    delivery: "Hushed and serious.",
    tags: [[0, "[serious]"]],
    cues: [
      [0, stage("chart-dip", 1)],
      ["down", stage("chart-dip", 2)],
      ["down", figure("CHART_DIP", 3_000)],
    ],
  },
  {
    act: 2,
    lines: [
      "Maybe you’re trying to cross from Series A to B... or B to C...",
      "and suddenly, capital that once felt available feels much further away.",
    ],
    pace: "normal",
    delivery: "Stretching, the distance growing; slow on 'much further away'.",
    cues: [
      [0, stage("timeline", 3)],
      ["further", stage("timeline", 4)],
    ],
  },
  {
    act: 2,
    lines: [
      "Or maybe you’re not a startup at all.",
      "You’re an established business trying to finance expansion, enter a new market, acquire a competitor, or simply find the right growth capital.",
    ],
    pace: "normal",
    delivery: "Inclusive and steady, the list brisk and clear.",
    cues: [
      ["expansion", stage("photos", 18)],
      ["market", stage("photos", 19)],
      ["growth", stage("photos", 20)],
    ],
  },
  {
    act: 2,
    lines: [
      "Different stage.",
      "Same problem.",
      "Finding the right capital, from the right investor, at the right time is still painfully inefficient.",
    ],
    pace: "normal",
    delivery:
      "Two beats, 'Different stage.' then 'Same problem.', then a frank, slightly weary sentence.",
    tags: [["Same", "[short pause]"]],
    cues: [
      ["Different", stage("type", 3, "Different stage.")],
      ["Same", stage("type", 4, "Same problem.")],
    ],
  },
  {
    act: 2,
    lines: ["So you search.", "Pitch.", "Fly.", "Rewrite.", "Follow up."],
    pace: "brisk",
    delivery: "Quick and rhythmic, one verb per beat, the grind.",
    cues: [
      ["search", stage("icons", 1)],
      ["search", figure("MAGNIFIER", 900)],
      ["Pitch", stage("icons", 2)],
      ["Pitch", figure("DOCUMENT", 900)],
      ["Fly", stage("icons", 3)],
      ["Fly", figure("PLANE", 900)],
      ["Rewrite", stage("icons", 4)],
      ["Rewrite", figure("PEN", 900)],
      ["Follow", stage("icons", 5)],
      ["Follow", figure("ENVELOPE", 1_500)],
    ],
  },
  {
    act: 2,
    lines: [
      "Then finally...",
      "an investor leans in.",
      "You send everything.",
      "Hope rises.",
    ],
    pace: "normal",
    delivery: "Hope building, warmer with each line.",
    cues: [
      ["leans", stage("warmth", 1)],
      ["Hope", stage("warmth", 2)],
    ],
  },
  {
    act: 2,
    lines: ["Then...", "silence."],
    pace: "slow",
    delivery: "'Then...' held, then 'silence.' almost whispered. Then stop.",
    tags: [
      ["silence", "[long pause]"],
      ["silence", "[whispers]"],
    ],
    cues: [
      [0, mood("HUSH")],
      ["silence", stage("none")],
    ],
    silenceAfterMs: 1_200,
  },
  {
    act: 2,
    lines: ["You follow up.", "Nothing.", "Again.", "Nothing."],
    pace: "slow",
    delivery: "Sparse. Each word landing in quiet.",
    tags: [
      ["Nothing", "[pause]"],
      ["Again", "[pause]"],
      ["Nothing#2", "[pause]"],
    ],
    cues: [
      [0, mood("DAY")],
      ["follow", stage("bubbles", 1)],
      ["follow", figure("ENVELOPE", 3_000)],
      ["Again", stage("bubbles", 2)],
    ],
  },
  {
    act: 2,
    lines: [
      "Sometimes a “no” almost feels like mercy...",
      "because at least it gives you your time back.",
    ],
    pace: "slow",
    delivery: "Rueful, with a soft, sad laugh on 'mercy'.",
    tags: [["mercy...", "[laughs softly]"]],
    cues: [[0, stage("none")]],
  },
  {
    act: 2,
    lines: [
      "Silence keeps you trapped between hope and reality while runway, momentum, and opportunity quietly disappear.",
    ],
    pace: "slow",
    delivery: "Quiet and grave, slowing on 'quietly disappear'.",
    cues: [
      ["runway", stage("fade-words", 1)],
      ["quietly", stage("fade-words", 2)],
      ["disappear", stage("fade-words", 4)],
    ],
  },
  {
    act: 2,
    lines: [
      "Maybe it was the wrong stage.",
      "Wrong geography.",
      "Wrong cheque size.",
      "Wrong thesis.",
    ],
    pace: "normal",
    delivery: "Crisp list, each 'Wrong' clean and even.",
    cues: [
      ["stage", stage("chips-mismatch", 1)],
      ["geography", stage("chips-mismatch", 2)],
      ["cheque", stage("chips-mismatch", 3)],
      ["thesis", stage("chips-mismatch", 4)],
    ],
  },
  {
    act: 2,
    lines: [
      "Or maybe they were right...",
      "and you just weren’t ready.",
      "Weak governance.",
      "Unclear numbers.",
      "Messy structure.",
      "Strong traction told badly.",
    ],
    pace: "normal",
    delivery:
      "'and you just weren't ready.' gentle and honest, never mocking. Then a crisp list.",
    tags: [["and", "[softly]"]],
    cues: [
      ["governance", stage("chips-readiness", 1)],
      ["numbers", stage("chips-readiness", 2)],
      ["structure", stage("chips-readiness", 3)],
      ["traction", stage("chips-readiness", 4)],
    ],
  },
  {
    act: 2,
    lines: [
      "So you pitch more.",
      "Wait longer.",
      "There has to be a better way.",
    ],
    pace: "slow",
    delivery: "Weary, then a breath before 'There has to be a better way.'",
    tags: [["There", "[sighs]"]],
    cues: [["There", stage("none")]],
  },
  // ── Act 3: The turn ───────────────────────────────────────────────────
  {
    act: 3,
    lines: ["And there is."],
    pace: "slow",
    delivery: "Confident warmth; the smile comes back.",
    tags: [[0, "[warmly]"]],
    cues: [[0, mood("WAKE")]],
  },
  {
    act: 3,
    lines: ["CapitalQ."],
    pace: "normal",
    delivery: "A proud, clear beat, said as 'Capital Q'.",
    tags: [[0, "[proud]"]],
    cues: [[0, stage("wordmark", 1)]],
  },
  // ── Act 4: For investors ──────────────────────────────────────────────
  {
    act: 4,
    lines: [
      "Think TikTok for investment discovery...",
      "plus Jarvis from Iron Man...",
      "built for the entire investment journey.",
    ],
    pace: "brisk",
    delivery:
      "Playful energy. A light laugh on 'plus Jarvis from Iron Man'. Assured on 'the entire investment journey'.",
    tags: [
      [0, "[playful]"],
      // S5 (3 takes): "[laughs softly]" was not performed here; a chuckle is.
      ["plus", "[chuckles]"],
    ],
    cues: [
      [0, go("discover")],
      ["TikTok", stage("none")],
      ["discovery...", light("qs.discover.card")],
      ["Jarvis", light("qs.dock")],
      ["entire", light("qs.nav.discover")],
      ["investment#2", light("qs.nav.explore")],
      ["journey", light("qs.nav.crm")],
    ],
  },
  {
    act: 4,
    lines: [
      "I learn how you invest.",
      "Your thesis.",
      "Stage.",
      "Sectors.",
      "Geography.",
      "Cheque size.",
      "Preferences.",
      "Minimum criteria.",
    ],
    pace: "normal",
    delivery: "Brisk and assured: one word per section, each clean.",
    cues: [
      [0, go("capital-mandate")],
      ["learn", light("qs.mandate")],
      ["thesis", light("qs.mandate.thesis")],
      ["thesis", stage("chips-mismatch", 5)],
      ["Stage", light("qs.mandate.stage")],
      ["Stage", stage("chips-mismatch", 6)],
      ["Sectors", light("qs.mandate.sectors")],
      ["Geography", light("qs.mandate.geography")],
      ["Geography", stage("chips-mismatch", 7)],
      ["Cheque", light("qs.mandate.cheque")],
      ["Cheque", stage("chips-mismatch", 8)],
      ["Preferences", light("qs.mandate.preferences")],
      ["Minimum", light("qs.mandate.minimum")],
    ],
  },
  {
    act: 4,
    lines: ["Then I configure what you discover around that."],
    pace: "normal",
    delivery: "Assured and simple.",
    cues: [
      [0, stage("none")],
      [0, go("discover")],
      ["discover", light("qs.discover.card")],
    ],
  },
  {
    act: 4,
    lines: ["You swipe aligned opportunities, like Tiktok,"],
    pace: "brisk",
    delivery: "Light and quick, a smile.",
    cues: [
      ["swipe", light("qs.discover.card")],
      ["aligned", light("qs.discover.why")],
    ],
  },
  {
    act: 4,
    lines: ["And swipe to match with founders, like Tinder"],
    pace: "brisk",
    delivery: "Playful, a little cheeky on 'like Tinder'.",
    tags: [["like", "[playful]"]],
    cues: [["match", light("qs.discover.interest")]],
  },
  {
    act: 4,
    lines: [
      "Ask me anything.",
      "Compare businesses.",
      "Interrogate assumptions.",
      "Prepare for meetings.",
    ],
    pace: "brisk",
    delivery: "Brisk and assured, one capability per line.",
    cues: [
      ["Ask", light("qs.dock")],
      ["Ask", stage("top-three", 1)],
      ["Compare", stage("comparison", 1)],
      ["Interrogate", stage("none")],
      ["Interrogate", go("company-diligence")],
      ["assumptions", light("qs.profile.diligence")],
      ["Prepare", go("relationship-prep")],
      ["meetings", light("qs.relationship.prep")],
    ],
  },
  {
    act: 4,
    lines: [
      "And before you meet the business, I can run the Interview Before the Interview...",
      "so meetings become decisions, not introductions.",
    ],
    pace: "normal",
    delivery:
      "Knowing, a small flourish on 'the Interview Before the Interview'. 'so meetings become decisions, not introductions' lands as a punchline.",
    tags: [["so", "[confident]"]],
    cues: [
      ["run", go("gateq-application")],
      ["Interview", light("qs.gateq.transcript")],
      ["decisions,", light("qs.gateq.brief")],
    ],
  },
  {
    act: 4,
    lines: ["And for inbound...", "there’s GateQ."],
    pace: "normal",
    delivery: "A small reveal, proud on 'GateQ' (said 'Gate Q').",
    tags: [["there’s", "[proud]"]],
    cues: [
      [0, go("gateq-gate")],
      ["GateQ.", light("qs.gateq.gate")],
    ],
  },
  {
    act: 4,
    lines: [
      "You plug it into your website, application page, social media, accelerator, investment programme...",
      "anywhere businesses already come to you.",
    ],
    pace: "brisk",
    delivery: "A brisk list, easy and confident.",
    cues: [
      ["plug", light("qs.gateq.link")],
      ["website,", stage("icons", 11)],
      ["application", stage("icons", 12)],
      ["social", stage("icons", 13)],
      ["accelerator,", stage("icons", 14)],
      ["programme...", stage("icons", 15)],
    ],
  },
  {
    act: 4,
    lines: [
      "Every inbound opportunity lands in one place.",
      "I interview them.",
      "Score them.",
      "Match them against your thesis and criteria.",
      "Then rank them by suitability and investibility.",
      "So you don’t dig through the whole haystack.",
      "The opportunities most relevant to you rise to the top.",
    ],
    pace: "brisk",
    delivery: "Brisk and assured; a satisfied lift on 'rise to the top'.",
    cues: [
      [0, stage("none")],
      [0, go("gateq-inbox")],
      ["lands", light("qs.gateq.inbox")],
      ["interview", light("qs.gateq.transcript")],
      ["rise", light("qs.gateq.inbox")],
    ],
  },
  // ── Act 5: For businesses ─────────────────────────────────────────────
  {
    act: 5,
    lines: [
      "For businesses, I become the investment associate many could never justify hiring full-time.",
      "Whether this is your first raise...",
      "your fifth...",
      "a Series B...",
      "a down round...",
      "or growth capital for an established company...",
      "I help you understand what investors will see before they see it.",
    ],
    pace: "normal",
    delivery:
      "Warm and proud. The stage callbacks are tender, echoing the founder's story.",
    tags: [
      [0, "[warmly]"],
      ["Whether", "[softly]"],
    ],
    cues: [
      [0, unlight],
      [0, mood("STORY")],
      ["first", stage("timeline", 6)],
      ["fifth...", stage("timeline", 7)],
      ["Series", stage("timeline", 8)],
      ["down", stage("timeline", 9)],
      ["growth", stage("timeline", 10)],
    ],
  },
  {
    act: 5,
    lines: [
      "Investability IQ shows what is ready.",
      "What is weak.",
      "Why it matters.",
      "And what could be blocking your raise.",
    ],
    pace: "normal",
    delivery: "Clear and caring, one finding per line.",
    cues: [
      [0, stage("investiq", 0)],
      ["ready.", stage("investiq", 1)],
      ["weak.", stage("investiq", 2)],
      ["matters.", stage("investiq", 3)],
      ["blocking", stage("investiq", 4)],
    ],
  },
  {
    act: 5,
    lines: [
      "Then I help match you with investors you genuinely suit.",
      "Not simply who could invest.",
      "Who should.",
    ],
    pace: "normal",
    delivery: "Warm; 'Who should.' is the emphatic lean-in.",
    tags: [["Who", "[pause]"]],
    cues: [
      ["match", stage("investor-matches", 1)],
      ["should.", stage("investor-matches", 2)],
    ],
  },
  // ── Act 6: The close ──────────────────────────────────────────────────
  {
    act: 6,
    lines: [
      "And then...",
      "behavior changes.",
      "Tomorrow, instead of:",
      "“Send me your deck.”",
      "They ask:",
      "“What’s your Q Card?”",
    ],
    pace: "slow",
    delivery:
      "Knowing. 'Send me your deck.' in a tired, gruff investor voice, comic. 'What's your Q Card?' bright and curious.",
    tags: [
      ["“Send", "[gruff]"],
      ["“What’s", "[curious]"],
    ],
    cues: [
      ["“Send", stage("deck-to-card", 1)],
      ["They", stage("deck-to-card", 2)],
      ["Card?”", stage("q-card", 1)],
    ],
  },
  {
    act: 6,
    lines: [
      "One living private-capital identity with your story, your numbers, your raise, your intelligence, and your relationships.",
    ],
    pace: "normal",
    delivery: "Rhythmic noun list, warm and even.",
    cues: [
      // The real card's own sections (S6, CARD_SECTION_IDS), one per noun.
      ["identity", light("qs.card.identity")],
      ["story,", light("qs.card.story")],
      ["numbers,", light("qs.card.numbers")],
      ["raise,", light("qs.card.raise")],
      ["intelligence,", light("qs.card.intelligence")],
      ["relationships.", light("qs.card.relationships")],
    ],
  },
  {
    act: 6,
    lines: ["One platform.", "Both sides."],
    pace: "slow",
    delivery: "Two calm, confident beats.",
    cues: [
      [0, { kind: "unlight" }],
      ["Both", stage("split", 1)],
    ],
  },
  {
    act: 6,
    lines: [
      "Discovery.",
      "Inbound.",
      "Intelligence.",
      "Readiness.",
      "Matching.",
      "Data.",
      "Relationships.",
      "Execution.",
    ],
    pace: "normal",
    delivery: "Rhythmic, one word per beat, assured, gathering pace.",
    cues: [
      ["Discovery", stage("screens", 1)],
      ["Inbound", stage("screens", 2)],
      ["Intelligence", stage("screens", 3)],
      ["Readiness", stage("screens", 4)],
      ["Matching", stage("screens", 5)],
      ["Data", stage("screens", 6)],
      ["Relationships", stage("screens", 7)],
      ["Execution", stage("screens", 8)],
    ],
  },
  {
    act: 6,
    lines: [
      "What normally takes weeks, months and even years...",
      "Now take minutes.",
    ],
    pace: "slow",
    delivery:
      "Drawn out on 'weeks, months and even years', then crisp on 'Now take minutes'.",
    tags: [["Now", "[pause]"]],
    cues: [
      ["weeks,", stage("stopwatch", 1)],
      ["minutes.", stage("stopwatch", 2)],
    ],
  },
  {
    act: 6,
    lines: [
      "Better opportunities reach investors faster.",
      "Bad fits disappear earlier.",
      "Businesses become more investment-ready.",
      "Founders and companies spend less time chasing.",
      "Investors spend more time investing.",
    ],
    pace: "normal",
    delivery: "Calm and confident, five even lines.",
    cues: [
      [0, stage("lines", 1)],
      ["Bad", stage("lines", 2)],
      ["Businesses", stage("lines", 3)],
      ["Founders", stage("lines", 4)],
      ["Investors", stage("lines", 5)],
    ],
  },
  {
    act: 6,
    lines: [
      "Private capital has trillions of dollars.",
      "What it still doesn’t have...",
      "is a HOME)",
    ],
    pace: "slower",
    delivery:
      "Reverent and slow. A pause after 'doesn't have', then 'home' soft and certain.",
    tags: [
      [0, "[slowly]"],
      ["is", "[long pause]"],
      ["HOME)", "[softly]"],
    ],
    cues: [
      [0, stage("none")],
      ["trillions", stage("type", 5, "Trillions of dollars")],
      ["What", stage("none")],
      ["HOME)", go("home")],
      ["HOME)", mood("WAKE")],
      ["HOME)", figure("HOUSE", 4_000)],
    ],
  },
  {
    act: 6,
    lines: ["I’m Q."],
    pace: "slow",
    delivery: "Warm, simple, personal.",
    tags: [[0, "[warmly]"]],
    cues: [
      [0, stage("aperture", 2)],
      [0, figure("LETTER_Q", 3_000)],
    ],
  },
  {
    act: 6,
    lines: [
      "And when the old way finally disappears...",
      "you won’t wonder why private capital changed.",
      "You’ll wonder...",
      "HOW WE EVER DID IT WITHOUT ME.",
    ],
    pace: "slow",
    delivery:
      "Confident. A pause before the last line, then said with a small grin and a laugh on 'WITHOUT ME'.",
    tags: [
      ["HOW", "[pause]"],
      // S5: a laugh before "WITHOUT" was not performed; after the line it is.
      ["$end", "[laughs]"],
    ],
    cues: [["HOW", stage("type", 6, "How we ever did it without me.")]],
  },
];

function build(input: BeatInput, index: number): StoryBeat {
  const words = input.lines.join(" ").split(/\s+/u).filter(Boolean);
  const n = index + 1;
  const cues: StoryCue[] = (input.cues ?? []).map(([on, act]) => ({
    at: wordIndex(words, on),
    act,
  }));
  return StoryBeatSchema.parse({
    n,
    id: `beat-${String(n).padStart(2, "0")}`,
    act: input.act,
    lines: [...input.lines],
    words,
    pace: input.pace,
    delivery: input.delivery,
    tags: (input.tags ?? []).map(([on, tag]) => ({
      at: on === "$end" ? words.length : wordIndex(words, on),
      tag,
    })),
    // Stable order by word, then as written (two acts on one word).
    cues: cues
      .map((cue, order) => ({ cue, order }))
      .sort((a, b) => a.cue.at - b.cue.at || a.order - b.order)
      .map(({ cue }) => cue),
    silenceAfterMs: input.silenceAfterMs ?? 0,
  });
}

export const STORY_BEATS: readonly StoryBeat[] = Object.freeze(
  inputs.map(build),
);

if (STORY_BEATS.length !== 56) {
  throw new Error(`Q Story has ${String(STORY_BEATS.length)} beats, not 56`);
}

/** The whole story as spoken text (the title is not spoken). */
export function storyText(beats: readonly StoryBeat[] = STORY_BEATS): string {
  return beats.map((beat) => beat.words.join(" ")).join(" ");
}

/**
 * The text sent to the renderer for one beat: the verbatim words with the
 * beat's audio tags in place. Only presentation changes, never a word: a
 * stray ")" (the owner's "HOME)") is left unspoken, and "CapitalQ" and
 * "GateQ" are spaced so the voice says the names, not a run-on word.
 */
export function renderText(beat: StoryBeat): string {
  const before = new Map<number, string[]>();
  for (const { at, tag } of beat.tags) {
    before.set(at, [...(before.get(at) ?? []), tag]);
  }
  const parts: string[] = [];
  for (const [index, word] of beat.words.entries()) {
    parts.push(...(before.get(index) ?? []));
    parts.push(spokenForm(word));
  }
  parts.push(...(before.get(beat.words.length) ?? []));
  return parts.join(" ");
}

/** A word as the voice should say it (letters unchanged, see renderText). */
export function spokenForm(word: string): string {
  return word
    .replace(/^([^(]*)\)$/u, "$1")
    .replace(/CapitalQ/u, "Capital Q")
    .replace(/GateQ/u, "Gate Q");
}

/** The beat the plan calls "the product part": "And there is." */
export const STORY_PRODUCT_BEAT = 33;
