"use client";

import { useState, type FormEvent } from "react";

import { MultiChoiceList } from "@capital-q/ui/choice-list";
import { ContextIndicator } from "@capital-q/ui/context-indicator";

import { StepHeading, type StepProps } from "./step-props";

/**
 * F2. A declaration of what exists, nothing more: no file picker, no
 * upload, no evidence. "Nothing yet" is exclusive and a perfectly good
 * answer.
 */
export function MultiChoiceStep({
  step,
  formId,
  busy,
  actions,
}: StepProps<"multi_choice">) {
  const [values, setValues] = useState<readonly string[]>(
    step.response?.values ?? [],
  );
  const [error, setError] = useState<string | undefined>(undefined);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (values.length === 0) {
      if (step.optional) {
        void actions.skip();
        return;
      }
      setError("Choose at least one to continue.");
      return;
    }
    void actions.submit({ kind: "multi_choice", values: [...values] });
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-6">
      <StepHeading title={step.title} prompt={step.prompt} help={step.help} />
      <MultiChoiceList
        id={`${step.id}-choices`}
        name={step.id}
        legend={step.title}
        legendHidden
        options={step.options}
        values={values}
        exclusiveValues={step.exclusiveValues}
        error={error}
        disabled={busy}
        onChange={(next) => {
          setValues(next);
          setError(undefined);
        }}
      />
      <ContextIndicator
        scope="organisation_private"
        detail="Your files stay private to your company. Uploading arrives in a later release; nothing is collected here."
      />
    </form>
  );
}
