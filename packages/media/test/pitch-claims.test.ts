import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  extractPitchClaims,
  moneyIn,
  pitchMomentLabel,
  type TimedCue,
} from "../src/index.js";

/**
 * What a pitch says, read deterministically from its transcript. The
 * fixture is Tensorgate's stored transcript (Daniel Park's elevator pitch,
 * provider-generated captions), copied verbatim.
 */
const tensorgate = JSON.parse(
  readFileSync(
    new URL("./fixtures/tensorgate-pitch-cues.json", import.meta.url),
    "utf8",
  ),
) as TimedCue[];

describe("extractPitchClaims", () => {
  it("reads Tensorgate's raise, stage and traction with the moment each is said", () => {
    const claims = extractPitchClaims(tensorgate);
    const raise = claims.find((c) => c.kind === "RAISE");
    expect(raise).toMatchObject({
      money: { amount: "4000000", currency: "USD" },
      stageCode: "seed",
      atMs: 43573,
    });
    expect(raise?.statement).toContain("raising a $4 million seed");
    expect(pitchMomentLabel(raise?.atMs ?? -1)).toBe("0:43");
    expect(claims.find((c) => c.kind === "STAGE")?.stageCode).toBe("seed");
    expect(
      claims
        .filter((c) => c.kind === "TRACTION")
        .map((c) => [c.statement, pitchMomentLabel(c.atMs)]),
    ).toEqual([
      ["Four design partners in banking and healthcare", "0:33"],
      ["Two already on paid contracts", "0:38"],
      ["31 million requests served", "0:38"],
    ]);
    // A latency figure is not traction; nothing is invented.
    expect(claims.some((c) => c.statement.includes("milliseconds"))).toBe(
      false,
    );
    expect(claims.some((c) => c.kind === "INSTRUMENT")).toBe(false);
  });

  it("is deterministic", () => {
    expect(extractPitchClaims(tensorgate)).toEqual(
      extractPitchClaims(tensorgate),
    );
  });

  it("never turns a figure without a currency into money", () => {
    expect(moneyIn("we're raising 4 million")).toBeNull();
    const claims = extractPitchClaims([
      {
        startMs: 0,
        endMs: 2000,
        text: "We're raising 4 million for our seed.",
      },
    ]);
    expect(claims.some((c) => c.kind === "RAISE")).toBe(false);
  });

  it("reads other currencies, scales and instruments without floats", () => {
    expect(moneyIn("raising £1.5m")).toEqual({
      amount: "1500000",
      currency: "GBP",
    });
    expect(moneyIn("raising 250 thousand dollars")).toEqual({
      amount: "250000",
      currency: "USD",
    });
    expect(moneyIn("USD 2,500,000")).toEqual({
      amount: "2500000",
      currency: "USD",
    });
    const claims = extractPitchClaims([
      { startMs: 61000, endMs: 64000, text: "We are raising $750k on a SAFE," },
      { startMs: 64000, endMs: 66000, text: "our pre-seed round." },
      {
        startMs: 66000,
        endMs: 70000,
        text: "The money will go to hiring two engineers.",
      },
    ]);
    expect(claims.find((c) => c.kind === "RAISE")).toMatchObject({
      money: { amount: "750000", currency: "USD" },
      stageCode: "pre_seed",
      instrument: "SAFE",
      atMs: 61000,
    });
    expect(claims.find((c) => c.kind === "USE_OF_FUNDS")).toMatchObject({
      statement: "The money will go to hiring two engineers.",
      atMs: 66000,
    });
    expect(pitchMomentLabel(61000)).toBe("1:01");
  });

  it("says nothing for a pitch with no transcript", () => {
    expect(extractPitchClaims([])).toEqual([]);
  });

  it("does not read a past raise as the current one", () => {
    const claims = extractPitchClaims([
      { startMs: 0, endMs: 3000, text: "We raised $1M from angels last year." },
    ]);
    expect(claims.some((c) => c.kind === "RAISE")).toBe(false);
  });
});
