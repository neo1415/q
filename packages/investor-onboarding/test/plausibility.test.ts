import { describe, expect, it } from "vitest";

import type { OnboardingResponseValue } from "@capital-q/contracts";

import { investorPlausibility } from "../src/index.js";

/**
 * Consistency checks on an investor's record (founder live test,
 * 2026-09-25). Properties: the founder's own example raises the three
 * checks it should; a consistent mandate raises none; a check never
 * fires without every value it reads (unknown stays unknown); the stage
 * and angel bands are never applied in a currency they do not cover; a
 * check's id is bound to its values.
 */

type Record_ = Readonly<Record<string, OnboardingResponseValue>>;

const range = (value: string): OnboardingResponseValue => ({
  type: "RANGE",
  value,
});
const one = (optionKey: string): OnboardingResponseValue => ({
  type: "SINGLE_SELECT",
  optionKey,
});
const many = (...optionKeys: string[]): OnboardingResponseValue => ({
  type: "MULTI_SELECT",
  optionKeys,
});

const codes = (record: Record_) =>
  investorPlausibility(new Map(Object.entries(record)))
    .map((t) => t.code)
    .sort();

const FOUNDER_EXAMPLE: Record_ = {
  "I0.investor_type": one("angel"),
  "I2.stages": many("pre_seed"),
  "I2.currency": one("eur"),
  "I2.cheque_min": range("50000"),
  "I2.cheque_max": range("100000000"),
  "I2.cheque_typical": range("3000000"),
};

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe("consistency checks on an investor's record", () => {
  it("raises the span, the stage and the angel checks for the founder's example, and nothing else", () => {
    expect(codes(FOUNDER_EXAMPLE)).toEqual([
      "ANGEL_CHEQUE",
      "RANGE_SPAN",
      "STAGE_CHEQUE",
    ]);
  });

  it("raises nothing for consistent mandates", () => {
    const random = rng(11);
    for (let i = 0; i < 300; i += 1) {
      const min = 10_000 + Math.floor(random() * 90) * 1_000;
      const max = min * (2 + Math.floor(random() * 50));
      const typical = min + Math.floor((max - min) * random());
      const record: Record_ = {
        "I0.investor_type": one(i % 2 === 0 ? "angel" : "vc"),
        "I2.stages": many("seed", "series_a"),
        "I2.currency": one("usd"),
        "I2.cheque_min": range(String(min)),
        "I2.cheque_max": range(String(max)),
        "I2.cheque_typical": range(String(typical)),
      };
      // An angel's typical cheque above the band is a real check, and the
      // only one a consistent range can raise here.
      const angelAbove = i % 2 === 0 && typical > 1_000_000;
      expect(codes(record), JSON.stringify(record)).toEqual(
        angelAbove ? ["ANGEL_CHEQUE"] : [],
      );
    }
  });

  it("finds min above max and a typical outside the range", () => {
    expect(
      codes({
        "I2.cheque_min": range("500000"),
        "I2.cheque_max": range("100000"),
      }),
    ).toContain("MIN_ABOVE_MAX");
    expect(
      codes({
        "I2.cheque_min": range("25000"),
        "I2.cheque_max": range("100000"),
        "I2.cheque_typical": range("250000"),
      }),
    ).toEqual(["TYPICAL_OUTSIDE_RANGE"]);
    expect(
      codes({
        "I2.cheque_min": range("25000"),
        "I2.cheque_typical": range("10000"),
      }),
    ).toEqual(["TYPICAL_OUTSIDE_RANGE"]);
  });

  it("never fires without every value it reads", () => {
    const keys = Object.keys(FOUNDER_EXAMPLE);
    for (const missing of keys) {
      const record = Object.fromEntries(
        Object.entries(FOUNDER_EXAMPLE).filter(([k]) => k !== missing),
      );
      const found = investorPlausibility(new Map(Object.entries(record)));
      for (const check of found) {
        expect(check.stepKeys, `${missing} missing`).not.toContain(missing);
      }
    }
    expect(codes({})).toEqual([]);
  });

  it("applies the stage and angel bands only in currencies they cover", () => {
    for (const currency of ["ngn", "kes", "inr", "zar"]) {
      const found = codes({ ...FOUNDER_EXAMPLE, "I2.currency": one(currency) });
      expect(found, currency).toEqual(["RANGE_SPAN"]);
    }
  });

  it("a later stage lifts the stage check", () => {
    expect(
      codes({ ...FOUNDER_EXAMPLE, "I2.stages": many("pre_seed", "series_b") }),
    ).not.toContain("STAGE_CHEQUE");
  });

  it("binds a check's id to its values", () => {
    const first = investorPlausibility(
      new Map(Object.entries(FOUNDER_EXAMPLE)),
    );
    const changed = investorPlausibility(
      new Map(
        Object.entries({
          ...FOUNDER_EXAMPLE,
          "I2.cheque_typical": range("4000000"),
        }),
      ),
    );
    const angel = (list: typeof first) =>
      list.find((t) => t.code === "ANGEL_CHEQUE")?.id;
    expect(angel(first)).toBeDefined();
    expect(angel(changed)).toBeDefined();
    expect(angel(first)).not.toBe(angel(changed));
  });
});
