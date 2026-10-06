"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import type {
  CapitalRoundInstrument,
  OpenCapitalRoundRequest,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { Input } from "@capital-q/ui/input";
import { MoneyInput, type MoneyValue } from "@capital-q/ui/money-input";

import { openRoundAction } from "./capital-actions";
import { INSTRUMENT_LABELS } from "./round-labels";
import { EMPTY_DRAFT, saidTerms, termsFromDraft } from "./round-terms";
import {
  RoundTermsFields,
  type LeadOption,
  type RoundOption,
} from "./round-terms-fields";

const CURRENCIES = [
  { code: "USD", label: "USD" },
  { code: "NGN", label: "NGN" },
  { code: "GBP", label: "GBP" },
  { code: "EUR", label: "EUR" },
  { code: "KES", label: "KES" },
  { code: "GHS", label: "GHS" },
  { code: "ZAR", label: "ZAR" },
  // F13: currencies the seeded companies raise in.
  { code: "EGP", label: "EGP" },
  { code: "BRL", label: "BRL" },
  { code: "INR", label: "INR" },
  { code: "MXN", label: "MXN" },
  { code: "VND", label: "VND" },
] as const;

const INSTRUMENTS: readonly CapitalRoundInstrument[] = [
  "SAFE",
  "EQUITY",
  "CONVERTIBLE",
  "ASA",
  "OTHER",
];

export type RoundDraft = {
  readonly name: string;
  readonly target: MoneyValue;
  readonly instrument: CapitalRoundInstrument;
};

function newKey(): string {
  return `round:${crypto.randomUUID()}`;
}

/**
 * Add a round, in place (2026-10-04; P8 2026-10-06): name, target,
 * instrument; "Open now" makes it the current round, "Plan it" keeps it for
 * later, "Record a past round" adds one raised before Capital Q to the
 * history (never current). Terms are optional and stay unknown when empty.
 * Prefilled from the raise when there is one. One key per form, so a double
 * press or a retry adds it once.
 */
export function OpenRound({
  draft,
  prominent = false,
  leads = [],
  rounds = [],
}: {
  readonly draft: RoundDraft;
  readonly prominent?: boolean;
  readonly leads?: readonly LeadOption[];
  readonly rounds?: readonly RoundOption[];
}) {
  const [open, setOpen] = useState<"NEW" | "PAST" | null>(null);
  if (open === null) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button
          variant={prominent ? "primary" : "secondary"}
          onClick={() => setOpen("NEW")}
        >
          Add a round
        </Button>
        <Button variant="quiet" onClick={() => setOpen("PAST")}>
          Record a past round
        </Button>
      </div>
    );
  }
  return (
    <RoundForm
      draft={open === "PAST" ? { ...draft, name: "" } : draft}
      past={open === "PAST"}
      leads={leads}
      rounds={rounds}
      onDone={() => setOpen(null)}
    />
  );
}

function RoundForm({
  draft,
  past,
  leads,
  rounds,
  onDone,
}: {
  readonly draft: RoundDraft;
  readonly past: boolean;
  readonly leads: readonly LeadOption[];
  readonly rounds: readonly RoundOption[];
  readonly onDone: () => void;
}) {
  const id = useId();
  const router = useRouter();
  const [name, setName] = useState(draft.name);
  const [target, setTarget] = useState<MoneyValue>(draft.target);
  const [instrument, setInstrument] = useState(draft.instrument);
  const [openedOn, setOpenedOn] = useState("");
  const [closedOn, setClosedOn] = useState("");
  const [terms, setTerms] = useState(EMPTY_DRAFT);
  const [showTerms, setShowTerms] = useState(past);
  const [key] = useState(newKey);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (status: NonNullable<OpenCapitalRoundRequest["status"]>) =>
    start(async () => {
      const said = termsFromDraft(terms, {
        target: target.amount,
        currency: target.currency,
      });
      if (!said.ok) {
        setMessage(said.message);
        return;
      }
      if (past && closedOn !== "" && openedOn !== "" && closedOn < openedOn) {
        setMessage("The close date is before the opening date.");
        return;
      }
      // Only the terms that were said; empty ones stay unknown.
      const given = saidTerms(said.terms);
      const result = await openRoundAction(
        {
          name: name.trim(),
          target: { amount: target.amount, currency: target.currency },
          instrument,
          status,
          ...(openedOn === "" ? {} : { openedOn }),
          ...(status === "CLOSED" && closedOn !== "" ? { closedOn } : {}),
          ...(Object.keys(given).length === 0 ? {} : { terms: given }),
        },
        `${key}:${status}`,
      );
      if (result.ok) {
        onDone();
        router.refresh();
      } else {
        setMessage(result.message);
      }
    });

  const incomplete = name.trim() === "" || target.amount === "";
  const title = past ? "Record a past round" : "Add a round";
  return (
    <form
      className="flex w-full max-w-(--cq-layout-narrow) flex-col gap-4 rounded-2xl border border-(--cq-border) bg-(--cq-surface-raised) p-5 sm:p-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit(past ? "CLOSED" : "OPEN");
      }}
      aria-label={title}
    >
      <h3 className="cq-title-sm text-(--cq-text-primary)">{title}</h3>
      {past ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          A round you raised before Capital Q. It goes into your history and
          never becomes your current round.
        </p>
      ) : null}
      <Input
        id={`${id}-name`}
        label="Name"
        placeholder={past ? "Pre-seed" : "Seed"}
        value={name}
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
      />
      <MoneyInput
        id={`${id}-target`}
        label="Target"
        value={target}
        currencies={CURRENCIES}
        onChange={setTarget}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="cq-label mb-2 text-(--cq-text-primary)">
          Instrument
        </legend>
        <div className="flex flex-wrap gap-2">
          {INSTRUMENTS.map((value) => (
            <label
              key={value}
              className="cq-body-sm inline-flex min-h-11 cursor-pointer items-center rounded-full border border-(--cq-border) px-4 text-(--cq-text-primary) has-checked:border-transparent has-checked:bg-(--cq-accent-soft) has-focus-visible:outline-2 has-focus-visible:outline-(--cq-focus-ring)"
            >
              <input
                type="radio"
                name={`${id}-instrument`}
                value={value}
                checked={instrument === value}
                onChange={() => setInstrument(value)}
                className="sr-only"
              />
              {INSTRUMENT_LABELS[value]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id={`${id}-opened`}
          type="date"
          label={past ? "Opened" : "Opened (default: today)"}
          value={openedOn}
          onChange={(event) => setOpenedOn(event.target.value)}
        />
        {past ? (
          <Input
            id={`${id}-closed`}
            type="date"
            label="Closed"
            value={closedOn}
            onChange={(event) => setClosedOn(event.target.value)}
          />
        ) : null}
      </div>
      {showTerms ? (
        <RoundTermsFields
          id={`${id}-terms`}
          draft={terms}
          onChange={setTerms}
          currency={target.currency}
          leads={leads}
          rounds={rounds}
          past={past}
        />
      ) : (
        <div>
          <Button
            variant="quiet"
            size="compact"
            onClick={() => setShowTerms(true)}
          >
            Add terms (cap, discount, valuation, lead…)
          </Button>
        </div>
      )}
      {message === null ? null : (
        <p className="cq-body-sm text-(--cq-danger)" role="alert">
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {past ? (
          <Button
            type="submit"
            variant="primary"
            disabled={pending || incomplete}
          >
            Add to history
          </Button>
        ) : (
          <>
            <Button
              type="submit"
              variant="primary"
              disabled={pending || incomplete}
            >
              Open now
            </Button>
            <Button
              variant="secondary"
              disabled={pending || incomplete}
              onClick={() => submit("PLANNED")}
            >
              Plan it
            </Button>
          </>
        )}
        <Button variant="quiet" disabled={pending} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
