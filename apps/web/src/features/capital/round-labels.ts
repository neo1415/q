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

/** A round's instrument on screen; null is said as unknown, never a default. */
export function instrumentLabel(
  instrument: CapitalRoundInstrument | null,
): string {
  return instrument === null
    ? "Instrument not stated"
    : INSTRUMENT_LABELS[instrument];
}
