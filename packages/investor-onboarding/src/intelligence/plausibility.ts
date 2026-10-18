import type { OnboardingResponseValue } from "@capital-q/contracts";
import { compareDecimalStrings } from "@capital-q/investors";

import { INVESTOR_STEPS } from "../definition/investor-v1.js";

/**
 * Internal consistency of what an investor has put on the record
 * (founder live test, 2026-09-25: "angel, pre-seed, €50,000–€100 million
 * cheque, typical €3 million" passed without a word).
 *
 * Code computes the checks; Q is handed each as a fact to raise, once,
 * naturally, and the person decides. Nothing here corrects a value, and
 * nothing here runs without the values it needs: unknown stays unknown,
 * so a missing figure or a currency the bands do not cover produces no
 * check at all.
 *
 * Money is compared as exact decimal strings, never as numbers.
 */

/**
 * The bands the stage and investor-type checks use (versioned config, for
 * review). They are broad, conservative ceilings on a TYPICAL cheque,
 * meant to catch a figure that is off by orders of magnitude, not to
 * judge a mandate. Applied only in currencies of broadly similar unit
 * value; every other currency is left unchecked rather than converted.
 */
export const INVESTOR_CHEQUE_PLAUSIBILITY_V1 = {
  version: 1,
  comparableCurrencies: ["usd", "eur", "gbp"],
  /** A range whose top is more than this many times its bottom. */
  maxRangeRatio: 1_000,
  /** Typical cheque ceilings for an investor whose stages are all early. */
  earlyStageTypicalCeiling: {
    pre_seed: "2000000",
    seed: "5000000",
  },
  /** Typical cheque ceiling for an angel investing personally. */
  angelTypicalCeiling: "1000000",
} as const;

export type PlausibilityTension = {
  /** Code-generated and bound to the values: a changed value is a new check. */
  readonly id: string;
  readonly code:
    | "MIN_ABOVE_MAX"
    | "TYPICAL_OUTSIDE_RANGE"
    | "RANGE_SPAN"
    | "STAGE_CHEQUE"
    | "ANGEL_CHEQUE";
  /** The steps whose values the check reads. */
  readonly stepKeys: readonly string[];
  /** The inconsistency as a fact, with the values on the record. */
  readonly fact: string;
};

type Values = ReadonlyMap<string, OnboardingResponseValue>;

function rangeOf(values: Values, stepKey: string): string | null {
  const value = values.get(stepKey);
  return value?.type === "RANGE" ? value.value : null;
}

function optionOf(values: Values, stepKey: string): string | null {
  const value = values.get(stepKey);
  return value?.type === "SINGLE_SELECT" ? value.optionKey : null;
}

function optionsOf(values: Values, stepKey: string): readonly string[] {
  const value = values.get(stepKey);
  return value?.type === "MULTI_SELECT" ? value.optionKeys : [];
}

/** An exact decimal string times a power of ten, still exact. */
function timesPowerOfTen(value: string, zeros: number): string {
  const [whole = "0", fraction = ""] = value.split(".");
  const padded = fraction.padEnd(zeros, "0");
  const shifted = `${whole}${padded.slice(0, zeros)}`.replace(/^0+(?=\d)/, "");
  const rest = padded.slice(zeros);
  return rest.length === 0 ? shifted : `${shifted}.${rest}`;
}

function money(value: string, currency: string | null): string {
  const [whole = "0", fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const amount = fraction === undefined ? grouped : `${grouped}.${fraction}`;
  return currency === null ? amount : `${currency.toUpperCase()} ${amount}`;
}

export function investorPlausibility(values: Values): PlausibilityTension[] {
  const config = INVESTOR_CHEQUE_PLAUSIBILITY_V1;
  const min = rangeOf(values, INVESTOR_STEPS.chequeMin);
  const max = rangeOf(values, INVESTOR_STEPS.chequeMax);
  const typical = rangeOf(values, INVESTOR_STEPS.chequeTypical);
  const currency = optionOf(values, INVESTOR_STEPS.currency);
  const investorType = optionOf(values, INVESTOR_STEPS.investorType);
  const stages = optionsOf(values, INVESTOR_STEPS.stages);
  const tensions: PlausibilityTension[] = [];
  const add = (
    code: PlausibilityTension["code"],
    stepKeys: readonly string[],
    fact: string,
    bound: readonly (string | null)[],
  ) =>
    tensions.push({
      id: `${code}:${bound.map((b) => b ?? "-").join(":")}`,
      code,
      stepKeys,
      fact,
    });

  if (min !== null && max !== null && compareDecimalStrings(min, max) > 0) {
    add(
      "MIN_ABOVE_MAX",
      [INVESTOR_STEPS.chequeMin, INVESTOR_STEPS.chequeMax],
      `The minimum cheque on record (${money(min, currency)}) is above the maximum (${money(max, currency)}).`,
      [min, max],
    );
  }
  if (typical !== null) {
    const below = min !== null && compareDecimalStrings(typical, min) < 0;
    const above = max !== null && compareDecimalStrings(typical, max) > 0;
    if (below || above) {
      add(
        "TYPICAL_OUTSIDE_RANGE",
        [
          INVESTOR_STEPS.chequeTypical,
          ...(below ? [INVESTOR_STEPS.chequeMin] : []),
          ...(above ? [INVESTOR_STEPS.chequeMax] : []),
        ],
        `The typical cheque on record (${money(typical, currency)}) is ${below ? `below the minimum (${money(min ?? "0", currency)})` : `above the maximum (${money(max ?? "0", currency)})`}.`,
        [typical, min, max],
      );
    }
  }
  if (
    min !== null &&
    max !== null &&
    compareDecimalStrings(min, "0") > 0 &&
    compareDecimalStrings(max, timesPowerOfTen(min, 3)) > 0
  ) {
    add(
      "RANGE_SPAN",
      [INVESTOR_STEPS.chequeMin, INVESTOR_STEPS.chequeMax],
      `The cheque range on record runs from ${money(min, currency)} to ${money(max, currency)}: the top is more than ${String(config.maxRangeRatio)} times the bottom.`,
      [min, max],
    );
  }

  const comparable =
    currency !== null &&
    (config.comparableCurrencies as readonly string[]).includes(currency);
  const cheque = typical ?? null;
  if (comparable && cheque !== null && stages.length > 0) {
    const ceilings = stages.map(
      (stage) =>
        (config.earlyStageTypicalCeiling as Readonly<Record<string, string>>)[
          stage
        ],
    );
    // Only when every stage they back is early: a later stage can carry
    // a larger cheque, and then this check says nothing.
    if (ceilings.every((c): c is string => c !== undefined)) {
      const ceiling = ceilings.reduce((a, b) =>
        compareDecimalStrings(a, b) >= 0 ? a : b,
      );
      if (compareDecimalStrings(cheque, ceiling) > 0) {
        add(
          "STAGE_CHEQUE",
          [INVESTOR_STEPS.chequeTypical, INVESTOR_STEPS.stages],
          `The typical cheque on record (${money(cheque, currency)}) is above ${money(ceiling, currency)}, far larger than cheques usually written at the stages on record (${stages.join(", ").replace(/_/g, "-")}).`,
          [cheque, ...stages],
        );
      }
    }
  }
  if (
    comparable &&
    cheque !== null &&
    investorType === "angel" &&
    compareDecimalStrings(cheque, config.angelTypicalCeiling) > 0
  ) {
    add(
      "ANGEL_CHEQUE",
      [INVESTOR_STEPS.chequeTypical, INVESTOR_STEPS.investorType],
      `The typical cheque on record (${money(cheque, currency)}) is above ${money(config.angelTypicalCeiling, currency)}, far larger than an angel investing personally usually writes.`,
      [cheque, investorType],
    );
  }
  return tensions;
}
