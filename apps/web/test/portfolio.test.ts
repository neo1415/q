import { describe, expect, it } from "vitest";

import {
  commitmentLine,
  portfolioOf,
} from "@/features/relationships/portfolio";

const item = (name: string, state: string, since: string) => ({
  relationshipId: "d0000000-0000-4000-8000-000000000001",
  counterpart: {
    kind: "COMPANY" as const,
    id: "c0000000-0000-4000-8000-000000000001",
    name,
  },
  state: state as "INVESTED",
  stateSince: since,
  nextStep: "NONE" as const,
});

const commitment = (status: string, amount = "1500000.50") => ({
  current: {
    id: "e0000000-0000-4000-8000-000000000001",
    amount,
    currencyCode: "EUR",
    level: "FIRM" as const,
    status: status as "CONFIRMED",
    source: "PERSON" as const,
    quote: null,
    statedByYourSide: true,
    statedAt: "2026-10-01T10:00:00.000Z",
    confirmedAt: null,
    note: null,
    meetingId: null,
    canConfirm: false,
  },
  history: [],
  detected: [],
  connected: true,
});

describe("portfolio (CRM S4)", () => {
  it("is the INVESTED relationships only, newest first, ties by name", () => {
    expect(
      portfolioOf([
        item("B", "INVESTED", "2026-10-01T00:00:00.000Z"),
        item("Z", "CONNECTED", "2026-10-09T00:00:00.000Z"),
        item("A", "INVESTED", "2026-10-01T00:00:00.000Z"),
        item("C", "INVESTED", "2026-10-05T00:00:00.000Z"),
      ]).map((row) => row.counterpart.name),
    ).toEqual(["C", "A", "B"]);
  });

  it("says the money in words, exact, and never turns unknown into zero", () => {
    expect(commitmentLine(commitment("RECEIVED"))).toBe(
      "EUR 1,500,000.50 · received",
    );
    expect(commitmentLine(commitment("STATED", "200000"))).toBe(
      "EUR 200,000 · stated, not yet confirmed",
    );
    expect(commitmentLine({ ...commitment("CONFIRMED"), current: null })).toBe(
      "No amount recorded",
    );
    expect(commitmentLine(undefined)).toBe("Commitment couldn't be read");
  });
});
