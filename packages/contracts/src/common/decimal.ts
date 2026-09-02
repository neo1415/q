import { z } from "zod";

/**
 * An exact decimal carried as a string.
 *
 * JavaScript numbers are binary floating point and cannot represent ordinary
 * decimal values exactly -- 0.1 + 0.2 is not 0.3. For monetary and financial
 * values that is a correctness defect, so exact values never become `number`
 * anywhere on a Capital Q wire contract.
 *
 * Accepted:   "0"  "0.00"  "123"  "123.45"  "-10.25"  "2000000.00"
 * Rejected:   "1e6"  "1,000.00"  "$100"  "NaN"  "Infinity"  ""  " "
 *             ".5"  "1."  "007"
 *
 * Trailing zeros are preserved: "10.50" and "10.5" are distinct strings and the
 * schema does not normalise between them. Significant digits carry meaning, and
 * rounding is a decision for the code that does arithmetic, not for a boundary
 * validator.
 *
 * Exponent notation is rejected because it is ambiguous to parse exactly and
 * has no place in a stored financial figure. Grouping separators are rejected
 * because they are presentation, not data.
 */
const EXACT_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export const DecimalStringSchema = z
  .string()
  .regex(EXACT_DECIMAL, 'expected an exact decimal string such as "123.45"');

export type DecimalString = z.infer<typeof DecimalStringSchema>;
