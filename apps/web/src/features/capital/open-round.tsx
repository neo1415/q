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

import { closeRoundAction, openRoundAction } from "./capital-actions";

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

const INSTRUMENTS: readonly {
  readonly value: CapitalRoundInstrument;
  readonly label: string;
}[] = [
  { value: "SAFE", label: "SAFE" },
  { value: "EQUITY", label: "Equity" },
  { value: "CONVERTIBLE", label: "Convertible" },
  { value: "OTHER", label: "Other" },
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
 * Open a round, in place (2026-10-04): name, target, instrument; "Open now"
 * makes it the current round, "Plan it" keeps it for later. Prefilled from
 * the raise when there is one. One key per form, so a double press or a
 * retry opens it once.
 */
export function OpenRound({
  draft,
  prominent = false,
}: {
  readonly draft: RoundDraft;
  readonly prominent?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button
        variant={prominent ? "primary" : "secondary"}
        onClick={() => setOpen(true)}
      >
        Open a round
      </Button>
    );
  }
  return <RoundForm draft={draft} onDone={() => setOpen(false)} />;
}

function RoundForm({
  draft,
  onDone,
}: {
  readonly draft: RoundDraft;
  readonly onDone: () => void;
}) {
  const id = useId();
  const router = useRouter();
  const [name, setName] = useState(draft.name);
  const [target, setTarget] = useState<MoneyValue>(draft.target);
  const [instrument, setInstrument] = useState(draft.instrument);
  const [key] = useState(newKey);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (status: OpenCapitalRoundRequest["status"]) =>
    start(async () => {
      const result = await openRoundAction(
        {
          name: name.trim(),
          target: { amount: target.amount, currency: target.currency },
          instrument,
          ...(status === undefined ? {} : { status }),
        },
        `${key}:${status ?? "OPEN"}`,
      );
      if (result.ok) {
        onDone();
        router.refresh();
      } else {
        setMessage(result.message);
      }
    });

  return (
    <form
      className="flex w-full max-w-(--cq-layout-narrow) flex-col gap-4 rounded-2xl border border-(--cq-border) bg-(--cq-surface-raised) p-5 sm:p-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit(undefined);
      }}
      aria-label="Open a round"
    >
      <h3 className="cq-title-sm text-(--cq-text-primary)">Open a round</h3>
      <Input
        id={`${id}-name`}
        label="Name"
        placeholder="Seed"
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
          {INSTRUMENTS.map((option) => (
            <label
              key={option.value}
              className="cq-body-sm inline-flex min-h-11 cursor-pointer items-center rounded-full border border-(--cq-border) px-4 text-(--cq-text-primary) has-checked:border-transparent has-checked:bg-(--cq-accent-soft) has-focus-visible:outline-2 has-focus-visible:outline-(--cq-focus-ring)"
            >
              <input
                type="radio"
                name={`${id}-instrument`}
                value={option.value}
                checked={instrument === option.value}
                onChange={() => setInstrument(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
      {message === null ? null : (
        <p className="cq-body-sm text-(--cq-danger)" role="alert">
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="primary"
          disabled={pending || name.trim() === "" || target.amount === ""}
        >
          Open now
        </Button>
        <Button
          variant="secondary"
          disabled={pending || name.trim() === "" || target.amount === ""}
          onClick={() => submit("PLANNED")}
        >
          Plan it
        </Button>
        <Button variant="quiet" disabled={pending} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Close a round, after one explicit second press. */
export function CloseRoundButton({
  roundId,
  name,
}: {
  readonly roundId: string;
  readonly name: string;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!asking) {
    return (
      <Button variant="quiet" size="compact" onClick={() => setAsking(true)}>
        Close round
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="cq-body-sm text-(--cq-text-secondary)">
        {message ?? `Close ${name}?`}
      </span>
      <Button
        variant="secondary"
        size="compact"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await closeRoundAction(roundId);
            if (result.ok) router.refresh();
            else setMessage(result.message);
          })
        }
      >
        Close {name}
      </Button>
      <Button
        variant="quiet"
        size="compact"
        disabled={pending}
        onClick={() => setAsking(false)}
      >
        Keep open
      </Button>
    </div>
  );
}
