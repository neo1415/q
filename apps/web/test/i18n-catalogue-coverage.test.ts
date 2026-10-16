import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { UI_TEXT_SOURCE } from "@capital-q/q-core/ui-text";

import { translate, translatedStrings } from "../src/features/i18n/messages";

/**
 * Multilingual Q: every string the interface wraps in t("…") has Arabic.
 * A string wrapped without a translation would show English to an Arabic
 * reader while the code claims it is translated; this keeps the catalogue
 * and the screens honest as each area is converted.
 */
const ROOTS = ["src", "app"].map((root) =>
  join(import.meta.dirname, "..", root),
);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/u.test(name) ? [path] : [];
  });
}

/** Names that read the same in every language. */
const SAME_IN_EVERY_LANGUAGE = new Set([
  "Google",
  "The Q Daily",
  "GateQ",
  "Q Pitch",
  "Capital Q",
  "Q",
  "PDF",
  "PowerPoint",
  // A colour code's format and a type sample, not words.
  "#rrggbb",
  "Aa",
]);

const LITERAL = /\bt\(\s*("(?:[^"\\]|\\.)*")\s*\)/gu;

describe("the Arabic catalogue covers every wrapped string", () => {
  it('has Arabic for each t("…") literal in the web app', () => {
    const missing = new Set<string>();
    for (const file of ROOTS.flatMap(sources)) {
      for (const match of readFileSync(file, "utf8").matchAll(LITERAL)) {
        const english = JSON.parse(match[1] ?? '""') as string;
        if (
          translate("ar", english) === english &&
          !SAME_IN_EVERY_LANGUAGE.has(english)
        )
          missing.add(english);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });
});

/**
 * Any language: machine translation works from the generated source list
 * only (packages/q-core/src/ui-text/source.generated.ts), so every wrapped
 * string must be in it, and it must be current with the catalogues. When
 * this fails, run:
 *   node --experimental-strip-types scripts/i18n/generate-ui-text-source.mts
 */
describe("the machine-translation source is the whole catalogue, and current", () => {
  it("holds every hand-catalogued string (the email strings are checked in q-api)", () => {
    const source = new Set(UI_TEXT_SOURCE);
    const stale = translatedStrings("ar").filter(
      (english) => !source.has(english),
    );
    expect(stale).toEqual([]);
  });

  it('holds every t("…") literal, so any language can show it', () => {
    const source = new Set(UI_TEXT_SOURCE);
    const missing = new Set<string>();
    for (const file of ROOTS.flatMap(sources)) {
      for (const match of readFileSync(file, "utf8").matchAll(LITERAL)) {
        const english = JSON.parse(match[1] ?? '""') as string;
        if (!source.has(english) && !SAME_IN_EVERY_LANGUAGE.has(english)) {
          // A literal matched by a pattern key is covered by that key.
          if (translate("ar", english) === english) missing.add(english);
        }
      }
    }
    expect([...missing].sort()).toEqual([]);
  });
});
