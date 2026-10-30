import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ISO_COUNTRIES } from "../src/countries/index.js";

/**
 * One canonical country list (owner 2026-10-30: "hand-made country lists
 * are patching"). Every country Capital Q offers, names or reads comes from
 * @capital-q/taxonomy/countries, which is the geography taxonomy's ISO
 * 3166-1 nodes. This test fails when source code (not tests) carries its
 * own list of countries:
 *
 * - four or more ISO 3166-1 alpha-2 codes written one after another
 *   (`["NG", "KE", "GH", "ZA"]`, `"NG KE GH ZA"`), or
 * - four or more distinct country names written as string literals or
 *   object keys in one file (`{ label: "Nigeria" }`, `Kenya: "..."`).
 *
 * A list that is genuinely another concept is allowed below, with the
 * reason; anything else points at the canonical list instead.
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Where product code lives. */
const SCAN = ["apps", "packages"];

/** Never product code, or the source itself. */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".next",
  ".turbo",
  "test",
  "tests",
  "e2e",
  "__tests__",
  "evals",
]);

/**
 * Lists that are another concept than "which countries exist", each with
 * why. Paths are repository-relative with forward slashes.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  // The canonical source.
  "packages/taxonomy/src/reference-data/geography.ts":
    "the canonical source: the geography vocabulary's ISO 3166-1 nodes",
  // Published definitions are immutable: v1-v7 keep the option list their
  // sessions answered; v8 replaced it with the geography taxonomy.
  "packages/founder-onboarding/src/definition/founder-v1.ts":
    "frozen published founder definition v1 (option list of its sessions)",
  "packages/founder-onboarding/src/definition/founder-v5.ts":
    "frozen published founder definition v5 (option list of its sessions)",
  "packages/founder-onboarding/src/definition/utterance-aliases.ts":
    "spoken forms of v1-v7's option keys (frozen versions), not a country list",
  // Not a list of countries: data about some countries.
  "packages/q-research/src/domain/geography.ts":
    "forms a public page uses for a detected market (demonyms, cities); names come from the canonical list",
  "packages/gateq-intake/src/application/normalise-fact.ts":
    "everyday synonyms and alpha-3 codes the canonical list does not carry; each maps to a canonical country (tested)",
  "packages/gateq-intake/src/application/cities.ts":
    "city -> country reference data (a city is free text elsewhere)",
  "apps/web/src/features/gateq/form/form-model.ts":
    "GateQ's quick-pick shortcut; names and the full list come from the canonical list",
  "apps/web/src/features/q/blocks/world-data.ts":
    "generated map outlines keyed by ISO code (geometry, not a list to choose from)",
  "apps/q-api/src/voice/persona-voices/catalog.ts":
    "voice accents by place (a provider's voices), not a country list",
  "apps/q-api/src/voice/vocabulary.ts":
    "speech-recognition keyword boosts (a provider's vocabulary hints)",
  "apps/q-api/src/voice/onboarding-port.ts":
    "reference names that take 'the' in a sentence (grammar), not a country list",
  "packages/q-daily/src/sources.ts":
    "the markets each news source covers (a provider's markets)",
  "packages/q-core/src/etiquette/default-guide.ts":
    "cultural etiquette prose per market",
  "packages/q-core/src/ui-text/source.generated.ts":
    "generated machine-translation source (every UI string)",
  "apps/web/src/features/landing/gateq-demo.ts":
    "the public landing demo's scripted gateway rule (allowed headquarters)",
  "apps/web/src/features/landing/gateq-view.tsx":
    "the public landing demo's scripted sample answers; names from the canonical list",
  "packages/q-tools/src/tools/local-time.ts":
    "places to IANA time zones (time zones, not a country list)",
  "packages/q-core/src/names/org.ts":
    "place words that appear inside organisation names (name matching)",
  "packages/q-core/src/names/resolve.ts":
    "Arabic and short forms of places for name resolution (name matching)",
  "packages/contracts/src/http/gateq-find.ts":
    "KNOWN DEBT: search words read by pattern; packages/contracts cannot depend on taxonomy (taxonomy depends on it) -- follow-up with company-search",
  "packages/companies/src/domain/company-search.ts":
    "KNOWN DEBT: search words read by pattern; packages/companies cannot depend on taxonomy (taxonomy depends on it), so the place reading must move to the caller -- follow-up",
};

/** Folders of sample data for development screens and demos. */
const SAMPLE_DATA =
  /(?:^|\/)(?:dev|fixtures?|fictional-world|seed)(?:\/|$)|fixtures?\.tsx?$|-fixtures?\.tsx?$/u;

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(name)) sources(path, out);
      continue;
    }
    if (!/\.(?:ts|tsx|mts)$/u.test(name)) continue;
    if (/\.(?:test|spec|live|integration)\.tsx?$|\.d\.ts$/u.test(name))
      continue;
    out.push(path);
  }
  return out;
}

const ISO = new Set(ISO_COUNTRIES.map((c) => c.iso));
const NAMES = new Set(ISO_COUNTRIES.map((c) => c.name));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
/** A country's name as a whole string literal, or as an object key. */
const NAME_LITERAL = new RegExp(
  `["'\`](${[...NAMES].map(escape).join("|")})["'\`]|^\\s*(${[...NAMES]
    .filter((n) => /^[A-Za-z]+$/u.test(n))
    .map(escape)
    .join("|")}):`,
  "gimu",
);
/** Four or more quoted two-letter codes one after another. */
const CODE_RUN = /(?:["'][A-Z]{2}["']\s*,\s*){3,}["'][A-Z]{2}["']/gu;
/** Four or more codes in one string, space separated. */
const CODE_STRING = /["'](?:[A-Z]{2} ){3,}[A-Z]{2}["']/gu;

export function countryListsIn(text: string): string[] {
  const found: string[] = [];
  for (const match of [
    ...text.matchAll(CODE_RUN),
    ...text.matchAll(CODE_STRING),
  ]) {
    const codes = match[0].match(/[A-Z]{2}/gu) ?? [];
    if (codes.length >= 4 && codes.every((code) => ISO.has(code))) {
      found.push(`codes ${codes.slice(0, 6).join(",")}`);
    }
  }
  const names = new Set<string>();
  for (const match of text.matchAll(NAME_LITERAL)) {
    names.add((match[1] ?? match[2] ?? "").toLowerCase());
  }
  if (names.size >= 4) {
    found.push(`names ${[...names].slice(0, 6).join(",")}`);
  }
  return found;
}

describe("one canonical country source", () => {
  it("finds a hand-made list, and not ordinary code", () => {
    expect(countryListsIn('const A = ["NG", "KE", "GH", "ZA"];')).toHaveLength(
      1,
    );
    expect(
      countryListsIn('const Q = "NG GH KE ZA EG".split(" ");'),
    ).toHaveLength(1);
    expect(
      countryListsIn(
        '[{ value: "ng", label: "Nigeria" }, { value: "ke", label: "Kenya" }, { value: "gh", label: "Ghana" }, { value: "dk", label: "Denmark" }]',
      ),
    ).toHaveLength(1);
    expect(countryListsIn("const LOCALES = ['ar', 'en', 'fr', 'de'];")).toEqual(
      [],
    );
    expect(
      countryListsIn('const CURRENCIES = ["USD", "EUR", "GBP", "NGN"];'),
    ).toEqual([]);
    expect(countryListsIn('const T = ["OK", "NO", "GO", "IT"];')).toEqual([]);
    expect(
      countryListsIn('say("based in Nigeria, Kenya, Ghana and Egypt")'),
    ).toEqual([]);
  });

  it("is the only country list in product code", () => {
    const offenders: string[] = [];
    for (const top of SCAN) {
      for (const file of sources(join(ROOT, top))) {
        const path = relative(ROOT, file).split(sep).join("/");
        if (ALLOWED[path] !== undefined || SAMPLE_DATA.test(path)) continue;
        const lists = countryListsIn(readFileSync(file, "utf8"));
        if (lists.length > 0) offenders.push(`${path}: ${lists.join("; ")}`);
      }
    }
    expect(
      offenders,
      "use @capital-q/taxonomy/countries (or allow a genuinely different concept here, with why)",
    ).toEqual([]);
  });

  it("allows only files that exist", () => {
    for (const path of Object.keys(ALLOWED)) {
      expect(() => statSync(join(ROOT, path)), path).not.toThrow();
    }
  });
});
