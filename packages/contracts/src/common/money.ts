import { z } from "zod";
import { DecimalStringSchema } from "./decimal.js";

/**
 * An ISO 4217-shaped currency code.
 *
 * This validates wire format only -- three uppercase letters. It deliberately
 * does not check the code against a hardcoded currency list: format validation
 * and reference-data validation are different concerns with different change
 * rates, and an inline list in source would drift. Whether Capital Q actually
 * supports a given currency is a reference-data policy decision made later.
 */
export const CurrencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "expected a three-letter uppercase currency code");

export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;

/**
 * An exact monetary amount with an explicit currency.
 *
 *   { "amount": "2000000.00", "currency": "USD" }
 *
 * Currency is never implicit. An amount without a currency is not money, and a
 * system that assumes a default currency will eventually assume the wrong one.
 *
 * No sign constraint is imposed here. Refunds, adjustments and accounting
 * entries are legitimately negative, so "must be positive" is a domain
 * invariant -- a capital raise target can refine this schema -- not a property
 * of the representation.
 */
export const MoneySchema = z.object({
  amount: DecimalStringSchema,
  currency: CurrencyCodeSchema,
});

export type Money = z.infer<typeof MoneySchema>;
