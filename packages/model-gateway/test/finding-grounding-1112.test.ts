import { describe, expect, it } from "vitest";

import {
  analystResultBlocks,
  suppliedStandingsOf,
} from "../src/q/result-blocks.js";

/**
 * Owner review 12 Nov (D3): a finding is never more verified than the
 * supplied facts it cites. The model's basis is free text; only the
 * labels of facts it was actually given count, and only for what those
 * facts themselves are.
 */
const supplied = suppliedStandingsOf([
  {
    ref: "F1",
    truthClass: "USER_CLAIM",
    evidenceStatus: "SELF_REPORTED",
  },
  {
    ref: "F2",
    truthClass: "VERIFIED",
    evidenceStatus: "PLATFORM_VERIFIED",
  },
  { truthClass: "VERIFIED", evidenceStatus: "PLATFORM_VERIFIED" },
]);

const finding = (basis: readonly string[], derivation?: string) => ({
  statement: "Ledgerline is a seed-stage fintech in Lagos.",
  type: "FACT",
  confidence: "HIGH",
  truthClass: "VERIFIED",
  evidenceStatus: "PLATFORM_VERIFIED",
  basis,
  ...(derivation === undefined ? {} : { derivation }),
});

const standing = (basis: readonly string[], derivation?: string) => {
  const blocks =
    analystResultBlocks({
      result: { findings: [finding(basis, derivation)] },
      subjects: [],
      supplied,
      findingId: () => "00000000-0000-4000-8000-000000000001",
    }) ?? [];
  const block = blocks.find((b) => b.kind === "FINDING");
  if (block?.kind !== "FINDING") throw new Error("no finding");
  return {
    truthClass: block.finding.truthClass,
    evidenceStatus: block.finding.evidenceStatus,
  };
};

describe("a finding never outranks the facts it cites", () => {
  it("VERIFIED citing only a founder's own claim reads as their claim", () => {
    expect(standing(["F1"])).toEqual({
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
    });
  });

  it("VERIFIED citing a verified supplied fact keeps its standing", () => {
    expect(standing(["F2 (company record)"])).toEqual({
      truthClass: "VERIFIED",
      evidenceStatus: "PLATFORM_VERIFIED",
    });
  });

  it("a basis naming nothing supplied, or an invented label, is Q's inference with no evidence", () => {
    expect(standing(["the company profile"])).toEqual({
      truthClass: "Q_INFERENCE",
      evidenceStatus: "NO_EVIDENCE",
    });
    expect(standing(["F99"])).toEqual({
      truthClass: "Q_INFERENCE",
      evidenceStatus: "NO_EVIDENCE",
    });
  });

  it("code's own deterministic findings stand on state, unchanged", () => {
    expect(standing([], "DETERMINISTIC")).toEqual({
      truthClass: "VERIFIED",
      evidenceStatus: "PLATFORM_VERIFIED",
    });
  });
});

/**
 * Slice 1 (owner review 12 Nov): each finding carries what it rests on --
 * the cited facts' own source lines, standings and dates -- built only
 * from facts the run was given.
 */
describe("a finding shows the sources it cites", () => {
  const withSources = suppliedStandingsOf([
    {
      ref: "F1",
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
      source: "Company profile",
      asOf: "2026-10-01T09:00:00.000Z",
    },
    {
      ref: "F2",
      truthClass: "UNKNOWN",
      evidenceStatus: "NO_EVIDENCE",
      source: "Public web: example.com",
      asOf: "2026-09-14",
    },
    { ref: "F3", truthClass: "USER_CLAIM", evidenceStatus: "SELF_REPORTED" },
  ]);
  const citationsFor = (basis: readonly string[]) => {
    const blocks =
      analystResultBlocks({
        result: {
          findings: [
            {
              statement: "MedTrail sells drug traceability software.",
              type: "FACT",
              confidence: "MODERATE",
              truthClass: "USER_CLAIM",
              evidenceStatus: "SELF_REPORTED",
              basis,
            },
          ],
        },
        subjects: [],
        supplied: withSources,
        findingId: () => "00000000-0000-4000-8000-000000000002",
      }) ?? [];
    const block = blocks.find((b) => b.kind === "FINDING");
    if (block?.kind !== "FINDING") throw new Error("no finding");
    return block.finding.citations;
  };

  it("names each cited fact's source, standing and date, once", () => {
    expect(citationsFor(["F1", "F2 (the article)", "F1 again"])).toEqual([
      {
        source: "Company profile",
        truthClass: "USER_CLAIM",
        evidenceStatus: "SELF_REPORTED",
        asOf: "2026-10-01T09:00:00.000Z",
      },
      {
        source: "Public web: example.com",
        truthClass: "UNKNOWN",
        evidenceStatus: "NO_EVIDENCE",
        asOf: "2026-09-14",
      },
    ]);
  });

  it("invents nothing: an unknown label, prose, or a fact without a source line cites nothing", () => {
    expect(citationsFor(["F99"])).toBeUndefined();
    expect(citationsFor(["the profile says so"])).toBeUndefined();
    expect(citationsFor(["F3"])).toBeUndefined();
  });
});

describe("every supplied fact is citable", () => {
  it("labels the gateway's own facts after the assembled ones, never reusing a label", async () => {
    const { withFactLabels } = await import("../src/q/result-blocks.js");
    const labelled = withFactLabels([
      {
        statement: "Canonical profile",
        truthClass: "USER_CLAIM",
        evidenceStatus: "SELF_REPORTED",
        source: "Capital Q canonical company profile",
      },
      {
        ref: "F1",
        statement: "Assembled",
        truthClass: "UNKNOWN",
        evidenceStatus: "NO_EVIDENCE",
      },
      {
        ref: "F2",
        statement: "Assembled 2",
        truthClass: "UNKNOWN",
        evidenceStatus: "NO_EVIDENCE",
      },
    ]);
    expect(labelled.map((fact) => fact.ref)).toEqual(["F3", "F1", "F2"]);
    // The canonical profile can now be cited, and shows as its own source.
    const blocks =
      analystResultBlocks({
        result: {
          findings: [
            {
              statement: "MedTrail sells drug traceability software.",
              type: "FACT",
              confidence: "MODERATE",
              truthClass: "USER_CLAIM",
              evidenceStatus: "SELF_REPORTED",
              basis: ["F3"],
            },
          ],
        },
        subjects: [],
        supplied: suppliedStandingsOf(labelled),
        findingId: () => "00000000-0000-4000-8000-000000000003",
      }) ?? [];
    const block = blocks.find((b) => b.kind === "FINDING");
    expect(block?.kind === "FINDING" ? block.finding.citations : null).toEqual([
      {
        source: "Capital Q canonical company profile",
        truthClass: "USER_CLAIM",
        evidenceStatus: "SELF_REPORTED",
      },
    ]);
  });
});
