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
