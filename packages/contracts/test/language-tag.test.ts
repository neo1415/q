import { describe, expect, it } from "vitest";

import {
  canonicalLanguageTag,
  languageDirectionOf,
  QLanguagePreferenceSchema,
} from "../src/index.js";
import {
  canonicalLanguageTag as canonicalTagNoZod,
  isQLanguagePreference,
  languageDirectionOf as directionNoZod,
} from "../src/q/language-tag.js";

/**
 * W4-B: the language event's check without zod, so the browser's root
 * layout ships no schema library. It must accept and refuse exactly what
 * QLanguagePreferenceSchema does.
 */
const INPUTS: readonly unknown[] = [
  "AUTO",
  "auto",
  "Auto",
  "en",
  "ar",
  "fr",
  "pt-BR",
  "pt-br",
  "PT-BR",
  "zh-Hant-TW",
  "zh-hant-tw",
  "ar-AE",
  "sw",
  "fil",
  "e",
  "",
  " ",
  " en",
  "en ",
  "english",
  "en_GB",
  "en-GB-oxendict",
  "x-private",
  "i-klingon",
  "a".repeat(36),
  `en-${"a".repeat(8)}-${"b".repeat(8)}-${"c".repeat(8)}`,
  `en-${"a".repeat(8)}-${"b".repeat(8)}-${"c".repeat(8)}-dd`,
  "und",
  "qaa",
  "en--GB",
  "123",
  null,
  undefined,
  42,
  true,
  {},
  ["en"],
  { language: "en" },
];

describe("isQLanguagePreference", () => {
  it.each(
    INPUTS.map((input) => [JSON.stringify(input) ?? String(input), input]),
  )("agrees with QLanguagePreferenceSchema on %s", (_label, input) => {
    expect(isQLanguagePreference(input)).toBe(
      QLanguagePreferenceSchema.safeParse(input).success,
    );
  });

  it("is the very helpers conduct.ts exports (moved, not copied)", () => {
    expect(canonicalTagNoZod).toBe(canonicalLanguageTag);
    expect(directionNoZod).toBe(languageDirectionOf);
    expect(directionNoZod("ar")).toBe("rtl");
    expect(directionNoZod("en")).toBe("ltr");
  });
});
