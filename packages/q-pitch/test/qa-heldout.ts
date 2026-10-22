import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Held-out test data for the Q&A bank, kept as JSON so the vectors script
 * (scripts/q-pitch/embed-qa-bank.mjs) reads the same questions as the tests.
 *
 * - heldOut / notInBank: spoken questions written apart from the bank (never
 *   stored in it), and questions the bank must not answer. The matchers were
 *   tuned on these.
 * - blind / blindNotInBank: a second set, written after tuning: the honest
 *   measure of wording never seen.
 */
type HeldOut = {
  readonly heldOut: readonly (readonly [string, string])[];
  readonly notInBank: readonly string[];
  readonly blind: readonly (readonly [string, string])[];
  readonly blindNotInBank: readonly string[];
};

const data = JSON.parse(
  readFileSync(join(import.meta.dirname, "data", "qa-heldout.json"), "utf8"),
) as HeldOut;

export const HELD_OUT = data.heldOut;
export const NOT_IN_BANK = data.notInBank;
export const BLIND = data.blind;
export const BLIND_NOT_IN_BANK = data.blindNotInBank;
