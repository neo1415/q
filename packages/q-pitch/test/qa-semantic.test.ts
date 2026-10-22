import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  QA_BANK,
  QA_VECTORS_FORMAT,
  buildQaIndex,
  buildQaSemanticIndex,
  checkQaVectors,
  combineQaTiers,
  decodeQaVector,
  encodeQaVector,
  qaBankContentHash,
  qaWordings,
  type QaEntry,
  type QaMatch,
  type QaVectorsFile,
} from "../src/index.js";

import {
  BLIND,
  BLIND_NOT_IN_BANK,
  HELD_OUT,
  NOT_IN_BANK,
} from "./qa-heldout.js";

const PACKAGE = join(import.meta.dirname, "..");
const VECTORS = join(PACKAGE, "data", "qa-bank-vectors.json");
const HELD_OUT_VECTORS = join(
  PACKAGE,
  "test",
  "data",
  "qa-heldout-vectors.json",
);

const entry = (id: string, question: string): QaEntry => ({
  id,
  side: "BOTH",
  question,
  paraphrases: [`${question} today`, `${question} please`],
  answer: "A prepared answer long enough for the schema.",
  sources: ["docs/specs/q-pitch/story/INVESTOR-QA.md"],
});

/** Three entries on three axes of a small space. */
const ALPHA = entry("qa.alpha", "alpha question");
const BETA = entry("qa.beta", "beta question");
const GAMMA = entry("qa.gamma", "gamma question");
const TINY = [ALPHA, BETA, GAMMA];
const axis = (i: number, dimension = 16) =>
  Array.from({ length: dimension }, (_, j) => (j === i ? 1 : 0.02));
const tinyFile = (bank: readonly QaEntry[] = TINY): QaVectorsFile => ({
  format: QA_VECTORS_FORMAT,
  configurationVersion: "test",
  modelCode: "test-model",
  dimension: 16,
  contentHash: qaBankContentHash(bank),
  createdAt: "2026-10-22T00:00:00Z",
  thresholds: { answer: 0.8, margin: 0.1, clarifyFloor: 0.5 },
  calibration: {},
  entries: bank.map((e, i) => ({
    id: e.id,
    vectors: qaWordings(e).map(() => encodeQaVector(axis(i))),
  })),
});
const query = (values: readonly number[]) =>
  decodeQaVector(encodeQaVector(values));

describe("tier 2: meaning by embedding", () => {
  it("keeps a vector through int8 storage", () => {
    const v = Array.from({ length: 64 }, (_, i) => Math.sin(i + 1));
    const back = decodeQaVector(encodeQaVector(v));
    const norm = Math.hypot(...v);
    const cosine = v.reduce((s, x, i) => s + (x / norm) * (back[i] ?? 0), 0);
    expect(cosine).toBeGreaterThan(0.999);
  });

  it("fingerprints the wordings, so a changed bank makes vectors stale", () => {
    const changed = [
      { ...ALPHA, question: "alpha, reworded" },
      ...TINY.slice(1),
    ];
    expect(qaBankContentHash(TINY)).toMatch(/^[0-9a-f]{16}$/u);
    expect(qaBankContentHash(changed)).not.toBe(qaBankContentHash(TINY));
    expect(checkQaVectors(tinyFile(), TINY).kind).toBe("READY");
    expect(checkQaVectors(tinyFile(), changed).kind).toBe("STALE");
    expect(checkQaVectors({ format: "something else" }, TINY).kind).toBe(
      "INVALID",
    );
  });

  it("answers when close and clear, asks on a close call, else leaves", () => {
    const index = buildQaSemanticIndex("INVESTOR", tinyFile(), TINY);
    const near = index.decide(query(axis(0)));
    expect(near.kind === "ANSWER" && near.entry.id).toBe("qa.alpha");
    const between = index.decide(
      query(axis(0).map((v, i) => (i === 1 ? 1 : v))),
    );
    expect(between.kind).toBe("CLARIFY");
    if (between.kind === "CLARIFY") {
      expect(between.candidates.map((c) => c.id).sort()).toEqual([
        "qa.alpha",
        "qa.beta",
      ]);
      expect(between.prompt).toMatch(/^Do you mean .+, or .+\?$/u);
    }
    const far = index.decide(query(axis(9)));
    expect(far.kind).toBe("LEAVE_TO_Q");
  });

  it("never lets tier 2 overrule a confident tier 1", () => {
    const answer = (e: QaEntry): QaMatch => ({
      kind: "ANSWER",
      entry: e,
      score: 1,
    });
    const leave: QaMatch = { kind: "LEAVE_TO_Q" };
    const ask: QaMatch = { kind: "CLARIFY", candidates: [BETA], prompt: "?" };
    expect(combineQaTiers(answer(ALPHA), answer(BETA))).toEqual(answer(ALPHA));
    expect(combineQaTiers(leave, answer(BETA))).toEqual(answer(BETA));
    expect(combineQaTiers(leave, ask)).toEqual(ask);
    expect(combineQaTiers(ask, leave)).toEqual(ask);
    expect(combineQaTiers(leave, null)).toEqual(leave);
  });
});

// The committed vectors (scripts/q-pitch/embed-qa-bank.mjs --live). Until
// that paid run is approved and made, tier 2 is off in the Q API and these
// two checks report themselves as skipped.
const committed = existsSync(VECTORS);
describe.skipIf(!committed)("the committed bank vectors", () => {
  it("were made from this bank (rebuild them when wordings change)", () => {
    const status = checkQaVectors(JSON.parse(readFileSync(VECTORS, "utf8")));
    expect(status.kind).toBe("READY");
  });

  it.skipIf(!existsSync(HELD_OUT_VECTORS))(
    "answer correctly when they answer, and never an unrelated question",
    () => {
      const status = checkQaVectors(JSON.parse(readFileSync(VECTORS, "utf8")));
      if (status.kind !== "READY") throw new Error(status.kind);
      const stored = JSON.parse(readFileSync(HELD_OUT_VECTORS, "utf8")) as {
        vectors: Record<string, string>;
      };
      const vector = (text: string) => {
        const encoded = stored.vectors[text];
        if (encoded === undefined) throw new Error(`no vector: ${text}`);
        return decodeQaVector(encoded);
      };
      const sides = {
        INVESTOR: [
          buildQaIndex("INVESTOR"),
          buildQaSemanticIndex("INVESTOR", status.file),
        ],
        FOUNDER: [
          buildQaIndex("FOUNDER"),
          buildQaSemanticIndex("FOUNDER", status.file),
        ],
      } as const;
      const sideOf = (id: string) =>
        QA_BANK.find((e) => e.id === id)?.side === "FOUNDER"
          ? "FOUNDER"
          : "INVESTOR";
      const both = (text: string, side: "INVESTOR" | "FOUNDER") => {
        const [words, meaning] = sides[side];
        return combineQaTiers(words.match(text), meaning.decide(vector(text)));
      };
      for (const [questions, unrelated] of [
        [HELD_OUT, NOT_IN_BANK],
        [BLIND, BLIND_NOT_IN_BANK],
      ] as const) {
        let right = 0;
        let wrong = 0;
        for (const [text, id] of questions) {
          const decided = both(text, sideOf(id));
          if (decided.kind !== "ANSWER") continue;
          if (decided.entry.id === id) right += 1;
          else wrong += 1;
        }
        expect(right / Math.max(1, right + wrong)).toBeGreaterThanOrEqual(0.9);
        for (const text of unrelated) {
          for (const side of ["INVESTOR", "FOUNDER"] as const) {
            expect(both(text, side).kind, text).not.toBe("ANSWER");
          }
        }
      }
    },
  );
});
