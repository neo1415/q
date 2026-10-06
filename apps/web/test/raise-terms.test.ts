import { describe, expect, it, vi } from "vitest";

import type { CapitalObjectiveDto } from "@capital-q/contracts";

vi.mock("../src/features/capital/capital-actions", () => ({}));

import { exactAmount, termsChanges } from "../src/features/capital/raise-terms";

/**
 * F5: the raise's terms send only what changed, exactly, and an empty
 * field is "not stated" (null), never zero.
 */

const OBJECTIVE = {
  id: "00000000-0000-4000-8000-0000000000d1",
  companyId: "00000000-0000-4000-8000-0000000000c1",
  objectiveType: "RAISE",
  status: "ACTIVE",
  target: { amount: "1800000", currency: "USD" },
  targetStage: "seed",
  instrumentCode: null,
  targetCloseDate: null,
  useOfFundsSummary: null,
  valuation: null,
  minimumCheque: null,
  startedAt: "2026-10-01T00:00:00.000Z",
  closedAt: null,
  version: 3,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
} satisfies CapitalObjectiveDto;

const EMPTY = {
  instrument: "",
  valuationKind: "" as const,
  valuationAmount: "",
  minimumCheque: "",
  closeDate: "",
  useOfFunds: "",
};

describe("raise terms", () => {
  it("reads typed amounts exactly; empty is unknown, zero is refused", () => {
    expect(exactAmount("12,000,000")).toBe("12000000");
    expect(exactAmount("")).toBeNull();
    expect(exactAmount("0")).toBeUndefined();
    expect(exactAmount("1e6")).toBeUndefined();
  });

  it("sends only what changed, with the version read", () => {
    expect(termsChanges(OBJECTIVE, EMPTY)).toBeNull();
    expect(
      termsChanges(OBJECTIVE, {
        ...EMPTY,
        instrument: "safe",
        valuationKind: "CAP",
        valuationAmount: "12,000,000",
        minimumCheque: "25000",
        closeDate: "2026-12-31",
      }),
    ).toEqual({
      expectedVersion: 3,
      instrumentCode: "safe",
      valuation: { kind: "CAP", amount: "12000000" },
      minimumCheque: "25000",
      targetCloseDate: "2026-12-31",
    });
  });

  it("a valuation needs both its kind and its amount", () => {
    expect(
      termsChanges(OBJECTIVE, { ...EMPTY, valuationAmount: "5000000" }),
    ).toBe("INVALID");
  });
});
