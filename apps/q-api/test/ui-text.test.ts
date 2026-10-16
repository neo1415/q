import { describe, expect, it } from "vitest";

import { createDailySpendCap } from "@capital-q/model-gateway";
import { languageInfo } from "@capital-q/q-core/language";
import {
  checkUiTranslation,
  UI_TEXT_CATALOG_VERSION,
  UI_TEXT_HAND_GAPS,
  UI_TEXT_SOURCE,
} from "@capital-q/q-core/ui-text";

import {
  createUiTextService,
  parseUiTranslationDailyCapUsd,
  type UiTextRow,
  type UiTextStore,
  type UiTextTranslator,
} from "../src/composition/ui-text.js";

/**
 * Any-language interface (owner 2026-10-16): the English catalogue is
 * machine-translated once per language, cached, shared, checked and
 * capped. No live calls: the translator here is a stand-in.
 */
function memoryStore() {
  const rows = new Map<string, UiTextRow>();
  let reads = 0;
  const store: UiTextStore = {
    read: (language, version) => {
      reads += 1;
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
  return { store, rows, reads: () => reads };
}

/** "Settings" -> "[fr] Settings", keeping every placeholder; one item broken on purpose. */
function fakeTranslator(options: { costUsd?: number; breakOne?: string } = {}) {
  const calls: { language: string; size: number; tenantId: string }[] = [];
  const translate: UiTextTranslator = (language, batch, attribution) => {
    calls.push({ language: language.tag, size: batch.length, tenantId: attribution.tenantId });
    return Promise.resolve({
      ok: true,
      modelCode: "fake-model",
      costUsd: options.costUsd ?? 0.001,
      result: {
        items: batch.map((text, i) => ({
          i,
          t:
            text === options.breakOne
              ? text.replace(/\{[A-Za-z0-9]+\}/u, "")
              : `[${language.tag}] ${text}`,
        })),
      },
    });
  };
  return { translate, calls };
}

const capOf = (capUsd: number) =>
  createDailySpendCap({ capUsd, readSpentSinceUsd: () => Promise.resolve(0) });

const actor = {
  tenantId: "00000000-0000-4000-8000-0000000000a1",
  userId: "00000000-0000-4000-8000-0000000000b1",
};

const SOURCE = ["Settings", "Discover", "Waiting on {name}.", "USD {n} raised", "Ask Q"];

describe("checking a machine translation", () => {
  it("keeps every placeholder and refuses one that breaks or invents one", () => {
    expect(checkUiTranslation("Waiting on {name}.", "En attente de {name}.")).toEqual({ ok: true });
    expect(checkUiTranslation("Waiting on {name}.", "En attente de {nom}.")).toEqual({
      ok: false,
      reason: "PLACEHOLDERS",
    });
    expect(checkUiTranslation("Waiting on {name}.", "En attente.")).toMatchObject({ reason: "PLACEHOLDERS" });
    expect(checkUiTranslation("{n} of {n2}", "{n} sur {n2} {n}")).toMatchObject({ reason: "PLACEHOLDERS" });
  });

  it("never loses figures, currency codes or product names", () => {
    expect(checkUiTranslation("Raise USD 2.5m", "Lever 3 M USD")).toMatchObject({ reason: "FIGURES" });
    expect(checkUiTranslation("Raise USD 2.5m", "Lever 2.5m dollars")).toMatchObject({ reason: "CURRENCY_CODES" });
    expect(checkUiTranslation("Raise USD 2.5m", "Lever 2.5m USD")).toEqual({ ok: true });
    expect(checkUiTranslation("Ask Q", "Demander à Kyu")).toMatchObject({ reason: "PRODUCT_NAMES" });
    expect(checkUiTranslation("Open GateQ", "Ouvrir la porte")).toMatchObject({ reason: "PRODUCT_NAMES" });
    expect(checkUiTranslation("Ask Q", "اسأل Q")).toEqual({ ok: true });
    expect(checkUiTranslation("Settings", "  ")).toMatchObject({ reason: "EMPTY" });
  });
});

describe("the ui-text service", () => {
  it("shows English first, translates in the background, then serves from the cache", async () => {
    const memory = memoryStore();
    const fake = fakeTranslator();
    const service = createUiTextService({
      store: memory.store,
      translate: fake.translate,
      cap: capOf(2),
      source: SOURCE,
      handGaps: {},
    });
    const first = await service.catalog("fr", actor);
    expect(first).toMatchObject({ language: "fr", complete: false, settled: 0, total: 5, entries: {} });
    await service.idle();
    const second = await service.catalog("fr", actor);
    expect(second).toMatchObject({ complete: true, settled: 5, version: UI_TEXT_CATALOG_VERSION });
    expect(second?.entries["Settings"]).toBe("[fr] Settings");
    expect(second?.entries["Waiting on {name}."]).toBe("[fr] Waiting on {name}.");
    // Once complete, nothing more is asked of the model.
    await service.catalog("fr", actor);
    await service.idle();
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.tenantId).toBe(actor.tenantId);
  });

  it("asks once however many people open the language at the same time", async () => {
    const memory = memoryStore();
    const fake = fakeTranslator();
    const service = createUiTextService({
      store: memory.store,
      translate: fake.translate,
      cap: capOf(2),
      source: SOURCE,
      handGaps: {},
    });
    await Promise.all([service.catalog("sw", actor), service.catalog("sw", actor), service.catalog("sw", actor)]);
    await service.idle();
    expect(fake.calls.filter((call) => call.language === "sw")).toHaveLength(1);
  });

  it("refuses a translation that breaks a placeholder, keeps English for it and never pays for it again", async () => {
    const memory = memoryStore();
    const fake = fakeTranslator({ breakOne: "Waiting on {name}." });
    const service = createUiTextService({
      store: memory.store,
      translate: fake.translate,
      cap: capOf(2),
      source: SOURCE,
      handGaps: {},
    });
    await service.catalog("ja", actor);
    await service.idle();
    const after = await service.catalog("ja", actor);
    expect(after?.complete).toBe(true);
    expect(after?.entries["Waiting on {name}."]).toBeUndefined();
    expect(memory.rows.get(`ja|${UI_TEXT_CATALOG_VERSION}|Waiting on {name}.`)).toMatchObject({
      status: "REJECTED",
      reason: "PLACEHOLDERS",
    });
    await service.idle();
    expect(fake.calls).toHaveLength(1);
  });

  it("stops at the day's budget and says so; English stays", async () => {
    const memory = memoryStore();
    const fake = fakeTranslator({ costUsd: 1.5 });
    const source = Array.from({ length: 200 }, (_, i) => `String ${i}`);
    const service = createUiTextService({
      store: memory.store,
      translate: fake.translate,
      cap: capOf(2),
      source,
      handGaps: {},
      concurrency: 1,
    });
    await service.catalog("de", actor);
    await service.idle();
    // 1.5 + 1.5 reaches the USD 2 cap: the third batch is never asked.
    expect(fake.calls).toHaveLength(2);
    const after = await service.catalog("de", actor);
    expect(after).toMatchObject({ complete: false, paused: "DAILY_BUDGET" });
    expect(after?.settled).toBe(120);
    await service.idle();
    expect(fake.calls).toHaveLength(2);
  });

  it("machine-fills only what a hand catalogue lacks; English needs nothing", async () => {
    const memory = memoryStore();
    const fake = fakeTranslator();
    const service = createUiTextService({
      store: memory.store,
      translate: fake.translate,
      cap: capOf(2),
      source: SOURCE,
      handGaps: { ar: ["Ask Q"] },
    });
    await service.catalog("ar-AE", actor);
    await service.catalog("en-GB", actor);
    await service.idle();
    expect(fake.calls).toEqual([{ language: "ar-AE", size: 1, tenantId: actor.tenantId }]);
    expect(await service.catalog("en", actor)).toMatchObject({ complete: true, total: 0 });
  });

  it("refuses a language it cannot offer, and translates nothing for it", async () => {
    const memory = memoryStore();
    const fake = fakeTranslator();
    const service = createUiTextService({
      store: memory.store,
      translate: fake.translate,
      cap: capOf(2),
      source: SOURCE,
      handGaps: {},
    });
    expect(await service.catalog("tlh", actor)).toBeNull();
    expect(await service.catalog("not a tag", actor)).toBeNull();
    expect(fake.calls).toEqual([]);
  });

  it("pauses honestly when no model can translate, and retries later", async () => {
    const memory = memoryStore();
    let t = 0;
    let calls = 0;
    const service = createUiTextService({
      store: memory.store,
      translate: () => {
        calls += 1;
        return Promise.resolve({ ok: false, reason: "UNAVAILABLE" });
      },
      cap: capOf(2),
      source: SOURCE,
      handGaps: {},
      now: () => t,
      retryAfterMs: 1_000,
    });
    await service.catalog("es", actor);
    await service.idle();
    expect(await service.catalog("es", actor)).toMatchObject({ paused: "UNAVAILABLE", complete: false });
    await service.idle();
    expect(calls).toBe(1);
    t = 5_000;
    await service.catalog("es", actor);
    await service.idle();
    expect(calls).toBe(2);
  });
});

describe("the shipped catalogue and cap", () => {
  it("translates only the source catalogue; Arabic's hand catalogue covers it", () => {
    expect(UI_TEXT_SOURCE.length).toBeGreaterThan(3_000);
    expect(new Set(UI_TEXT_SOURCE).size).toBe(UI_TEXT_SOURCE.length);
    expect(UI_TEXT_HAND_GAPS["ar"]).toEqual([]);
    expect(languageInfo("ar")?.direction).toBe("rtl");
  });

  it("defaults the daily cap to USD 2 and refuses a malformed one", () => {
    expect(parseUiTranslationDailyCapUsd({})).toBe(2);
    expect(parseUiTranslationDailyCapUsd({ CQ_UI_TRANSLATION_DAILY_CAP_USD: "0.5" })).toBe(0.5);
    expect(() => parseUiTranslationDailyCapUsd({ CQ_UI_TRANSLATION_DAILY_CAP_USD: "two" })).toThrow();
    expect(() => parseUiTranslationDailyCapUsd({ CQ_UI_TRANSLATION_DAILY_CAP_USD: "500" })).toThrow();
  });
});
