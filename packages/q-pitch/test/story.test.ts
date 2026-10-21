import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ACT_BUDGET_MS,
  ActVerifier,
  BeatCueClock,
  CUE_LEAD_MS,
  FIXTURE_ALIGNMENTS,
  MONTAGE_PICTURES,
  STORY_BEATS,
  STORY_PICTURES,
  STORY_PRODUCT_BEAT,
  STORY_ROUTES,
  STORY_TITLE,
  StoryBeatSchema,
  classifyStoryTrigger,
  fixtureAlignment,
  msAtWord,
  parseStoryCommand,
  percentiles,
  renderText,
  routeAtBeat,
  scheduleBeat,
  storyManifest,
  storyRoutes,
  storyText,
  warmRoutes,
  wordAt,
  wordsFromCharacters,
  type ElevenLabsAlignment,
  type StoryBeat,
} from "../src/index.js";

const VERBATIM = readFileSync(
  fileURLToPath(
    new URL(
      "../../../docs/specs/q-pitch/story/Q_STORY_VERBATIM.txt",
      import.meta.url,
    ),
  ),
  "utf8",
);

/** Line-break layout is the only thing ignored: every character else counts. */
const layoutFree = (text: string) => text.replace(/\s+/gu, " ").trim();

function beat(n: number): StoryBeat {
  const found = STORY_BEATS[n - 1];
  if (found === undefined) throw new Error(`no beat ${String(n)}`);
  return found;
}

describe("Q Story beat table", () => {
  it("is the owner's story, word for word", () => {
    expect(layoutFree(`${STORY_TITLE} ${storyText()}`)).toBe(
      layoutFree(VERBATIM),
    );
  });

  it("fails on a single changed word", () => {
    const changed = STORY_BEATS.map((b) =>
      b.n === 13
        ? { ...b, words: b.words.map((w) => (w === "great" ? "good" : w)) }
        : b,
    );
    expect(layoutFree(`${STORY_TITLE} ${storyText(changed)}`)).not.toBe(
      layoutFree(VERBATIM),
    );
  });

  it("has 56 valid beats, numbered in order, with words matching lines", () => {
    expect(STORY_BEATS).toHaveLength(56);
    STORY_BEATS.forEach((b, index) => {
      expect(b.n).toBe(index + 1);
      expect(StoryBeatSchema.safeParse(b).success).toBe(true);
      expect(b.words.join(" ")).toBe(layoutFree(b.lines.join(" ")));
    });
  });

  it("keeps delivery tags out of the words", () => {
    for (const b of STORY_BEATS) {
      for (const word of b.words) expect(word).not.toMatch(/^\[.*\]$/u);
      // The rendered text is the words plus tags, nothing else.
      const stripped = renderText(b)
        .replace(/\[[^\]]+\]/gu, "")
        .replace(/\s+/gu, " ")
        .trim();
      expect(stripped.replace(/[^\p{L}\p{N}]/gu, "")).toBe(
        b.words.join("").replace(/[^\p{L}\p{N}]/gu, ""),
      );
    }
  });

  it("anchors the plan's per-word cues on their words", () => {
    const at = (n: number, word: string) =>
      beat(n).cues.filter((c) => beat(n).words[c.at]?.startsWith(word));
    for (const word of ["Decks", "Introductions", "Referrals", "Applications"])
      expect(at(6, word)).toHaveLength(1);
    for (const word of ["thesis", "Stage", "Sectors", "Geography", "Cheque"])
      expect(at(36, word).some((c) => c.act.kind === "light")).toBe(true);
    // "HOME" navigates home, literally.
    expect(at(54, "HOME")[0]?.act).toEqual({ kind: "navigate", route: "home" });
    // #26: 1.2 s of real silence.
    expect(beat(26).silenceAfterMs).toBe(1_200);
  });

  it("visits every story route, Discover first, and ends at home", () => {
    const routes = storyRoutes();
    expect(new Set(routes)).toEqual(new Set(STORY_ROUTES));
    expect(routes[0]).toBe("discover");
    expect(routeAtBeat(56)).toBe("home");
    expect(routeAtBeat(0)).toBeNull();
    expect(routeAtBeat(39)).toBe("discover");
  });

  it("never presses a consequential control: Express Interest is lit, not pressed", () => {
    const acts = STORY_BEATS.flatMap((b) => b.cues.map((c) => c.act));
    expect(
      acts.every((a) =>
        ["mood", "stage", "navigate", "light", "unlight", "figure"].includes(
          a.kind,
        ),
      ),
    ).toBe(true);
    expect(beat(39).cues.map((c) => c.act)).toContainEqual({
      kind: "light",
      anchor: "qs.discover.interest",
    });
  });
});

describe("Q Story alignment", () => {
  it("fixture alignments fit their beats and run about seven minutes", () => {
    FIXTURE_ALIGNMENTS.forEach((a, index) => {
      expect(a.words).toHaveLength(beat(index + 1).words.length);
      expect(a.voice).toBe("fixture");
    });
    const totalMs = FIXTURE_ALIGNMENTS.reduce(
      (sum, a, i) => sum + a.durationMs + beat(i + 1).silenceAfterMs,
      0,
    );
    expect(totalMs / 60_000).toBeGreaterThan(5.5);
    expect(totalMs / 60_000).toBeLessThan(8.5);
  });

  it("turns ElevenLabs character timings (tags included) into word timings", () => {
    const b = beat(6);
    const text = renderText(b);
    const alignment: ElevenLabsAlignment = {
      characters: [...text],
      character_start_times_seconds: [...text].map((_, i) => i * 0.05),
      character_end_times_seconds: [...text].map((_, i) => i * 0.05 + 0.04),
    };
    const words = wordsFromCharacters(b, alignment);
    expect(words).toHaveLength(4);
    expect(words[0]?.startMs).toBe(0);
    // "Introductions" starts after "[short pause] ".
    expect(words[1]?.startMs).toBe(text.indexOf("Introductions") * 50);
    expect(
      words.every((w, i) => i === 0 || w.startMs > (words[i - 1]?.endMs ?? 0)),
    ).toBe(true);
  });

  it("refuses audio that does not say the script", () => {
    const b = beat(1);
    const wrong = "Hi. I am Q.";
    expect(() =>
      wordsFromCharacters(b, {
        characters: [...wrong],
        character_start_times_seconds: [...wrong].map((_, i) => i / 10),
        character_end_times_seconds: [...wrong].map((_, i) => i / 10),
      }),
    ).toThrow(/audio/u);
  });

  it("finds the spoken word by time", () => {
    const a = fixtureAlignment(beat(6));
    expect(wordAt(a, -1)).toBe(-1);
    expect(wordAt(a, a.words[2]?.startMs ?? 0)).toBe(2);
    expect(wordAt(a, a.durationMs)).toBe(3);
    expect(msAtWord(a, 2)).toBe(a.words[1]?.endMs);
  });
});

describe("Q Story cue engine", () => {
  const b = beat(6);
  const a = fixtureAlignment(b);
  const cues = scheduleBeat(b, a);

  it("fires each cue 120 ms before its word, the first one before the audio starts", () => {
    expect(cues).toHaveLength(4);
    for (const cue of cues) {
      expect(cue.fireMs).toBe(cue.wordMs - CUE_LEAD_MS);
    }
    expect(cues[0]?.fireMs).toBe(-CUE_LEAD_MS);
  });

  it("releases cues once, in order, as the clock passes them", () => {
    const clock = new BeatCueClock(cues);
    expect(clock.due(-CUE_LEAD_MS - 1)).toEqual([]);
    expect(clock.due(-CUE_LEAD_MS).map((c) => c.wordIndex)).toEqual([0]);
    expect(clock.due(0)).toEqual([]);
    const third = cues[2];
    expect(clock.due(third?.fireMs ?? 0).map((c) => c.wordIndex)).toEqual([
      1, 2,
    ]);
    clock.seek(-CUE_LEAD_MS);
    expect(clock.remaining).toBe(4);
    expect(clock.due(a.durationMs)).toHaveLength(4);
  });

  it("falls back safely when an act misses its budget, and ignores a late ack", () => {
    const verifier = new ActVerifier();
    const nav = scheduleBeat(beat(36), fixtureAlignment(beat(36)))[0];
    if (nav === undefined) throw new Error("no cue");
    expect(nav.act.kind).toBe("navigate");
    verifier.begin(nav, 1_000);
    expect(verifier.expire(1_000 + ACT_BUDGET_MS.navigate)).toEqual([]);
    const expired = verifier.expire(1_001 + ACT_BUDGET_MS.navigate);
    expect(expired).toEqual([
      { kind: "SAFE_FALLBACK", cueId: nav.cueId, act: nav.act },
    ]);
    expect(verifier.acknowledge(nav.cueId, 9_000)).toBeNull();
  });

  it("acknowledges within budget and measures it", () => {
    const verifier = new ActVerifier();
    const cue = cues[1];
    if (cue === undefined) throw new Error("no cue");
    verifier.begin(cue, 100);
    expect(verifier.acknowledge(cue.cueId, 116)).toEqual({
      kind: "ACKNOWLEDGED",
      cueId: cue.cueId,
      ms: 16,
    });
    expect(verifier.expire(10_000)).toEqual([]);
  });

  it("summarises offsets", () => {
    expect(percentiles([5, 1, 3, 2, 4])).toEqual({
      median: 3,
      p95: 5,
      count: 5,
    });
    expect(percentiles([])).toEqual({ median: 0, p95: 0, count: 0 });
  });
});

describe("Q Story preload", () => {
  it("lists every asset before the story starts", () => {
    const manifest = storyManifest("cgSgspJ2msm6clMCkdW9");
    expect(manifest.audio).toHaveLength(56);
    expect(manifest.alignment).toHaveLength(56);
    expect(manifest.audio[0]).toBe(
      "/story-media/cgSgspJ2msm6clMCkdW9/beat-01.mp3",
    );
    expect(manifest.pictures).toHaveLength(STORY_PICTURES.length);
    expect(manifest.screens).toHaveLength(8);
    expect(manifest.routes.length).toBe(STORY_ROUTES.length);
    expect(storyManifest("fixture").audio).toEqual([]);
    expect(() => storyManifest("../etc")).toThrow();
  });

  it("keeps the next two beats' routes warm", () => {
    // Beat 34 (index 33) is followed by beats 35 (discover) and 36 (mandate).
    expect(warmRoutes(33)).toEqual(["discover", "capital-mandate"]);
    expect(warmRoutes(55)).toEqual([]);
  });

  it("has 20 credited pictures, 12 for the montage", () => {
    expect(STORY_PICTURES).toHaveLength(20);
    expect(MONTAGE_PICTURES).toHaveLength(12);
    for (const picture of STORY_PICTURES) {
      expect(picture.file).toMatch(/^\/story-media\/pictures\/\d{2}\.jpg$/u);
      expect(picture.photographer.length).toBeGreaterThan(0);
      expect(picture.source).toMatch(/^https:\/\/www\.pexels\.com\//u);
    }
    const used = STORY_BEATS.flatMap((b) =>
      b.cues.flatMap((c) =>
        c.act.kind === "stage" && c.act.visual === "photos" ? [c.act.step] : [],
      ),
    );
    for (const n of used)
      expect(STORY_PICTURES.some((p) => p.n === n)).toBe(true);
  });
});

describe("Q Story controls", () => {
  it("moves by beat with the v6 step commands", () => {
    expect(parseStoryCommand("next", 4)).toEqual({
      kind: "MOVE",
      move: { kind: "STEP", step: 6 },
    });
    expect(parseStoryCommand("go back two", 10)).toEqual({
      kind: "MOVE",
      move: { kind: "STEP", step: 9 },
    });
    expect(parseStoryCommand("go to step 40", 0)).toEqual({
      kind: "MOVE",
      move: { kind: "STEP", step: 40 },
    });
    expect(parseStoryCommand("pause", 3)).toEqual({
      kind: "MOVE",
      move: { kind: "PAUSE" },
    });
    expect(parseStoryCommand("carry on", 3)).toEqual({
      kind: "MOVE",
      move: { kind: "RESUME" },
    });
    expect(parseStoryCommand("go to step 80", 0)).toEqual({
      kind: "MOVE",
      move: { kind: "OUT_OF_RANGE" },
    });
  });

  it("knows the story's own words", () => {
    expect(parseStoryCommand("skip to the product part", 2)).toEqual({
      kind: "MOVE",
      move: { kind: "STEP", step: STORY_PRODUCT_BEAT },
    });
    expect(parseStoryCommand("hide captions", 2)).toEqual({
      kind: "CAPTIONS",
      on: false,
    });
    expect(parseStoryCommand("mute", 2)).toEqual({ kind: "MUTE", on: true });
    expect(parseStoryCommand("end the story", 2)).toEqual({ kind: "END" });
  });

  it("treats a question as a question", () => {
    expect(parseStoryCommand("how do you score companies?", 3)).toBeNull();
    expect(parseStoryCommand("what comes next for founders", 3)).toBeNull();
  });
});

describe("Q Story trigger", () => {
  it("starts the story when asked to present or pitch Capital Q", () => {
    for (const said of [
      "present Capital Q",
      "Pitch Capital Q",
      "Q, please pitch CapitalQ",
      "tell me your story",
      "Tell us your story please",
      "present Capital Q to us",
    ]) {
      expect(classifyStoryTrigger(said)).toEqual({ kind: "STORY" });
    }
  });

  it("answers 'What is Capital Q?' in two sentences and offers the story", () => {
    const brief = classifyStoryTrigger("What is Capital Q?");
    expect(brief?.kind).toBe("BRIEF");
    if (brief?.kind !== "BRIEF") return;
    expect(brief.answer.split(/(?<=[.!?])\s/u)).toHaveLength(2);
    expect(brief.offer).toMatch(/seven minutes/u);
    expect(classifyStoryTrigger("what's capital q")?.kind).toBe("BRIEF");
  });

  it("leaves everything else to Q", () => {
    for (const said of [
      "what is Capital Q's pricing?",
      "pitch me Harbourline Cargo",
      "show me my pitch deck",
      "what is a pitch deck?",
    ]) {
      expect(classifyStoryTrigger(said)).toBeNull();
    }
  });
});
