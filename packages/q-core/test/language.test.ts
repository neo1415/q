import { describe, expect, it } from "vitest";

import {
  effectiveLocale,
  spokenLanguageNote,
  supportedLanguageOf,
  writtenLanguageNote,
} from "../src/index.js";

/**
 * Multilingual Q (2026-10-16): one rule decides the language, and the
 * notes Q is told keep the substance exact in any language.
 */
describe("the language Q uses", () => {
  it("is the saved choice first, then the device, then nothing", () => {
    expect(effectiveLocale("ar", "en-GB")).toBe("ar");
    expect(effectiveLocale("en", "ar-AE")).toBe("en");
    expect(effectiveLocale("AUTO", "ar-AE")).toBe("ar-AE");
    expect(effectiveLocale(null, "fr")).toBe("fr");
    expect(effectiveLocale(undefined, undefined)).toBeUndefined();
    // A malformed device tag is not passed on.
    expect(effectiveLocale("AUTO", "ar; drop")).toBeUndefined();
  });

  it("knows any language the runtime can name and script, region kept", () => {
    expect(supportedLanguageOf("ar-SA")).toBe("ar-SA");
    expect(supportedLanguageOf("EN-us")).toBe("en-US");
    expect(supportedLanguageOf("fr")).toBe("fr");
    expect(supportedLanguageOf("sw")).toBe("sw");
    expect(supportedLanguageOf("tlh")).toBeNull();
    expect(supportedLanguageOf("xx")).toBeNull();
    expect(supportedLanguageOf(undefined)).toBeNull();
  });
});

describe("the notes Q is told", () => {
  it("adds nothing for English or no choice, so those prompts are unchanged", () => {
    expect(writtenLanguageNote("en")).toBeNull();
    expect(writtenLanguageNote(null)).toBeNull();
    expect(spokenLanguageNote("en")).toBeNull();
    expect(spokenLanguageNote(undefined)).toBeNull();
  });

  it("names the language (no per-language branch), asks for its standard written form and follows a switch", () => {
    const note = writtenLanguageNote("ar") ?? "";
    expect(note).toContain("this person chose Arabic (العربية)");
    expect(note).toContain("standard written form professionals use at work");
    expect(note).toMatch(/ask you to switch, follow them/u);
    expect(note).toMatch(/mix it with English/u);
    expect(writtenLanguageNote("sw")).toContain("Swahili (Kiswahili)");
    expect(writtenLanguageNote("ja")).toContain("Japanese (日本語)");
    expect(spokenLanguageNote("fr")).toContain("Speak natural, clear French (français)");
    // English in any region needs no note; an unknown tag gets none.
    expect(writtenLanguageNote("en-GB")).toBeNull();
    expect(writtenLanguageNote("tlh")).toBeNull();
  });

  it("keeps names, figures, currencies and terms exact", () => {
    for (const note of [writtenLanguageNote("ar"), spokenLanguageNote("ar")]) {
      expect(note).toMatch(/never convert a currency/u);
      expect(note).toMatch(/ARR/u);
    }
    const written = writtenLanguageNote("ar") ?? "";
    expect(written).toMatch(/never translate or transliterate a proper name/u);
    expect(written).toMatch(/Western digits/u);
  });

  it("never touches structured output", () => {
    expect(writtenLanguageNote("ar")).toMatch(
      /JSON keys, codes, enum values and identifiers stay exactly/u,
    );
  });
});
