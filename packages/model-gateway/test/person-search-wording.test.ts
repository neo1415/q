import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type {
  ExternalPersonConfidence,
  PersonSearchResult,
} from "@capital-q/contracts/q";

import {
  identityCardBlock,
  personSearchText,
  type PersonAsk,
} from "../src/q/person-search-answer.js";

/**
 * The spoken line for an identity card. Prepared entities say what they are
 * in one natural sentence from the seed's own description; searched people
 * keep an identity-confidence lead in plain words and never a clipped or
 * glued role. Fixtures: the real Qatar Five seed and a searched card.
 */

type SeedEntity = {
  readonly name: string;
  readonly entity_kind: "PERSON" | "ORGANIZATION" | "GOVERNMENT_AGENCY";
  readonly one_line: string;
  readonly role: string | null;
  readonly location: string | null;
};

const seed = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../../scripts/seed/research/qatar-five.v1.json"),
    "utf8",
  ),
) as { entities: SeedEntity[] };

const ASK = (name: string): PersonAsk => ({
  name,
  entityKind: "PERSON",
  city: null,
  country: null,
  organization: null,
  role: null,
  freshSearch: false,
});

function preparedResult(entity: SeedEntity): PersonSearchResult {
  return {
    outcome: "MATCHED",
    candidates: [],
    clarifyingQuestion: null,
    elapsedMs: 1,
    card: {
      entityKind: entity.entity_kind,
      subject: {
        externalPersonId: "5b0f6d8e-4f6e-5a3b-8c1d-2e3f4a5b6c7d",
        entityKind: entity.entity_kind,
        researchStatus: "PREPARED_PUBLIC_SEED",
        requiresRefresh: false,
        image: {
          status: "NOT_ATTACHED",
          assetUrl: null,
          attribution: null,
          licenseNote: null,
        },
        quotes: [],
        displayName: entity.name,
        nameVariants: [],
        profileUrl: null,
        role: entity.role,
        organization: null,
        location: entity.location,
        evidenceBundleId: null,
        briefVersion: 0,
        confidence: "PLAUSIBLE",
      },
      sources: [
        {
          id: "S01",
          description: null,
          evidenceClass: null,
          url: "https://example.org/a",
          domain: "example.org",
          title: "A",
          publishedAt: null,
          retrievedAt: "2026-10-09T00:00:00Z",
          provider: "prepared",
        },
      ],
      uncertainty: [
        "Prepared from public sources on 2026-10-09; ask for a fresh search to check it is current.",
      ],
      attributionLine: "According to public sources prepared on 2026-10-09.",
      summary: entity.one_line,
      enriching: false,
      actions: ["RESEARCH_FURTHER", "REHEARSE"],
    },
  };
}

function searchedResult(
  confidence: ExternalPersonConfidence,
  facts: { role: string | null; organization: string | null },
): PersonSearchResult {
  const prepared = preparedResult(seed.entities[0] as SeedEntity);
  if (prepared.card === null) throw new Error("fixture");
  return {
    ...prepared,
    card: {
      ...prepared.card,
      entityKind: "PERSON",
      subject: {
        ...prepared.card.subject,
        entityKind: "PERSON",
        displayName: "Tidjane Thiam",
        researchStatus: "RESEARCHED",
        confidence,
        role: facts.role,
        organization: facts.organization,
        location: "New York",
      },
      summary: null,
      attributionLine:
        "According to their public LinkedIn profile (search-indexed, not independently confirmed).",
      uncertainty: ["The sources place this person somewhere else too."],
    },
  };
}

const sentences = (text: string): string[] =>
  text.split(/(?<=[.?!])\s+/u).filter((s) => s.length > 0);

describe("the spoken line for a prepared entity", () => {
  it("is one natural sentence plus an offer, for all five entities", () => {
    expect(seed.entities).toHaveLength(5);
    for (const entity of seed.entities) {
      const text = personSearchText(preparedResult(entity), ASK(entity.name));
      expect(text.startsWith(entity.name)).toBe(true);
      expect(text).not.toMatch(/plausible match|confirmed one|prepared on/iu);
      expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/u);
      expect(text).not.toContain("…");
      expect(text).not.toContain("...");
      expect(text).not.toContain("on screen");
      const parts = sentences(text);
      expect(parts.length).toBeLessThanOrEqual(2);
      expect(parts.at(-1)).toMatch(/^Want me to research further/u);
    }
  });

  it("reads naturally", () => {
    const by = (name: string) =>
      personSearchText(
        preparedResult(
          seed.entities.find((e) => e.name === name) as SeedEntity,
        ),
        ASK(name),
      );
    expect(by("QInvest LLC")).toBe(
      "QInvest LLC is a Qatar-based Islamic investment group spanning investment banking, principal investments and asset management. Want me to research further or set up a rehearsal?",
    );
    expect(by("Invest Qatar")).toMatch(/^Invest Qatar is Qatar's investment/u);
    expect(by("Muhannad Taslaq")).toMatch(
      /^Muhannad Taslaq is a director of Investments at Alchemist Doha/u,
    );
  });

  it("the card itself carries no plausible-match hedge for a prepared entity", () => {
    const result = preparedResult(seed.entities[0] as SeedEntity);
    if (result.card === null) throw new Error("fixture");
    const block = identityCardBlock(result.card);
    expect(JSON.stringify(block)).not.toMatch(/plausible/iu);
  });
});

describe("the spoken line for a searched person", () => {
  it("states one role at one organisation, with no clipped text and no boilerplate", () => {
    const text = personSearchText(
      searchedResult("PLAUSIBLE", {
        role: "Executive Chairman",
        organization: "Publicis Groupe",
      }),
      ASK("Tidjane Thiam"),
    );
    expect(text).toBe(
      "This could be who you mean: Tidjane Thiam is reportedly Executive Chairman at Publicis Groupe, based in New York. Want me to research further or set up a rehearsal?",
    );
    expect(text).not.toMatch(/plausible match|search-indexed|sources place/iu);
  });

  it("drops a role cut off with an ellipsis instead of gluing it to another employer", () => {
    const text = personSearchText(
      searchedResult("STRONG", {
        role: "Executive Chairman of Freedom ...",
        organization: "Publicis Groupe",
      }),
      ASK("Tidjane Thiam"),
    );
    expect(text).not.toContain("...");
    expect(text).not.toContain("Freedom");
    expect(text).toContain("This looks like the right person: ");
    expect(text).toContain("with Publicis Groupe");
  });
});
