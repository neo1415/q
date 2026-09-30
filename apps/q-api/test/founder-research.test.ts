import { describe, expect, it } from "vitest";

import { validateFounderReading } from "../src/voice/founder-research.js";
import type { ResearchPage } from "../src/voice/investor-research.js";

/**
 * Founder research (founder direction 2026-09-30): what the company's own
 * pages say, checked by code before Q offers it for the founder to confirm.
 */

const PAGES: readonly ResearchPage[] = [
  {
    url: "https://greenbox.africa/about",
    title: "About Greenbox",
    excerpt:
      "Greenbox runs solar cold rooms for farmers in Lagos, Nigeria. We are a seed-stage team of 14 people.",
    provider: "public_web",
    retrievedAt: "2026-09-30T10:00:00.000Z",
  },
];

const EMPTY = {
  wrongSubject: false,
  description: null,
  country: null,
  stage: null,
  sectors: null,
  teamSize: null,
} as const;

describe("founder research findings", () => {
  it("offers what the company's own page states, cited and on the journey's choices", () => {
    const findings = validateFounderReading(
      {
        ...EMPTY,
        description: {
          value: "We run solar cold rooms for farmers in Lagos.",
          sourceIndex: 0,
          quote: "solar cold rooms for farmers in Lagos",
        },
        country: { value: "NG", sourceIndex: 0, quote: "Lagos, Nigeria" },
        stage: { value: "seed", sourceIndex: 0, quote: "seed-stage team" },
        teamSize: { value: "14", sourceIndex: 0, quote: "team of 14 people" },
      },
      PAGES,
      "greenbox.africa",
    );
    expect(findings.map((f) => [f.stepKey, f.value])).toEqual([
      ["F1.description", "We run solar cold rooms for farmers in Lagos."],
      ["F1.country", "ng"],
      ["F1.stage", "seed"],
      ["F4.team_size", 14],
    ]);
    expect(findings[0]?.because).toBe(
      "found on their website (greenbox.africa)",
    );
    expect(findings.every((f) => f.after === "F1.company_name")).toBe(true);
  });

  it("drops a quote that is not on its page, and a choice the journey does not have", () => {
    const findings = validateFounderReading(
      {
        ...EMPTY,
        description: {
          value: "We sell drones.",
          sourceIndex: 0,
          quote: "we sell drones to farmers",
        },
        stage: { value: "ipo", sourceIndex: 0, quote: "seed-stage team" },
        country: { value: "ng", sourceIndex: 3, quote: "Lagos, Nigeria" },
      },
      PAGES,
      null,
    );
    expect(findings).toEqual([]);
  });

  it("offers nothing about a namesake", () => {
    expect(
      validateFounderReading(
        {
          ...EMPTY,
          wrongSubject: true,
          country: { value: "ng", sourceIndex: 0, quote: "Lagos, Nigeria" },
        },
        PAGES,
        null,
      ),
    ).toEqual([]);
  });
});

describe("the company's own site, when they have not given one (live 2026-09-30)", () => {
  it("offers a page whose host is named for the company as its website", () => {
    const findings = validateFounderReading(EMPTY, PAGES, null, "Greenbox");
    expect(findings).toContainEqual(
      expect.objectContaining({
        stepKey: "F1.website",
        value: "https://greenbox.africa",
      }),
    );
  });

  it("offers nothing when the host is not the company's, or a site is known", () => {
    expect(
      validateFounderReading(EMPTY, PAGES, null, "Bluecrate").some(
        (f) => f.stepKey === "F1.website",
      ),
    ).toBe(false);
    expect(
      validateFounderReading(
        EMPTY,
        PAGES,
        "https://greenbox.africa",
        "Greenbox",
      ).some((f) => f.stepKey === "F1.website"),
    ).toBe(false);
  });
});
