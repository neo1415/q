import {
  CURRENCY_OPTIONS,
  FOUNDER_STEPS,
  INSTRUMENT_OPTIONS,
} from "../definition/founder-v1.js";

/**
 * What a founder TOLD Q during setup, from their own answers (QA QO-38,
 * QO-44, 23 Oct 2026): a $1.5m raise and 320 customers were saved as
 * answers, yet readiness said "no raise target", call prep said the record
 * "doesn't show customers" and the profile showed "Not added", because the
 * raise becomes the company's capital objective only when they confirm it,
 * and customers have no canonical field at all.
 *
 * These are the founder's own statements: truth class USER_CLAIM, evidence
 * SELF_REPORTED, and a reader shows them as "you told Q; not yet
 * confirmed". They never stand in for a confirmed record: a reader uses
 * one only where the record holds nothing. Absent answers stay absent
 * (unknown is never zero).
 */
export type FounderStatedFacts = {
  /** The raise as stated; null when no amount was given. */
  readonly raise: {
    /** "1500000 USD", the capital objective's own shape. */
    readonly target: string;
    readonly amount: string;
    /** ISO code, upper case; null when no currency was given. */
    readonly currency: string | null;
    /** The instrument's label ("SAFE"); null when not given. */
    readonly instrument: string | null;
    readonly useOfFunds: boolean;
  } | null;
  /** Paying customers, as a decimal string; null when not given. */
  readonly customers: string | null;
  /** Pilots, as a decimal string; null when not given. */
  readonly pilots: string | null;
};

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function rangeOf(value: unknown): string | null {
  if (field(value, "type") !== "RANGE") return null;
  const amount = field(value, "value");
  return typeof amount === "string" && amount.trim().length > 0
    ? amount.trim()
    : null;
}

function optionOf(value: unknown): string | null {
  if (field(value, "type") !== "SINGLE_SELECT") return null;
  const key = field(value, "optionKey");
  return typeof key === "string" && key.length > 0 ? key : null;
}

export function founderStatedFacts(
  values: Readonly<Record<string, unknown>>,
): FounderStatedFacts {
  const amount = rangeOf(values[FOUNDER_STEPS.targetAmount]);
  const currencyKey = optionOf(values[FOUNDER_STEPS.currency]);
  const currency =
    currencyKey !== null &&
    CURRENCY_OPTIONS.some((option) => option.optionKey === currencyKey)
      ? currencyKey.toUpperCase()
      : null;
  // "Not sure yet" is no instrument stated.
  const chosenInstrument = optionOf(values[FOUNDER_STEPS.instrument]);
  const instrumentKey = chosenInstrument === "unsure" ? null : chosenInstrument;
  const useOfFunds = values[FOUNDER_STEPS.useOfFunds];
  return {
    raise:
      amount === null
        ? null
        : {
            target: currency === null ? amount : `${amount} ${currency}`,
            amount,
            currency,
            instrument:
              instrumentKey === null
                ? null
                : (INSTRUMENT_OPTIONS.find(
                    (option) => option.optionKey === instrumentKey,
                  )?.label ?? null),
            useOfFunds:
              field(useOfFunds, "type") === "MULTI_SELECT" &&
              Array.isArray(field(useOfFunds, "optionKeys")) &&
              (field(useOfFunds, "optionKeys") as unknown[]).length > 0,
          },
    customers: rangeOf(values[FOUNDER_STEPS.customers]),
    pilots: rangeOf(values[FOUNDER_STEPS.pilots]),
  };
}
