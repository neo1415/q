"use client";

import { useState, type FormEvent } from "react";

import { NarrativeInput } from "@capital-q/ui/narrative-input";
import { InlineNotice } from "@capital-q/ui/states";

import { StepHeading, type StepProps } from "./step-props";

/**
 * Short, optional narrative. Skipping is an explicit state ("Skipped for
 * now"), never an empty string pretending to be an answer.
 */
export function NarrativeStep({
  step,
  formId,
  busy,
  actions,
}: StepProps<"narrative">) {
  const [text, setText] = useState(step.response?.text ?? "");
  const [error, setError] = useState<string | undefined>(undefined);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      if (step.optional) {
        void actions.skip();
        return;
      }
      setError("A sentence or two is enough.");
      return;
    }
    void actions.submit({ kind: "narrative", text: trimmed });
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-6">
      <StepHeading title={step.title} prompt={step.prompt} help={step.help} />
      {step.skipped && text.length === 0 ? (
        <InlineNotice tone="info">
          Skipped for now. You can add this later.
        </InlineNotice>
      ) : null}
      <NarrativeInput
        id={`${step.id}-text`}
        label={step.prompt ?? step.title}
        labelHidden
        placeholder={step.placeholder}
        value={text}
        maxLength={step.maxLength}
        voiceEnabled={step.voiceEnabled}
        disabled={busy}
        error={error}
        onChange={(next) => {
          setText(next);
          setError(undefined);
        }}
      />
    </form>
  );
}
