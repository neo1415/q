import { describe, expect, it } from "vitest";

import { FounderPersonDtoSchema } from "@capital-q/contracts";

import { projectFounderPerson, type FounderPersonSource } from "../src/index.js";

/**
 * Overnight A7: a founder as a person. Age only where they shared it; each
 * background line only where shared; "matches a shared document" only for a
 * document this reader may open, else it stays the founder's claim.
 */

const DOC = "00000000-0000-4000-8000-00000000aa01";
const source = (over: Partial<FounderPersonSource> = {}): FounderPersonSource => ({
  name: "Amara Okafor",
  businessTitle: "CEO",
  isFounder: true,
  professionalSummary: "My mother ran a clinic in Enugu.",
  identityVerified: false,
  facts: {
    birthYear: 1992,
    ageShared: false,
    buildingSince: 2015,
    companiesFounded: 2,
    exits: "1, in 2019",
    lookingFor: "Investors who know health insurance.",
    location: "Lagos, Nigeria",
  },
  background: [
    { fromYear: 2021, toYear: null, title: "Co-founder and CEO, Kora Health", detail: "Lagos", supportingDocumentId: null, shared: true },
    { fromYear: 2017, toYear: 2019, title: "Co-founder, ShopRun (sold 2019)", detail: null, supportingDocumentId: DOC, shared: true },
    { fromYear: 2010, toYear: 2014, title: "Private line", detail: null, supportingDocumentId: null, shared: false },
  ],
  ...over,
});
const context = (open: readonly string[] = []) => ({
  companyId: "00000000-0000-4000-8000-00000000cc01",
  companyName: "Kora Health",
  position: 1,
  openDocumentIds: new Set(open),
  today: new Date("2026-10-06T00:00:00Z"),
});

describe("founder person projection", () => {
  it("never shows age unless the founder shared it", () => {
    expect(projectFounderPerson(source(), context()).age).toBeNull();
    const shared = source({ facts: { ...source().facts!, ageShared: true } });
    expect(projectFounderPerson(shared, context()).age).toBe(34);
  });

  it("shows only shared lines, each labelled with what it rests on", () => {
    const claim = projectFounderPerson(source(), context());
    expect(FounderPersonDtoSchema.safeParse(claim).success).toBe(true);
    expect(claim.background.map((line) => [line.title, line.evidence])).toEqual([
      ["Co-founder and CEO, Kora Health", "FOUNDERS_CLAIM"],
      ["Co-founder, ShopRun (sold 2019)", "FOUNDERS_CLAIM"],
    ]);
    expect(JSON.stringify(claim)).not.toContain("Private line");
    const matched = projectFounderPerson(source(), context([DOC]));
    expect(matched.background[1]?.evidence).toBe("MATCHES_SHARED_DOCUMENT");
    expect(matched.background[0]?.current).toBe(true);
  });

  it("keeps unknown unknown when the founder kept no facts", () => {
    const none = projectFounderPerson(source({ facts: null }), context());
    expect(none).toMatchObject({ age: null, buildingSince: null, companiesFounded: null, location: null });
    expect(none.roleLine).toBe("Co-founder and CEO, Kora Health");
  });
});
