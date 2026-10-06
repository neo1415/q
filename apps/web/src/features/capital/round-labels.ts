import type { CapitalRoundInstrument } from "@capital-q/contracts";

export const INSTRUMENT_LABELS: Readonly<
  Record<CapitalRoundInstrument, string>
> = {
  SAFE: "SAFE",
  EQUITY: "Equity",
  CONVERTIBLE: "Convertible note",
  ASA: "ASA",
  OTHER: "Other",
};
