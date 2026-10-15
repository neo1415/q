"use client";

import type { CapitalRoundInstrument } from "@capital-q/contracts";

import { INSTRUMENT_LABELS } from "./round-labels";

const INSTRUMENTS: readonly CapitalRoundInstrument[] = [
  "SAFE",
  "EQUITY",
  "CONVERTIBLE",
  "ASA",
  "OTHER",
];

/**
 * A round's instrument (F2): the five instruments plus "Not stated", which
 * is null, never a fake SAFE. `undefined` is nothing chosen yet: no chip is
 * pre-selected, so nobody is nudged into stating what they have not.
 */
export function InstrumentChoice({
  id,
  value,
  onChange,
}: {
  readonly id: string;
  readonly value: CapitalRoundInstrument | null | undefined;
  readonly onChange: (value: CapitalRoundInstrument | null) => void;
}) {
  const options: readonly {
    readonly value: CapitalRoundInstrument | null;
    readonly label: string;
  }[] = [
    ...INSTRUMENTS.map((instrument) => ({
      value: instrument,
      label: INSTRUMENT_LABELS[instrument],
    })),
    { value: null, label: "Not stated" },
  ];
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="cq-label mb-2 text-(--cq-text-primary)">
        Instrument
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value ?? "NOT_STATED"}
            className="cq-body-sm inline-flex min-h-11 cursor-pointer items-center rounded-full border border-(--cq-border) px-4 text-(--cq-text-primary) has-checked:border-transparent has-checked:bg-(--cq-accent-soft) has-focus-visible:outline-2 has-focus-visible:outline-(--cq-focus-ring)"
          >
            <input
              type="radio"
              name={`${id}-instrument`}
              value={option.value ?? ""}
              checked={value !== undefined && value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
