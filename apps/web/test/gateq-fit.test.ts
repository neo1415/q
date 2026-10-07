import { describe, expect, it } from "vitest";

import { gateSummary } from "../src/features/discover/gate-words";
import { criterionLines, mayShare, verdictOf } from "../src/features/gateq/fit";
import { verdictTitle } from "../src/features/gateq/form/form-model";

describe("a gate with no published criteria (F28)", () => {
  it("reads as neutral, never 'meets all 0'", () => {
    const summary = gateSummary({
      investorOrganisationId: "00000000-0000-4000-8000-0000000000a1",
      publicId: "zino",
      title: "Zino",
      acceptingApplications: true,
      criteria: [],
    });
    expect(summary).toBe("Open to applications · no published criteria yet.");
    expect(summary).not.toMatch(/Meets all/);
    expect(verdictTitle("FITS", "Zino", [])).toBe(
      "Zino has no published criteria yet; you can apply",
    );
  });
});

const gateway = {
  criteria: [
    {
      label: "Stage",
      requiredness: "REQUIRED" as const,
      dimension: "STAGE" as const,
    },
    {
      label: "Where you're based",
      requiredness: "REQUIRED" as const,
      dimension: "GEOGRAPHY" as const,
    },
    {
      label: "Cheque size",
      requiredness: "PREFERRED" as const,
      dimension: "CHEQUE_COMPATIBILITY" as const,
    },
  ],
};

describe("the fit shown to a founder (P7)", () => {
  it("is GateQ's access decision, never anything else", () => {
    expect(
      verdictOf({ access: "MAY_APPLY", status: "READY_TO_SUBMIT" }, false),
    ).toBe("FITS");
    expect(
      verdictOf({ access: "MAY_NOT_APPLY", status: "IN_PROGRESS" }, false),
    ).toBe("NOT_A_FIT");
  });

  it("keeps unknown unknown: still finding out until the founder stops, then partial, never a no", () => {
    const needs = {
      access: "NEEDS_INFORMATION" as const,
      status: "IN_PROGRESS" as const,
    };
    expect(verdictOf(needs, false)).toBeNull();
    expect(verdictOf(needs, true)).toBe("PARTIAL");
    expect(verdictOf(null, true)).toBeNull();
  });

  it("offers sharing only for a fit, because the API admits nothing else", () => {
    expect(mayShare("FITS")).toBe(true);
    expect(mayShare("PARTIAL")).toBe(false);
    expect(mayShare("NOT_A_FIT")).toBe(false);
    expect(mayShare(null)).toBe(false);
  });

  it("labels each published rule by where the founder stands", () => {
    const lines = criterionLines(gateway, {
      unmet: ["Where you're based"],
      stillNeeded: ["Cheque size"],
    });
    expect(
      lines.map((line) => [line.label, line.standing, line.required]),
    ).toEqual([
      ["Stage", "MET", true],
      ["Where you're based", "NOT_MET", true],
      ["Cheque size", "UNKNOWN", false],
    ]);
  });

  it("starts with every rule unknown, never met by default", () => {
    expect(
      criterionLines(gateway, null).every((l) => l.standing === "UNKNOWN"),
    ).toBe(true);
  });
});
