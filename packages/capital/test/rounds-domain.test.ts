import { describe, expect, it } from "vitest";

import {
  addDecimal,
  availableRoundSteps,
  basisPoints,
  checkRoundTerms,
  compareDecimal,
  nextRoundStatus,
  ownershipEstimate,
  roundChanges,
  roundNotices,
} from "../src/index.js";
import { EMPTY_TERMS } from "../src/domain/rounds.js";

const NONE = { moneyHasClosed: false };

describe("round lifecycle", () => {
  it("walks planned -> open -> first close -> final close", () => {
    expect(nextRoundStatus("PLANNED", "OPEN", NONE)).toEqual({ ok: true, status: "OPEN" });
    expect(nextRoundStatus("OPEN", "CLOSE", NONE)).toEqual({ ok: true, status: "FIRST_CLOSED" });
    expect(nextRoundStatus("FIRST_CLOSED", "CLOSE", NONE)).toEqual({ ok: true, status: "FIRST_CLOSED" });
    expect(nextRoundStatus("FIRST_CLOSED", "FINAL_CLOSE", NONE)).toEqual({ ok: true, status: "CLOSED" });
  });

  it("a tranche in an open round is money closing; after the final close it is milestone money", () => {
    expect(nextRoundStatus("OPEN", "TRANCHE", NONE)).toEqual({ ok: true, status: "FIRST_CLOSED" });
    expect(nextRoundStatus("CLOSED", "TRANCHE", NONE)).toEqual({ ok: true, status: "CLOSED" });
    expect(nextRoundStatus("PLANNED", "TRANCHE", NONE)).toEqual({ ok: false, refusal: "NOT_FROM_THIS_STATUS" });
  });

  it("reopens a closed round to first-closed (its closes stay) and a cancelled one to open", () => {
    expect(nextRoundStatus("CLOSED", "REOPEN", NONE)).toEqual({ ok: true, status: "FIRST_CLOSED" });
    expect(nextRoundStatus("CANCELLED", "REOPEN", NONE)).toEqual({ ok: true, status: "OPEN" });
    expect(nextRoundStatus("OPEN", "REOPEN", NONE).ok).toBe(false);
  });

  it("never cancels a round where money has closed", () => {
    expect(nextRoundStatus("PLANNED", "CANCEL", NONE)).toEqual({ ok: true, status: "CANCELLED" });
    expect(nextRoundStatus("OPEN", "CANCEL", NONE)).toEqual({ ok: true, status: "CANCELLED" });
    expect(nextRoundStatus("OPEN", "CANCEL", { moneyHasClosed: true })).toEqual({ ok: false, refusal: "MONEY_HAS_CLOSED" });
    expect(nextRoundStatus("FIRST_CLOSED", "CANCEL", NONE)).toEqual({ ok: false, refusal: "MONEY_HAS_CLOSED" });
  });

  it("a closed round cannot be final-closed again, and lists only real next steps", () => {
    expect(nextRoundStatus("CLOSED", "FINAL_CLOSE", NONE).ok).toBe(false);
    expect(availableRoundSteps("CLOSED")).toEqual(["TRANCHE", "REOPEN"]);
    expect(availableRoundSteps("PLANNED")).toEqual(["OPEN", "CANCEL"]);
  });
});

describe("exact decimals", () => {
  it("compares and adds without floats", () => {
    expect(compareDecimal("0.1", "0.10")).toBe(0);
    expect(compareDecimal("1500000.01", "1500000")).toBe(1);
    expect(addDecimal("0.1", "0.2")).toBe("0.3");
    expect(addDecimal("999999999999999.99", "0.01")).toBe("1000000000000000");
    expect(basisPoints("250000", "10000000")).toBe(250);
    expect(basisPoints("1", "0")).toBeNull();
  });
});

describe("round terms", () => {
  const base = { id: "r1", target: "1000000", openedOn: "2026-09-01", terms: EMPTY_TERMS };

  it("refuses a hard cap below the target, a close date before opening, and self-extension", () => {
    expect(checkRoundTerms({ ...base, terms: { ...EMPTY_TERMS, hardCap: "999999.99" } })).toBe("HARD_CAP_BELOW_TARGET");
    expect(checkRoundTerms({ ...base, terms: { ...EMPTY_TERMS, hardCap: "1000000" } })).toBeNull();
    expect(checkRoundTerms({ ...base, terms: { ...EMPTY_TERMS, targetCloseOn: "2026-08-31" } })).toBe("CLOSE_DATE_BEFORE_OPEN");
    expect(checkRoundTerms({ ...base, terms: { ...EMPTY_TERMS, extendsRoundId: "r1" } })).toBe("EXTENDS_ITSELF");
  });

  it("names each changed field with its before and after (corrections create history)", () => {
    const before = { name: "Seed", target: "1000000", currency: "USD", instrument: "SAFE" as const, openedOn: "2026-09-01", terms: EMPTY_TERMS };
    const after = { ...before, target: "1500000", terms: { ...EMPTY_TERMS, valuationCap: "12000000", lead: { kind: "NAMED" as const, name: "Off-platform Ventures" } } };
    expect(roundChanges(before, after)).toEqual([
      { field: "target", from: "1000000 USD", to: "1500000 USD" },
      { field: "valuationCap", from: null, to: "12000000" },
      { field: "lead", from: null, to: "Off-platform Ventures" },
    ]);
    expect(roundChanges(before, before)).toEqual([]);
  });
});

describe("round notices", () => {
  const round = { id: "r1", status: "OPEN" as const, target: "1000000", hardCap: null, targetCloseOn: null, reportedRaised: null };
  const zero = { raised: "0", confirmed: "0", pledged: "0" };
  const input = { round, sums: zero, otherCurrencyCount: 0, otherRounds: [], today: "2026-10-06" };

  it("says nothing about a quiet round", () => {
    expect(roundNotices(input)).toEqual([]);
  });

  it("oversubscribed counts received and confirmed money, never pledges", () => {
    expect(roundNotices({ ...input, sums: { raised: "600000", confirmed: "400000.01", pledged: "0" } })).toEqual(["OVER_TARGET"]);
    expect(roundNotices({ ...input, sums: { raised: "0", confirmed: "0", pledged: "5000000" } })).toEqual([]);
    expect(
      roundNotices({ ...input, round: { ...round, hardCap: "1200000" }, sums: { raised: "1300000", confirmed: "0", pledged: "0" } }),
    ).toEqual(["OVER_HARD_CAP"]);
  });

  it("flags overlapping raising rounds, other currencies and a past target close", () => {
    expect(
      roundNotices({
        ...input,
        round: { ...round, targetCloseOn: "2026-10-01" },
        otherCurrencyCount: 1,
        otherRounds: [{ id: "r2", status: "FIRST_CLOSED" }, { id: "r3", status: "PLANNED" }],
      }),
    ).toEqual(["OVERLAPS_OPEN_ROUND", "OTHER_CURRENCY", "PAST_TARGET_CLOSE"]);
  });

  it("a final close with nothing received or reported says so; a reported amount (even zero) settles it", () => {
    const closed = { ...round, status: "CLOSED" as const };
    expect(roundNotices({ ...input, round: closed })).toEqual(["CLOSED_EMPTY"]);
    expect(roundNotices({ ...input, round: { ...closed, reportedRaised: "0" } })).toEqual([]);
  });
});

describe("ownership estimate", () => {
  it("is amount over post-money, or over a SAFE/ASA cap; never from pre-money alone", () => {
    const at = { amount: "2000000", currency: "USD", roundCurrency: "USD" };
    expect(ownershipEstimate({ ...at, instrument: "EQUITY", terms: { valuation: { amount: "10000000", basis: "POST_MONEY" }, valuationCap: null } })).toEqual({ basisPoints: 2000, from: "POST_MONEY" });
    expect(ownershipEstimate({ ...at, instrument: "SAFE", terms: { valuation: null, valuationCap: "8000000" } })).toEqual({ basisPoints: 2500, from: "CAP" });
    expect(ownershipEstimate({ ...at, instrument: "EQUITY", terms: { valuation: { amount: "8000000", basis: "PRE_MONEY" }, valuationCap: null } })).toBeNull();
    expect(ownershipEstimate({ ...at, instrument: "CONVERTIBLE", terms: { valuation: null, valuationCap: "8000000" } })).toBeNull();
  });

  it("is unknown across currencies (never converted)", () => {
    expect(ownershipEstimate({ amount: "100", currency: "EUR", roundCurrency: "USD", instrument: "SAFE", terms: { valuation: null, valuationCap: "1000" } })).toBeNull();
  });
});
