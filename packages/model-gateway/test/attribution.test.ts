import { describe, expect, it } from "vitest";

import { naturalRegisterIssues } from "@capital-q/q-core";

import {
  attributedFact,
  attributedListLead,
  stableChoice,
  type AttributedField,
} from "../src/q/attribution.js";
import { companiesMapLine } from "../src/q/companies-map.js";
import { comparisonLead } from "../src/q/early-lead.js";
import {
  companyFactLine,
  type DeclaredProfile,
} from "../src/q/named-company-fact.js";

/**
 * HQ-2 (owner, 20 Nov 2026): provenance carried by the sentence, driven by
 * the evidence axes. Live: "Ledgerfold is at the seed stage. That is what
 * the company declares on Capital Q; it isn't verified."
 */
const FIELDS: readonly AttributedField[] = [
  "STAGE",
  "HEADQUARTERS",
  "FOUNDED",
  "WHAT",
];
const PLAIN_FORMS: Readonly<
  Record<AttributedField, (n: string, v: string) => string>
> = {
  STAGE: (n, v) => `${n} is at the ${v} stage.`,
  HEADQUARTERS: (n, v) => `${n} is based in ${v}.`,
  FOUNDED: (n, v) => `${n} was founded in ${v}.`,
  WHAT: (_, v) => v,
};
const VALUE: Readonly<Record<AttributedField, string>> = {
  STAGE: "seed",
  HEADQUARTERS: "Lagos, Nigeria",
  FOUNDED: "2021",
  WHAT: "Invoicing for small suppliers.",
};
const ATTRIBUTED =
  /\b(?:describes itself|describes what it does|own profile|own words|lists|says it|gives)\b/u;

const ledgerfold: DeclaredProfile = {
  companyId: "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0",
  canonicalName: "Ledgerfold",
  currentStageCode: "seed",
  headquartersCity: "Lagos",
  headquartersCountry: "NG",
  foundedDate: "2021-03-01",
  shortDescription: "Invoicing for small suppliers.",
};

describe("attributed facts (HQ-2)", () => {
  it("a SELF_REPORTED value is always attributed, never said as plain fact, for every seed", () => {
    for (const field of FIELDS) {
      for (let n = 0; n < 40; n += 1) {
        const said = attributedFact({
          name: "Ledgerfold",
          field,
          value: VALUE[field],
          evidence: "SELF_REPORTED",
          seed: `company-${String(n)}`,
        });
        expect(said, said).toMatch(ATTRIBUTED);
        expect(said).not.toBe(PLAIN_FORMS[field]("Ledgerfold", VALUE[field]));
        expect(said).toContain(VALUE[field]);
        expect(naturalRegisterIssues(said)).toEqual([]);
      }
    }
  });

  it("a VERIFIED value is said plainly", () => {
    for (const evidence of [
      "PLATFORM_VERIFIED",
      "EXTERNALLY_VERIFIED",
    ] as const) {
      for (const field of FIELDS) {
        expect(
          attributedFact({
            name: "Ledgerfold",
            field,
            value: VALUE[field],
            evidence,
            seed: "s",
          }),
        ).toBe(PLAIN_FORMS[field]("Ledgerfold", VALUE[field]));
      }
    }
  });

  it("a document-backed value names its documents", () => {
    expect(
      attributedFact({
        name: "Ledgerfold",
        field: "STAGE",
        value: "seed",
        evidence: "DOCUMENT_SUPPORTED",
        seed: "s",
      }),
    ).toBe("Ledgerfold's documents show it at the seed stage.");
  });

  it("unknown is said as unknown, never guessed", () => {
    expect(
      attributedFact({
        name: "Ledgerfold",
        field: "STAGE",
        value: null,
        evidence: "SELF_REPORTED",
        seed: "s",
      }),
    ).toBe("Ledgerfold hasn't said what stage it's at yet.");
    expect(
      attributedFact({
        name: "Ledgerfold",
        field: "HEADQUARTERS",
        value: "Lagos",
        evidence: "NO_EVIDENCE",
        seed: "s",
      }),
    ).toBe("Ledgerfold hasn't said where it's based yet.");
  });

  it("varies by a stable hash: the same company and field always read the same", () => {
    const one = (seed: string) =>
      attributedFact({
        name: "Ledgerfold",
        field: "STAGE",
        value: "seed",
        evidence: "SELF_REPORTED",
        seed,
      });
    expect(one("a")).toBe(one("a"));
    expect(stableChoice("x|STAGE", 3)).toBe(stableChoice("x|STAGE", 3));
    const seen = new Set(
      Array.from({ length: 30 }, (_, n) => one(`seed-${String(n)}`)),
    );
    expect(seen.size).toBeGreaterThan(1);
  });

  it("list leads attribute the list, never a trailing disclaimer", () => {
    expect(attributedListLead("HEADQUARTERS", "SELF_REPORTED")).toBe(
      "Here's where each says it's based:",
    );
    expect(attributedListLead("HEADQUARTERS", "PLATFORM_VERIFIED")).toBe(
      "Here's where they're based:",
    );
  });
});

describe("the fact lines that used to bolt a disclaimer on (HQ-2)", () => {
  it("the live question: 'What stage is Ledgerfold at?'", () => {
    const said = companyFactLine("STAGE", ledgerfold);
    expect(said).toMatch(ATTRIBUTED);
    expect(said).toContain("seed");
    expect(said).not.toMatch(/declares on Capital Q|isn't verified/u);
    expect(naturalRegisterIssues(said)).toEqual([]);
    expect(
      companyFactLine("STAGE", { ...ledgerfold, currentStageCode: null }),
    ).toBe("Ledgerfold hasn't said what stage it's at yet.");
  });

  it("every aspect is attributed", () => {
    for (const aspect of FIELDS) {
      const said = companyFactLine(aspect, ledgerfold);
      expect(said, aspect).toMatch(ATTRIBUTED);
      expect(naturalRegisterIssues(said)).toEqual([]);
    }
  });

  it("the map's list: attributed in the lead, the unknown said plainly", () => {
    const said = companiesMapLine([
      ledgerfold,
      {
        ...ledgerfold,
        companyId: "d0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0",
        canonicalName: "Tensorgate",
        headquartersCity: null,
        headquartersCountry: null,
      },
    ]);
    expect(said).toBe(
      "Here's where each says it's based: Ledgerfold (Lagos, Nigeria). Tensorgate hasn't said where it's based yet, so it isn't on the map.",
    );
    expect(naturalRegisterIssues(said)).toEqual([]);
    const one = companiesMapLine([ledgerfold]);
    expect(one).toMatch(ATTRIBUTED);
    expect(one.endsWith("It's on the map.")).toBe(true);
  });

  it("the comparison's lead attributes both profiles up front", () => {
    const said = comparisonLead([
      ledgerfold,
      { ...ledgerfold, canonicalName: "Tensorgate", currentStageCode: null },
    ]);
    expect(said?.startsWith("Here's how each describes itself.")).toBe(true);
    expect(said).toContain("Tensorgate: no stage given yet");
    expect(naturalRegisterIssues(said ?? "")).toEqual([]);
  });
});
