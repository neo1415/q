"use client";

import { useState, type FormEvent } from "react";

import { MultiChoiceList } from "@capital-q/ui/choice-list";
import { MoneyInput, type MoneyValue } from "@capital-q/ui/money-input";

import { StepHeading, type StepProps } from "./step-props";

function greater(a: string, b: string): boolean {
  // Exact decimal comparison on strings: no floats.
  const [ai, af = ""] = a.split(".");
  const [bi, bf = ""] = b.split(".");
  const ii = (ai ?? "").replace(/^0+(?=\d)/, "");
  const bb = (bi ?? "").replace(/^0+(?=\d)/, "");
  if (ii.length !== bb.length) return ii.length > bb.length;
  if (ii !== bb) return ii > bb;
  const width = Math.max(af.length, bf.length);
  return af.padEnd(width, "0") > bf.padEnd(width, "0");
}

/**
 * I2. Stages, one currency, three exact-string cheques (all optional) and
 * how the investor takes part. Ordering is checked exactly, never with
 * floating point; the domain re-checks.
 */
export function StageChequeStep({
  step,
  formId,
  busy,
  actions,
}: StepProps<"stage_cheque">) {
  const saved = step.response;
  const currency = saved?.currency ?? step.currencies[0]?.code ?? "USD";
  const [stages, setStages] = useState<readonly string[]>(saved?.stages ?? []);
  const [min, setMin] = useState<MoneyValue>({
    amount: saved?.min ?? "",
    currency,
  });
  const [typical, setTypical] = useState<MoneyValue>({
    amount: saved?.typical ?? "",
    currency,
  });
  const [max, setMax] = useState<MoneyValue>({
    amount: saved?.max ?? "",
    currency,
  });
  const [roles, setRoles] = useState<readonly string[]>(saved?.roles ?? []);
  const [error, setError] = useState<string | undefined>(undefined);
  const [chequeError, setChequeError] = useState<string | undefined>(undefined);

  function withCurrency(next: MoneyValue) {
    setMin((m) => ({ ...m, currency: next.currency }));
    setTypical((t) => ({ ...t, currency: next.currency }));
    setMax((x) => ({ ...x, currency: next.currency }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stages.length === 0) {
      setError("Choose at least one stage.");
      return;
    }
    const amounts = {
      min: min.amount.length > 0 ? min.amount : undefined,
      typical: typical.amount.length > 0 ? typical.amount : undefined,
      max: max.amount.length > 0 ? max.amount : undefined,
    };
    if (
      (amounts.min !== undefined &&
        amounts.max !== undefined &&
        greater(amounts.min, amounts.max)) ||
      (amounts.typical !== undefined &&
        amounts.min !== undefined &&
        greater(amounts.min, amounts.typical)) ||
      (amounts.typical !== undefined &&
        amounts.max !== undefined &&
        greater(amounts.typical, amounts.max))
    ) {
      setChequeError(
        "Keep the cheques in order: minimum, then typical, then maximum.",
      );
      return;
    }
    void actions.submit({
      kind: "stage_cheque",
      stages: [...stages],
      currency: min.currency,
      ...(amounts.min === undefined ? {} : { min: amounts.min }),
      ...(amounts.typical === undefined ? {} : { typical: amounts.typical }),
      ...(amounts.max === undefined ? {} : { max: amounts.max }),
      roles: [...roles],
    });
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-7">
      <StepHeading title={step.title} prompt={step.prompt} help={step.help} />
      <MultiChoiceList
        id="mandate-stages"
        name="stages"
        legend="Which stages do you invest at?"
        options={step.stageOptions}
        values={stages}
        error={error}
        disabled={busy}
        onChange={(next) => {
          setStages(next);
          setError(undefined);
        }}
      />
      <MoneyInput
        id="cheque-min"
        label="Minimum cheque"
        description="Optional. Exact figures in one currency."
        value={min}
        currencies={step.currencies}
        disabled={busy}
        onChange={(next) => {
          setMin(next);
          withCurrency(next);
          setChequeError(undefined);
        }}
      />
      <MoneyInput
        id="cheque-typical"
        label="Typical cheque"
        description="Optional."
        value={typical}
        currencies={step.currencies}
        disabled={busy}
        onChange={(next) => {
          setTypical(next);
          withCurrency(next);
          setChequeError(undefined);
        }}
      />
      <MoneyInput
        id="cheque-max"
        label="Maximum cheque"
        description="Optional."
        value={max}
        currencies={step.currencies}
        disabled={busy}
        error={chequeError}
        onChange={(next) => {
          setMax(next);
          withCurrency(next);
          setChequeError(undefined);
        }}
      />
      <MultiChoiceList
        id="mandate-roles"
        name="roles"
        legend="How do you usually take part?"
        description="Optional. Choose any that apply."
        options={step.roleOptions}
        values={roles}
        disabled={busy}
        onChange={setRoles}
      />
    </form>
  );
}
