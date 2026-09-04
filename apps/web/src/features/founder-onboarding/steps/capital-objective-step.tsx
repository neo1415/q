"use client";

import { useState, type FormEvent } from "react";

import { ChoiceList, MultiChoiceList } from "@capital-q/ui/choice-list";
import { MoneyInput, type MoneyValue } from "@capital-q/ui/money-input";
import { InlineNotice } from "@capital-q/ui/states";

import { StepHeading, type StepProps } from "./step-props";

const RAISING = new Set(["active", "preparing"]);

/**
 * F6. The raise as its own object, separate from the company profile. It
 * starts with one decision; the rest appears only when a raise is in play.
 * Saving creates the company's capital objective or recalibrates the
 * existing one -- never a second. Amounts stay exact strings all the way.
 */
export function CapitalObjectiveStep({
  step,
  formId,
  busy,
  actions,
}: StepProps<"capital_objective">) {
  const saved = step.response;
  const [raisingStatus, setRaisingStatus] = useState<string | undefined>(
    saved?.raisingStatus,
  );
  const [amount, setAmount] = useState<MoneyValue>(
    saved?.targetAmount ?? {
      amount: "",
      currency: step.currencies[0]?.code ?? "USD",
    },
  );
  const [instrument, setInstrument] = useState<string | undefined>(
    saved?.instrument,
  );
  const [timeframe, setTimeframe] = useState<string | undefined>(
    saved?.timeframe,
  );
  const [useOfFunds, setUseOfFunds] = useState<readonly string[]>(
    saved?.useOfFunds ?? [],
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const [amountError, setAmountError] = useState<string | undefined>(undefined);

  const raising = raisingStatus !== undefined && RAISING.has(raisingStatus);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (raisingStatus === undefined) {
      setError("Choose one to continue.");
      return;
    }
    if (!raising) {
      void actions.submit({ kind: "capital_objective", raisingStatus });
      return;
    }
    if (amount.amount.length === 0 || !/[1-9]/.test(amount.amount)) {
      setAmountError("Enter the target amount to save the raise.");
      return;
    }
    void actions.submit({
      kind: "capital_objective",
      raisingStatus,
      targetAmount: amount,
      ...(instrument !== undefined ? { instrument } : {}),
      ...(timeframe !== undefined ? { timeframe } : {}),
      ...(useOfFunds.length > 0 ? { useOfFunds: [...useOfFunds] } : {}),
    });
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-7">
      <StepHeading
        title={step.title}
        prompt="Are you raising now?"
        help={step.help}
      />
      <ChoiceList
        id="raise-status"
        name="raisingStatus"
        legend="Are you raising now?"
        legendHidden
        options={step.raisingOptions}
        value={raisingStatus}
        error={error}
        disabled={busy}
        onChange={(next) => {
          setRaisingStatus(next);
          setError(undefined);
        }}
      />

      {raising ? (
        <>
          {step.existingObjective !== undefined ? (
            <InlineNotice tone="info" title="Recalibrating your raise">
              Your current objective is {step.existingObjective.currency}{" "}
              {step.existingObjective.amount}. Saving updates it; it never
              creates a second one.
            </InlineNotice>
          ) : null}
          <MoneyInput
            id="raise-amount"
            label="Target amount"
            description="An exact figure. A range is fine; enter the midpoint."
            value={amount}
            currencies={step.currencies}
            disabled={busy}
            error={amountError}
            onChange={(next) => {
              setAmount(next);
              setAmountError(undefined);
            }}
          />
          <ChoiceList
            id="raise-instrument"
            name="instrument"
            legend="Instrument"
            description="Optional."
            options={step.instrumentOptions}
            value={instrument}
            disabled={busy}
            onChange={setInstrument}
          />
          <ChoiceList
            id="raise-timeframe"
            name="timeframe"
            legend="Target close"
            description="Optional."
            options={step.timeframeOptions}
            value={timeframe}
            disabled={busy}
            onChange={setTimeframe}
          />
          <MultiChoiceList
            id="raise-use"
            name="useOfFunds"
            legend="Main use of funds"
            description="Optional. Choose any that apply."
            options={step.useOfFundsOptions}
            values={useOfFunds}
            disabled={busy}
            onChange={setUseOfFunds}
          />
        </>
      ) : null}
    </form>
  );
}
