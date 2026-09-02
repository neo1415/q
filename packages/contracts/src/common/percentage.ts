import { z } from "zod";
import { DecimalStringSchema } from "./decimal.js";

/**
 * A percentage with its unit stated explicitly.
 *
 *   { "value": "25.0", "unit": "PERCENT" }
 *
 * A bare number is ambiguous: one endpoint means 0.25 and another means 25 for
 * the same quantity, and the mistake is invisible until someone reports a
 * hundred-fold error. Carrying the unit makes the reading unambiguous at every
 * boundary.
 *
 * No range is imposed. 0-100 is not universal for Capital Q: growth, change and
 * variance metrics are legitimately negative or above 100. Domain contracts that
 * genuinely need bounds -- an equity stake, say -- refine this. The invariant
 * this primitive owns is unambiguous units, not permissible range.
 */
export const PercentageSchema = z.object({
  value: DecimalStringSchema,
  unit: z.literal("PERCENT"),
});

export type Percentage = z.infer<typeof PercentageSchema>;
