import { describe, expect, it } from "vitest";

import { QStageAboutSchema } from "@capital-q/contracts";

import { stageAbout, stageKey } from "../src/q/stage-subjects.js";

/**
 * Round 4: a stage names what it is about only from the run's own reads,
 * by the ids its tool call names; never the web (R38).
 */

const NIXO = "7b62eab6-39b9-4cb6-884a-878301f6928f";
const HALYARD = "601a1923-fc40-4fe2-a775-d01af89f60ea";
const FUND = "9c73b384-876c-45a9-a564-d498d1a3fe22";

const read = {
  companyNames: new Map([
    [NIXO, "Nixo"],
    [HALYARD, "Halyard"],
  ]),
  profiles: new Map([[NIXO, "Nixo"]]),
  investors: new Map([[FUND, { name: "Kestrel Ventures" }]]),
};

describe("stageAbout", () => {
  it("names the company or investor the call is about, when this run has read it", () => {
    expect(
      stageAbout({
        stage: "CHECKING_EVIDENCE",
        args: { companyId: NIXO },
        read,
      }),
    ).toEqual({ subjects: ["Nixo"] });
    expect(
      stageAbout({
        stage: "REVIEWING_INVESTOR_CRITERIA",
        args: { investorOrganisationId: FUND },
        read,
      }),
    ).toEqual({ subjects: ["Kestrel Ventures"] });
  });

  it("names nothing it has not read: an unread id is the approved label", () => {
    expect(
      stageAbout({
        stage: "REVIEWING_COMPANY",
        args: { companyId: "0198f8b2-9c1a-7a3e-8f2b-1c2d3e4f5a6b" },
        read,
      }),
    ).toBeUndefined();
    // A model's or a person's words are never a source of names.
    expect(
      stageAbout({
        stage: "REVIEWING_COMPANY",
        args: { query: "Acme Foods" },
        read,
      }),
    ).toBeUndefined();
  });

  it("a comparison with no id of its own is about the companies read so far", () => {
    expect(
      stageAbout({ stage: "COMPARING_OPPORTUNITIES", args: {}, read }),
    ).toEqual({ subjects: ["Nixo", "Halyard"] });
  });

  it("never names anything for the public web (R38), and keeps to three valid names", () => {
    expect(
      stageAbout({
        stage: "SEARCHING_PUBLIC_SOURCES",
        args: { companyId: NIXO },
        read,
      }),
    ).toBeUndefined();
    const many = {
      ...read,
      companyNames: new Map(
        ["A", "B", "C", "D"].map((name, i) => [String(i), name] as const),
      ),
    };
    const about = stageAbout({
      stage: "COMPARING_OPPORTUNITIES",
      args: {},
      read: many,
    });
    expect(about?.subjects).toEqual(["A", "B", "C"]);
    expect(QStageAboutSchema.safeParse(about).success).toBe(true);
  });

  it("keys a stage by its names, so a new subject is written and a repeat is not", () => {
    expect(stageKey("REVIEWING_COMPANY", { subjects: ["Nixo"] })).not.toBe(
      stageKey("REVIEWING_COMPANY", { subjects: ["Halyard"] }),
    );
    expect(stageKey("REVIEWING_COMPANY", undefined)).toBe(
      stageKey("REVIEWING_COMPANY", undefined),
    );
  });
});
