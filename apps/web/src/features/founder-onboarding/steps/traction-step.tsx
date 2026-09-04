"use client";

import { useState, type FormEvent } from "react";

import { ChoiceList } from "@capital-q/ui/choice-list";
import { Input } from "@capital-q/ui/input";

import type { MetricQuestion, StepResponse } from "../models/presentation";
import { StepHeading, type StepProps } from "./step-props";

type MetricAnswer = { readonly value: string } | { readonly unknown: true };

type TractionMetrics = Extract<StepResponse, { kind: "traction" }>["metrics"];

/**
 * F5. Renders whatever metric questions the definition supplies -- the
 * pre-revenue and revenue variants differ entirely, and this component does
 * not know which it is showing. "Not sure" is an explicit answer, never 0.
 */
export function TractionStep({
  step,
  formId,
  busy,
  actions,
}: StepProps<"traction">) {
  const [answers, setAnswers] = useState<Record<string, MetricAnswer>>(() => ({
    ...(step.response?.metrics ?? {}),
  }));
  const [error, setError] = useState<string | undefined>(undefined);

  function set(id: string, answer: MetricAnswer | undefined) {
    setAnswers((current) => {
      const next = { ...current };
      if (answer === undefined) {
        delete next[id];
      } else {
        next[id] = answer;
      }
      return next;
    });
    setError(undefined);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const missing = step.metrics.find(
      (metric) => !metric.optional && answers[metric.id] === undefined,
    );
    if (missing !== undefined) {
      setError(`Answer “${missing.label}” to continue.`);
      return;
    }
    const metrics: TractionMetrics = {};
    for (const [id, answer] of Object.entries(answers)) {
      if ("value" in answer) {
        if (answer.value.length > 0) {
          metrics[id] = { value: answer.value };
        }
      } else {
        metrics[id] = { unknown: true };
      }
    }
    void actions.submit({ kind: "traction", metrics });
  }

  return (
    <form
      id={formId}
      onSubmit={handleSubmit}
      className="flex flex-col gap-7"
      data-traction-variant={step.variant}
    >
      <StepHeading title={step.title} prompt={step.prompt} help={step.intro} />
      {step.metrics.map((metric) => (
        <MetricField
          key={metric.id}
          metric={metric}
          answer={answers[metric.id]}
          busy={busy}
          onChange={(answer) => set(metric.id, answer)}
        />
      ))}
      {error !== undefined ? (
        <p role="alert" className="cq-caption text-(--cq-danger)">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function MetricField({
  metric,
  answer,
  busy,
  onChange,
}: {
  readonly metric: MetricQuestion;
  readonly answer: MetricAnswer | undefined;
  readonly busy: boolean;
  readonly onChange: (answer: MetricAnswer | undefined) => void;
}) {
  const unknown = answer !== undefined && "unknown" in answer;
  const unknownToggle = metric.optional ? (
    <label className="flex min-h-11 items-center gap-2 cq-body-sm text-(--cq-text-secondary)">
      <input
        type="checkbox"
        checked={unknown}
        disabled={busy}
        onChange={(event) =>
          onChange(event.target.checked ? { unknown: true } : undefined)
        }
        className="size-4 accent-(--cq-accent)"
      />
      Not sure / not tracked
    </label>
  ) : null;

  if (metric.kind === "choice") {
    return (
      <div className="flex flex-col gap-2">
        <ChoiceList
          id={`metric-${metric.id}`}
          name={metric.id}
          legend={metric.label}
          description={metric.help}
          options={metric.options ?? []}
          value={
            answer !== undefined && "value" in answer ? answer.value : undefined
          }
          disabled={busy || unknown}
          onChange={(value) => onChange({ value })}
        />
        {unknownToggle}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        id={`metric-${metric.id}`}
        label={metric.label}
        description={metric.help}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={answer !== undefined && "value" in answer ? answer.value : ""}
        disabled={busy || unknown}
        onChange={(event) =>
          onChange({ value: event.target.value.replace(/[^0-9]/g, "") })
        }
      />
      {unknownToggle}
    </div>
  );
}
