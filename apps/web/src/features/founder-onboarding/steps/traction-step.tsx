"use client";

import { useState, type FormEvent } from "react";

import { ChoiceList } from "@capital-q/ui/choice-list";
import { Input } from "@capital-q/ui/input";

import type { MetricQuestion, StepResponse } from "../models/presentation";
import { StepHeading, type StepProps } from "./step-props";
import { FieldProblem } from "@/features/onboarding-kit/components/field-problem";
import { useT } from "@/features/i18n/language";

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
  // The one unanswered required metric, named beside its own field (live
  // typed run 2026-10-28, D3): a message at the foot of fourteen questions
  // sat under the sticky Continue bar, and the button looked dead.
  const [missing, setMissing] = useState<
    { readonly id: string; readonly message: string } | undefined
  >(undefined);
  // The questions on screen when Continue was pressed. An answer can open
  // a follow-up (paying customers after "Paying customers"); the screen
  // then stays, and says why, instead of looking as if nothing happened
  // (sweep D3, 2026-10-29).
  const [submittedIds, setSubmittedIds] = useState<readonly string[] | null>(
    null,
  );
  const opened =
    submittedIds === null
      ? []
      : step.metrics.filter((metric) => !submittedIds.includes(metric.id));

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
    setMissing(undefined);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const unanswered = step.metrics.find(
      (metric) => !metric.optional && answers[metric.id] === undefined,
    );
    if (unanswered !== undefined) {
      setMissing({
        id: unanswered.id,
        message: `Answer “${unanswered.label}” to continue.`,
      });
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
    setSubmittedIds(step.metrics.map((metric) => metric.id));
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
      {opened.length === 0 ? null : (
        <p
          role="status"
          className="cq-body-sm text-(--cq-text-primary)"
          data-traction-opened
        >
          {openedLine(opened.map((metric) => metric.label))}
        </p>
      )}
      {step.metrics.map((metric) => (
        <MetricField
          key={metric.id}
          metric={metric}
          answer={answers[metric.id]}
          busy={busy}
          problem={missing?.id === metric.id ? missing.message : undefined}
          onChange={(answer) => set(metric.id, answer)}
        />
      ))}
    </form>
  );
}

function MetricField({
  metric,
  answer,
  busy,
  problem,
  onChange,
}: {
  readonly metric: MetricQuestion;
  readonly answer: MetricAnswer | undefined;
  readonly busy: boolean;
  /** Why Continue did not move on, when it is this field. */
  readonly problem: string | undefined;
  readonly onChange: (answer: MetricAnswer | undefined) => void;
}) {
  const t = useT();
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
      {t("Not sure / not tracked")}
    </label>
  ) : null;

  if (metric.kind === "choice") {
    return (
      <div
        className="flex flex-col gap-2"
        data-metric={metric.id}
        data-metric-problem={problem === undefined ? undefined : ""}
      >
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
        {problem === undefined ? null : (
          <FieldProblem id={`metric-${metric.id}-problem`}>
            {problem}
          </FieldProblem>
        )}
        {unknownToggle}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-2"
      data-metric={metric.id}
      data-metric-problem={problem === undefined ? undefined : ""}
    >
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
      {problem === undefined ? null : (
        <FieldProblem id={`metric-${metric.id}-problem`}>
          {problem}
        </FieldProblem>
      )}
      {unknownToggle}
    </div>
  );
}

/** Why the screen stayed after Continue: what their answer opened. */
export function openedLine(labels: readonly string[]): string {
  const named = labels.map((label) => `“${label}”`).join(", ");
  return labels.length === 1
    ? `Your answer opened one more question: ${named}. Answer it, or leave it blank, and press Continue.`
    : `Your answers opened ${String(labels.length)} more questions: ${named}. Answer them, or leave them blank, and press Continue.`;
}
