import { describe, expect, it } from "vitest";
import { connectedCompanies } from "../src/http/your-companies.js";

const listing = (companyId: string, state: string, stateSince: string) => ({
  relationship: { companyId },
  projection: { state, stateSince },
});

describe("Your companies lists only connections (founder, 2026-10-05)", () => {
  it("keeps CONNECTED and later; drops expressed interest, a pass and earlier states", () => {
    const entries = connectedCompanies([
      listing("c-connected", "CONNECTED", "2026-10-01T10:00:00.000Z"),
      listing("c-meeting", "MEETING_HELD", "2026-10-02T10:00:00.000Z"),
      listing("c-diligence", "IN_DILIGENCE", "2026-10-03T10:00:00.000Z"),
      listing("c-paused", "PAUSED", "2026-10-03T11:00:00.000Z"),
      listing("c-invested", "INVESTED", "2026-10-04T10:00:00.000Z"),
      listing("c-interest", "INTEREST_EXPRESSED", "2026-10-05T10:00:00.000Z"),
      listing("c-passed", "PASSED", "2026-10-05T11:00:00.000Z"),
      listing("c-none", "NO_RELATIONSHIP", "2026-10-05T12:00:00.000Z"),
    ]);
    expect(entries.map((entry) => entry.companyId).sort()).toEqual([
      "c-connected",
      "c-diligence",
      "c-invested",
      "c-meeting",
      "c-paused",
    ]);
    expect(entries.every((entry) => entry.label === "CONNECTED")).toBe(true);
  });

  it("carries when the relationship last moved, for the latest-first order", () => {
    const [entry] = connectedCompanies([
      listing("c-1", "MEETING_HELD", "2026-10-04T09:30:00.000Z"),
    ]);
    expect(entry).toEqual({
      companyId: "c-1",
      label: "CONNECTED",
      activityAt: "2026-10-04T09:30:00.000Z",
    });
  });

  it("an investor with only interests and passes has no companies here", () => {
    expect(
      connectedCompanies([
        listing("a", "INTEREST_EXPRESSED", "2026-10-01T00:00:00.000Z"),
        listing("b", "PASSED", "2026-10-01T00:00:00.000Z"),
      ]),
    ).toEqual([]);
  });
});
