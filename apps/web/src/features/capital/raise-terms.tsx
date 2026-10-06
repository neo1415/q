"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import type {
  CapitalObjectiveDto,
  RaiseValuationKind,
  UpdateCapitalObjectiveRequest,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { Input } from "@capital-q/ui/input";
import { Select } from "@capital-q/ui/select";

import { saveRaiseTermsAction } from "./capital-actions";

/**
 * F5: the raise's terms on /capital. Everything is optional and unknown
 * stays unknown: an empty field is "not stated", never zero. Amounts are in
 * the raise's own currency and travel as exact strings.
 */

const INSTRUMENTS = [
  { value: "", label: "Not stated" },
  { value: "safe", label: "SAFE" },
  { value: "priced_equity", label: "Priced equity" },
  { value: "convertible_note", label: "Convertible note" },
] as const;

const VALUATION_KINDS: readonly {
  readonly value: "" | RaiseValuationKind;
  readonly label: string;
}[] = [
  { value: "", label: "Not stated" },
  { value: "CAP", label: "Valuation cap" },
  { value: "PRE_MONEY", label: "Pre-money valuation" },
  { value: "POST_MONEY", label: "Post-money valuation" },
];

/** Digits with an optional decimal part; commas and spaces typed are dropped. */
/** Undefined: not a number above zero. */
export function exactAmount(typed: string): string | null | undefined {
  const clean = typed.replace(/[\s,]/gu, "");
  if (clean === "") return null;
  if (!/^\d+(\.\d{1,4})?$/u.test(clean) || !/[1-9]/u.test(clean)) {
    return undefined;
  }
  return clean.replace(/^0+(?=\d)/u, "");
}

/**
 * Only what changed goes to the API, with the version read; a cleared
 * field is an explicit null. Null when nothing changed; "INVALID" when an
 * amount is not a number above zero.
 */
export function termsChanges(
  objective: CapitalObjectiveDto,
  draft: {
    readonly instrument: string;
    readonly valuationKind: "" | RaiseValuationKind;
    readonly valuationAmount: string;
    readonly minimumCheque: string;
    readonly closeDate: string;
    readonly useOfFunds: string;
  },
): UpdateCapitalObjectiveRequest | null | "INVALID" {
  const valuationAmount = exactAmount(draft.valuationAmount);
  const minimumCheque = exactAmount(draft.minimumCheque);
  if (valuationAmount === undefined || minimumCheque === undefined) {
    return "INVALID";
  }
  if ((draft.valuationKind === "") !== (valuationAmount === null)) {
    return "INVALID";
  }
  const valuation =
    draft.valuationKind === "" || valuationAmount === null
      ? null
      : { kind: draft.valuationKind, amount: valuationAmount };
  const instrument = draft.instrument === "" ? null : draft.instrument;
  const closeDate = draft.closeDate === "" ? null : draft.closeDate;
  const useOfFunds = draft.useOfFunds.trim() === "" ? null : draft.useOfFunds;
  const changes: {
    -readonly [
      K in Exclude<keyof UpdateCapitalObjectiveRequest, "expectedVersion">
    ]?: UpdateCapitalObjectiveRequest[K];
  } = {};
  if (instrument !== objective.instrumentCode)
    changes.instrumentCode = instrument;
  const before = objective.valuation ?? null;
  if (
    (before === null) !== (valuation === null) ||
    before?.kind !== valuation?.kind ||
    before?.amount !== valuation?.amount
  ) {
    changes.valuation = valuation;
  }
  if (minimumCheque !== (objective.minimumCheque ?? null))
    changes.minimumCheque = minimumCheque;
  if (closeDate !== objective.targetCloseDate)
    changes.targetCloseDate = closeDate;
  if (useOfFunds !== objective.useOfFundsSummary)
    changes.useOfFundsSummary = useOfFunds;
  if (Object.keys(changes).length === 0) return null;
  return { expectedVersion: objective.version, ...changes };
}

export function RaiseTerms({
  objective,
}: {
  readonly objective: CapitalObjectiveDto;
}) {
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [instrument, setInstrument] = useState(objective.instrumentCode ?? "");
  const [valuationKind, setValuationKind] = useState<"" | RaiseValuationKind>(
    objective.valuation?.kind ?? "",
  );
  const [valuationAmount, setValuationAmount] = useState(
    objective.valuation?.amount ?? "",
  );
  const [minimumCheque, setMinimumCheque] = useState(
    objective.minimumCheque ?? "",
  );
  const [closeDate, setCloseDate] = useState(objective.targetCloseDate ?? "");
  const [useOfFunds, setUseOfFunds] = useState(
    objective.useOfFundsSummary ?? "",
  );
  const currency = objective.target.currency;

  return (
    <form
      className="flex flex-col gap-4"
      aria-label="Raise terms"
      data-raise-terms
      onSubmit={(event) => {
        event.preventDefault();
        const changes = termsChanges(objective, {
          instrument,
          valuationKind,
          valuationAmount,
          minimumCheque,
          closeDate,
          useOfFunds,
        });
        if (changes === "INVALID") {
          setMessage(
            "Amounts are numbers above zero, and a valuation needs both its kind and its amount.",
          );
          return;
        }
        if (changes === null) {
          setMessage("Nothing changed.");
          return;
        }
        startTransition(async () => {
          const out = await saveRaiseTermsAction(objective.id, changes);
          setMessage(out.ok ? "Saved." : out.message);
          if (out.ok) router.refresh();
        });
      }}
    >
      <h3 className="cq-title-sm text-(--cq-text-primary)">Terms</h3>
      <p className="cq-body-sm text-(--cq-text-secondary)">
        Private to your company. Leave a field empty when it isn&apos;t decided;
        Q never fills it in for you.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          id={`${id}-instrument`}
          label="Instrument"
          value={instrument}
          options={INSTRUMENTS}
          onChange={(event) => setInstrument(event.target.value)}
        />
        <Input
          id={`${id}-close`}
          label="Target close date"
          type="date"
          value={closeDate}
          onChange={(event) => setCloseDate(event.target.value)}
        />
        <Select
          id={`${id}-valuation-kind`}
          label="Valuation"
          value={valuationKind}
          options={VALUATION_KINDS}
          onChange={(event) =>
            setValuationKind(event.target.value as "" | RaiseValuationKind)
          }
        />
        <Input
          id={`${id}-valuation`}
          label={`Valuation amount (${currency})`}
          inputMode="decimal"
          value={valuationAmount}
          placeholder="12,000,000"
          onChange={(event) => setValuationAmount(event.target.value)}
        />
        <Input
          id={`${id}-minimum`}
          label={`Minimum cheque (${currency})`}
          inputMode="decimal"
          value={minimumCheque}
          placeholder="25,000"
          onChange={(event) => setMinimumCheque(event.target.value)}
        />
      </div>
      <Input
        id={`${id}-use`}
        label="Use of funds"
        value={useOfFunds}
        maxLength={2000}
        placeholder="18 months of runway: two engineers, a sales lead"
        onChange={(event) => setUseOfFunds(event.target.value)}
      />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          Save terms
        </Button>
        {message === null ? null : (
          <p role="status" className="cq-body-sm text-(--cq-text-secondary)">
            {message}
          </p>
        )}
      </div>
    </form>
  );
}
