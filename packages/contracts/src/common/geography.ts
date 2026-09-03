import { z } from "zod";

/**
 * ISO 3166-1 alpha-2 country code, uppercase. Format only: the list of
 * assigned codes is reference data, not something a wire schema pins.
 */
export const CountryCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, "expected an ISO 3166-1 alpha-2 country code");

export type CountryCode = z.infer<typeof CountryCodeSchema>;
