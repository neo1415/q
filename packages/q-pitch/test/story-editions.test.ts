import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BeatAlignmentSchema,
  STORY_BEATS,
  STORY_EDITIONS,
  STORY_EDITION_IDS,
  cutAlignment,
  editionBeats,
  editionProductStep,
  parseStoryCommand,
} from "../src/index.js";

/**
 * The three editions (owner, 22 Oct): verbatim subsets of the story, each
 * its own cut. Nothing reworded, nothing new to say; a part of a beat is
 * whole lines of it.
 */
const beat = (n: number) => {
  const found = STORY_BEATS[n - 1];
  if (found === undefined) throw new Error(`no beat ${String(n)}`);
  return found;
};

describe("Q Story editions", () => {
  it("are verbatim: every line an edition says is a line of the story", () => {
    for (const id of STORY_EDITION_IDS) {
      for (const part of editionBeats(STORY_EDITIONS[id])) {
        const lines = beat(part.n).lines;
        for (const line of part.lines) expect(lines).toContain(line);
        expect(part.words).toEqual(
          part.lines.join(" ").split(/\s+/u).filter(Boolean),
        );
      }
    }
  });

  it("are distinct cuts, each with its own version", () => {
    const versions = STORY_EDITION_IDS.map((id) => STORY_EDITIONS[id].version);
    expect(new Set(versions).size).toBe(3);
    expect(editionBeats(STORY_EDITIONS.FULL)).toHaveLength(56);
  });

  it("cuts the investor story as the owner set it", () => {
    const parts = editionBeats(STORY_EDITIONS.INVESTOR);
    expect(parts.map((p) => p.n)).toEqual([
      ...Array.from({ length: 14 }, (_, i) => i + 1),
      32,
      ...Array.from({ length: 12 }, (_, i) => i + 33),
      46,
      ...Array.from({ length: 9 }, (_, i) => i + 48),
    ]);
    const cut = parts[14];
    expect(cut?.lines).toEqual(["There has to be a better way."]);
    expect(cut?.cut).toEqual({ from: 6, to: 13 });
    // The voice's sigh before the line stays with it.
    expect(cut?.tags).toEqual([{ at: 0, tag: "[sighs]" }]);
  });

  it("starts the founder story with the business, never 'the other side of the table'", () => {
    const ns = editionBeats(STORY_EDITIONS.FOUNDER).map((p) => p.n);
    expect(ns.slice(0, 3)).toEqual([1, 2, 16]);
    expect(ns).not.toContain(15);
    for (const n of [36, 37, 38, 39, 40, 41, 42, 43, 44]) {
      expect(ns).not.toContain(n);
    }
  });

  it("cuts a part's audio at word boundaries, with its own lead-in and a breath", () => {
    const dir = new URL(
      "../../../apps/web/public/story-media/pFZP5JQG7iQjIQuC4Bku/",
      import.meta.url,
    );
    const index = JSON.parse(
      readFileSync(fileURLToPath(new URL("index.json", dir)), "utf8"),
    ) as { files: Record<string, { alignment: string }> };
    const file = index.files["beat-32"]?.alignment ?? "";
    const full = BeatAlignmentSchema.parse(
      JSON.parse(readFileSync(fileURLToPath(new URL(file, dir)), "utf8")),
    );
    const { alignment, window } = cutAlignment(full, { from: 6, to: 13 });
    expect(alignment.words).toHaveLength(7);
    // Starts after "longer." ends (the sigh is the line's), ends a breath
    // after "way.", and never cuts into a word.
    expect(window.offsetMs).toBeGreaterThan(full.words[5]?.endMs ?? 0);
    expect(window.offsetMs).toBeLessThan(full.words[6]?.startMs ?? 0);
    expect(window.offsetMs + window.durationMs).toBeGreaterThan(
      full.words[12]?.endMs ?? 0,
    );
    expect(alignment.words[0]?.startMs).toBeGreaterThan(0);
  });

  it("skips to the product where the edition has it", () => {
    const parts = editionBeats(STORY_EDITIONS.INVESTOR);
    const step = editionProductStep(parts, 33);
    expect(step).toBe(16);
    expect(
      parseStoryCommand("skip to the product", 0, parts.length, step ?? 33),
    ).toEqual({
      kind: "MOVE",
      move: { kind: "STEP", step: 16 },
    });
  });
});
