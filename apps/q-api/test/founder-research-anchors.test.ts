import { describe, expect, it } from "vitest";

import {
  anchoredToCompany,
  validateFounderReading,
} from "../src/voice/founder-research.js";
import type { ResearchPage } from "../src/voice/investor-research.js";

/**
 * Lane ob1 (live 2026-10-16): the registered name "Kestrel Freightworks"
 * pulled in an unrelated UK shipping agent. A name alone never ties a
 * public page to the company: its website, a link they gave, their
 * founder's name or their country must be on it, or nothing is proposed.
 */

const namesake: ResearchPage = {
  url: "https://kestrelfreightworks.co.uk/about",
  title: "Kestrel Freightworks Ltd",
  excerpt:
    "Kestrel Freightworks Ltd is a Felixstowe shipping agent serving UK importers since 1998.",
  provider: "public_web",
  retrievedAt: "2026-10-16T09:00:00.000Z",
};
const theirs: ResearchPage = {
  ...namesake,
  url: "https://kestrel.africa/about",
  excerpt:
    "Kestrel Freightworks, founded by Amaka Obi, books freight for shippers across Nigeria.",
};

const reading = (sourceIndex: number, quote: string) => ({
  wrongSubject: false,
  description: { value: "Freight booking.", sourceIndex, quote },
  country: null,
  stage: null,
  sectors: null,
  teamSize: null,
});

describe("founder research needs a disambiguating anchor (ob1)", () => {
  it("proposes nothing from a same-named page with no anchor, the website included", () => {
    const found = validateFounderReading(
      reading(0, "Felixstowe shipping agent"),
      [namesake],
      null,
      "Kestrel Freightworks",
      { personName: "Amaka Obi", country: "Nigeria" },
    );
    expect(found).toEqual([]);
  });

  it("a page naming their founder or country is theirs", () => {
    expect(anchoredToCompany(theirs, null, { personName: "Amaka Obi" })).toBe(
      true,
    );
    expect(anchoredToCompany(theirs, null, { country: "Nigeria" })).toBe(true);
    expect(
      anchoredToCompany(namesake, null, {
        personName: "Amaka Obi",
        country: "Nigeria",
      }),
    ).toBe(false);
  });

  it("their own website, or a link they gave, anchors the page", () => {
    expect(anchoredToCompany(namesake, "kestrelfreightworks.co.uk", {})).toBe(
      true,
    );
    expect(
      anchoredToCompany({ ...namesake, provider: "public_profile" }, null, {}),
    ).toBe(true);
    const found = validateFounderReading(
      reading(0, "books freight for shippers across Nigeria"),
      [theirs],
      "https://kestrel.africa",
      "Kestrel Freightworks",
      {},
    );
    expect(found.map((f) => f.stepKey)).toEqual(["F1.description"]);
  });
});
