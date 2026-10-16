import { describe, expect, it } from "vitest";

import { replyLanguageOf, turnIsEnglish } from "../src/voice/reply-language.js";

/**
 * ob1 live acceptance on AF: a French turn and an Arabic turn were saved
 * and Q replied in English. The reply's language: their chosen one, or with
 * Automatic the turn's, in any language.
 */
describe("the language of a turn", () => {
  it("English, or no language of its own (a figure, names), is English", () => {
    for (const said of [
      "We are a seed-stage fintech based in Lagos.",
      "about 14 people",
      "14",
      "Rimal Freight, Dubai, Seed.",
      "Seed",
    ]) {
      expect(turnIsEnglish(said)).toBe(true);
    }
  });

  it("any other language, in any script, is not", () => {
    for (const said of [
      "Nous sommes une fintech en phase d'amorçage basée à Lagos.",
      "Somos una fintech en etapa semilla con sede en Lagos.",
      "Sisi ni kampuni ya teknolojia ya fedha iliyoko Nairobi.",
      "نحن في مرحلة البذرة ومقرنا في دبي",
      "我们是一家位于上海的种子轮金融科技公司",
      "Мы финтех-стартап на посевной стадии",
    ]) {
      expect(turnIsEnglish(said)).toBe(false);
    }
  });
});

describe("the reply's language", () => {
  it("their chosen language wins, whatever the turn", () => {
    expect(replyLanguageOf("fr", "We are based in Lagos.")).toEqual({
      kind: "CHOSEN",
      tag: "fr",
    });
    expect(replyLanguageOf("en-GB", "نحن في دبي")).toEqual({ kind: "ENGLISH" });
  });

  it("Automatic follows the turn", () => {
    expect(replyLanguageOf(null, "We are based in Lagos.")).toEqual({
      kind: "ENGLISH",
    });
    expect(
      replyLanguageOf(null, "Nous sommes basés à Lagos, au Nigeria."),
    ).toEqual({ kind: "THEIRS" });
    expect(replyLanguageOf(null, "نحن في مرحلة البذرة")).toEqual({
      kind: "THEIRS",
    });
  });
});
