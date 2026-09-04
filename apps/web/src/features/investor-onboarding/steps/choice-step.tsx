"use client";

import { useState, type FormEvent } from "react";

import { ChoiceList } from "@capital-q/ui/choice-list";

import { StepHeading, type StepProps } from "./step-props";

/** One tap selects; Continue confirms. Nothing advances on the tap itself. */
export function ChoiceStep({
  step,
  formId,
  busy,
  actions,
}: StepProps<"choice">) {
  const [value, setValue] = useState<string | undefined>(step.response?.value);
  const [error, setError] = useState<string | undefined>(undefined);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (value === undefined) {
      setError("Choose one to continue.");
      return;
    }
    void actions.submit({ kind: "choice", value });
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-6">
      <StepHeading title={step.title} prompt={step.prompt} help={step.help} />
      <ChoiceList
        id={`${step.id}-choice`}
        name={step.id}
        legend={step.title}
        legendHidden
        options={step.options}
        value={value}
        error={error}
        disabled={busy}
        onChange={(next) => {
          setValue(next);
          setError(undefined);
        }}
      />
    </form>
  );
}
