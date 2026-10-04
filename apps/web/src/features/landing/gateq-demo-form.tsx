"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";

import { buttonClassName, cx } from "@capital-q/ui";
import type { QualificationResult } from "@capital-q/gateq/engine";

import {
  COUNTRY_OPTIONS,
  CURRENCY_OPTIONS,
  DEMO_INVESTOR_LABEL,
  DEMO_INVESTOR_NAME,
  DEMO_PUBLIC_GATEWAY,
  EMPTY_ANSWERS,
  OUTCOME_COPY,
  REASON_COPY,
  SECTOR_OPTIONS,
  STAGE_OPTIONS,
  STATUS_WORDS,
  normaliseAmount,
  runDemo,
  type DemoAnswers,
} from "./gateq-demo";
import { GATEQ, SIGN_UP_HREF } from "./landing-copy";

/**
 * "Try GateQ: am I a fit?" The visitor's answers stay in this component's
 * state; `runDemo` is the real GateQ engine, run here, synchronously. No
 * request is made, nothing is stored, and no model is called.
 */

const STATUS_MARK = { MATCH: "✓", NO_MATCH: "×", UNKNOWN: "?" } as const;

function Choice({
  label,
  value,
  onChange,
  options,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="cq-label text-(--cq-text-primary)">
        {label}
      </label>
      <select
        id={id}
        className="cq-landing-field"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Prefer not to say</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function GateQDemoForm() {
  const [answers, setAnswers] = useState<DemoAnswers>(EMPTY_ANSWERS);
  const [result, setResult] = useState<QualificationResult | null>(null);
  const [amountError, setAmountError] = useState(false);
  const amountId = useId();
  const currencyId = useId();
  const errorId = useId();

  const set = (key: keyof DemoAnswers) => (value: string) =>
    setAnswers((a) => ({ ...a, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const invalid =
      answers.amount.trim().length > 0 &&
      normaliseAmount(answers.amount) === null;
    setAmountError(invalid);
    if (invalid) return;
    setResult(runDemo(answers));
  };

  return (
    <div className="cq-landing-gateq-grid">
      <div>
        <p className="cq-caption text-(--cq-text-secondary)">
          {DEMO_INVESTOR_LABEL}
        </p>
        <h3 className="cq-title-md mt-1 text-(--cq-text-primary)">
          {DEMO_INVESTOR_NAME}
        </h3>
        {DEMO_PUBLIC_GATEWAY !== null ? (
          <>
            <p className="cq-body-sm mt-1 text-(--cq-text-secondary)">
              {DEMO_PUBLIC_GATEWAY.description}
            </p>
            <p className="cq-label mt-4 text-(--cq-text-primary)">
              What they publish
            </p>
            <ul className="mt-2 flex flex-col">
              {DEMO_PUBLIC_GATEWAY.criteria.map((criterion) => (
                <li
                  key={criterion.label}
                  className="cq-body-sm flex justify-between gap-4 border-b border-(--cq-border-subtle) py-2 text-(--cq-text-primary)"
                >
                  <span>{criterion.label}</span>
                  <span className="text-(--cq-text-secondary)">
                    {criterion.requiredness === "REQUIRED"
                      ? "Required"
                      : "Preferred"}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>

      <div>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {GATEQ.unknownNote}
          </p>
          <Choice
            label="Stage"
            value={answers.stage}
            onChange={set("stage")}
            options={STAGE_OPTIONS}
          />
          <Choice
            label="Sector"
            value={answers.sector}
            onChange={set("sector")}
            options={SECTOR_OPTIONS}
          />
          <Choice
            label="Headquarters"
            value={answers.country}
            onChange={set("country")}
            options={COUNTRY_OPTIONS}
          />
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={amountId}
              className="cq-label text-(--cq-text-primary)"
            >
              Round size
            </label>
            <div className="flex gap-2">
              <input
                id={amountId}
                className="cq-landing-field min-w-0 flex-1"
                inputMode="decimal"
                autoComplete="off"
                placeholder="e.g. 1,200,000"
                value={answers.amount}
                onChange={(event) => set("amount")(event.target.value)}
                aria-invalid={amountError || undefined}
                aria-describedby={amountError ? errorId : undefined}
              />
              <label htmlFor={currencyId} className="sr-only">
                Currency
              </label>
              <select
                id={currencyId}
                className="cq-landing-field w-24"
                value={answers.currency}
                onChange={(event) => set("currency")(event.target.value)}
              >
                {CURRENCY_OPTIONS.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </div>
            {amountError ? (
              <p id={errorId} className="cq-caption text-(--cq-danger)">
                Use digits only, for example 1200000. Or leave it blank.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              className={buttonClassName("primary", "regular")}
            >
              {GATEQ.submit}
            </button>
            {result !== null ? (
              <button
                type="button"
                className={buttonClassName("quiet", "regular")}
                onClick={() => {
                  setAnswers(EMPTY_ANSWERS);
                  setResult(null);
                  setAmountError(false);
                }}
              >
                {GATEQ.reset}
              </button>
            ) : null}
          </div>
          <p className="cq-caption text-(--cq-text-tertiary)">
            {GATEQ.privacy}
          </p>
        </form>

        <div aria-live="polite">
          {result !== null ? <DemoResult result={result} /> : null}
        </div>
      </div>
    </div>
  );
}

export function DemoResult({
  result,
}: {
  readonly result: QualificationResult;
}) {
  const outcome = OUTCOME_COPY[result.outcome];
  return (
    <div className="cq-landing-result" data-outcome={result.outcome}>
      <h4 className="cq-title-sm text-(--cq-text-primary)">{outcome.title}</h4>
      <p className="cq-body-sm mt-1 text-(--cq-text-secondary)">
        {outcome.body}
      </p>
      <ul className="mt-4 flex flex-col">
        {result.criteria.map((criterion) => (
          <li
            key={criterion.criterionId}
            className="flex gap-3 border-b border-(--cq-border-subtle) py-3"
            data-status={criterion.status}
          >
            <span
              aria-hidden="true"
              className={cx(
                "cq-landing-status-mark",
                `is-${criterion.status.toLowerCase().replace("_", "-")}`,
              )}
            >
              {STATUS_MARK[criterion.status]}
            </span>
            <div className="min-w-0">
              <p className="cq-body-sm text-(--cq-text-primary)">
                <span className="font-medium">{criterion.label}</span>
                <span className="text-(--cq-text-secondary)">
                  {" · "}
                  {STATUS_WORDS[criterion.status]}
                  {criterion.requiredness === "PREFERRED" ? " · preferred" : ""}
                </span>
              </p>
              <p className="cq-caption mt-0.5 text-(--cq-text-secondary)">
                {REASON_COPY[criterion.reasonCode]}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <Link
          href={SIGN_UP_HREF}
          className={buttonClassName("primary", "regular")}
        >
          {GATEQ.cta}
        </Link>
        <p className="cq-caption text-(--cq-text-secondary)">{GATEQ.ctaNote}</p>
      </div>
    </div>
  );
}
