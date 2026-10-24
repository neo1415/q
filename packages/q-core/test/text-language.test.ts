import { describe, expect, it } from "vitest";
import { scriptLanguageOf, textIsEnglish } from "../src/language/public.js";

describe("textIsEnglish", () => {
  it("knows English, and text with no language of its own", () => {
    expect(textIsEnglish("They're on screen.")).toBe(true);
    expect(textIsEnglish("Anchor, Afyascan")).toBe(true);
    expect(textIsEnglish("7.6")).toBe(true);
  });
  it("knows what is not English", () => {
    expect(textIsEnglish("هذه أفضل ثلاث شركات")).toBe(false);
    expect(
      textIsEnglish("quelles sont les meilleures entreprises pour moi"),
    ).toBe(false);
  });
});

describe("scriptLanguageOf", () => {
  it("names the language a script names", () => {
    expect(scriptLanguageOf("ما هي أفضل ثلاث شركات؟")).toBe("ar");
    expect(scriptLanguageOf("מה המנדט שלי")).toBe("he");
    expect(scriptLanguageOf("내 투자 기준은")).toBe("ko");
    expect(scriptLanguageOf("私の投資方針は何ですか")).toBe("ja");
    expect(scriptLanguageOf("我的投资标准是什么")).toBe("zh");
  });
  it("names none for Latin, Cyrillic or no letters", () => {
    expect(scriptLanguageOf("What is my mandate?")).toBeNull();
    expect(scriptLanguageOf("Какой у меня мандат")).toBeNull();
    expect(scriptLanguageOf("123")).toBeNull();
  });
});
