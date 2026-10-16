import { describe, expect, it } from "vitest";

import { createDailySpendCap } from "@capital-q/model-gateway";

import { createAnswerWords as createWords } from "../src/composition/answer-words.js";
import {
  ANSWER_WORDS_VERSION,
  createLineTranslator,
  type UiTextRow,
  type UiTextStore,
  type UiTextTranslator,
} from "../src/composition/ui-text.js";

/**
 * Q's code-written answers in any language (owner directive 2026-10-16):
 * one generic path through lane lang's translation layer. Only sentence
 * skeletons reach the translator; names and figures come back exactly.
 * No live calls: the translator is a stand-in.
 */
function memoryStore() {
  const rows = new Map<string, UiTextRow>();
  const store: UiTextStore = {
    read: (language, version) => {
      const accepted = new Map<string, string>();
      const settled = new Set<string>();
      for (const [key, row] of rows) {
        if (!key.startsWith(`${language}|${version}|`)) continue;
        settled.add(row.source);
        if (row.status === "ACCEPTED") accepted.set(row.source, row.text);
      }
      return Promise.resolve({ accepted, settled });
    },
    write: (language, version, written) => {
      for (const row of written) {
        const key = `${language}|${version}|${row.source}`;
        if (!rows.has(key)) rows.set(key, row);
      }
      return Promise.resolve();
    },
  };
  return { store, rows };
}

function translator(ok = true) {
  const seen: string[] = [];
  const translate: UiTextTranslator = (language, batch) => {
    seen.push(...batch);
    if (!ok) return Promise.resolve({ ok: false, reason: "UNAVAILABLE" });
    return Promise.resolve({
      ok: true,
      modelCode: "fake",
      costUsd: 0.001,
      result: {
        items: batch.map((text, i) => ({ i, t: `[${language.tag}] ${text}` })),
      },
    });
  };
  return { translate, seen };
}

/** The answer path over the interim cached line translator. */
const createAnswerWords = (deps: Parameters<typeof createLineTranslator>[0]) =>
  createWords({ translateLines: createLineTranslator(deps) });
const cap = (capUsd = 2) =>
  createDailySpendCap({ capUsd, readSpentSinceUsd: () => Promise.resolve(0) });
const who = {
  tenantId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
};
const ANSWER =
  "Here is one investor who could fit: AlRayan Investment LLC. Rimal Freight raised USD 1.5m.";

describe("code-written answers in any language", () => {
  it("translates sentence skeletons only, and puts the data back exactly", async () => {
    const { store, rows } = memoryStore();
    const fake = translator();
    const words = createAnswerWords({
      store,
      translate: fake.translate,
      cap: cap(),
    });
    const [out] = await words.localise("sw", [ANSWER], who);
    expect(fake.seen).toEqual([
      "Here is one investor who could fit: {v1}.",
      "{v1} raised {v2} {v3}.",
    ]);
    for (const sent of fake.seen) {
      expect(sent).not.toMatch(/AlRayan|Rimal|USD|1\.5/u);
    }
    expect(out).toBe(
      "[sw] Here is one investor who could fit: AlRayan Investment LLC. [sw] Rimal Freight raised USD 1.5m.",
    );
    expect([...rows.keys()][0]).toContain(`|${ANSWER_WORDS_VERSION}|`);
  });

  it("pays for a sentence once per language, for everyone", async () => {
    const { store } = memoryStore();
    const fake = translator();
    const words = createAnswerWords({
      store,
      translate: fake.translate,
      cap: cap(),
    });
    await words.localise(
      "fr",
      ["Zino Aviation is waiting for your reply."],
      who,
    );
    await words.localise(
      "fr",
      ["Halyard Security is waiting for your reply."],
      who,
    );
    expect(fake.seen).toEqual(["{v1} is waiting for your reply."]);
  });

  it("works the same for Arabic: no per-language path", async () => {
    const { store } = memoryStore();
    const fake = translator();
    const words = createAnswerWords({
      store,
      translate: fake.translate,
      cap: cap(),
    });
    const [out] = await words.localise("ar", [ANSWER], who);
    expect(out).toMatch(/^\[ar\] Here is one investor/u);
  });

  it("keeps English for English, an unknown language, a failure or a spent cap", async () => {
    const { store } = memoryStore();
    const english = createAnswerWords({
      store,
      translate: translator().translate,
      cap: cap(),
    });
    expect(await english.localise("en-GB", [ANSWER], who)).toEqual([null]);
    expect(await english.localise("not a language", [ANSWER], who)).toEqual([
      null,
    ]);
    const down = createAnswerWords({
      store,
      translate: translator(false).translate,
      cap: cap(),
    });
    expect(await down.localise("de", [ANSWER], who)).toEqual([null]);
    const spent = translator();
    const capped = createAnswerWords({
      store,
      translate: spent.translate,
      cap: cap(0),
    });
    expect(await capped.localise("it", [ANSWER], who)).toEqual([null]);
    expect(spent.seen).toEqual([]);
  });
});
