"use client";

import { useState, type FormEvent } from "react";

import { ChoiceList } from "@capital-q/ui/choice-list";
import { NarrativeInput } from "@capital-q/ui/narrative-input";
import { ClarificationPrompt } from "@capital-q/ui/q-clarification";

import { type StepProps } from "./step-props";

/** F7. One material clarification; choose, type, or skip when allowed. */
export function ClarificationStep({
  step,
  formId,
  busy,
  actions,
}: StepProps<"clarification">) {
  const [choice, setChoice] = useState<string | undefined>(
    step.response?.choice,
  );
  const [text, setText] = useState(step.response?.text ?? "");
  const [error, setError] = useState<string | undefined>(undefined);
  const needsText = step.options.length === 0 || choice === "other";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = text.trim();
    if (step.options.length > 0 && choice === undefined) {
      setError("Choose one, or skip for now.");
      return;
    }
    if (needsText && trimmed.length === 0) {
      if (step.optional) {
        void actions.skip();
        return;
      }
      setError("Add a short answer to continue.");
      return;
    }
    void actions.submit({
      kind: "clarification",
      ...(choice !== undefined ? { choice } : {}),
      ...(trimmed.length > 0 ? { text: trimmed } : {}),
    });
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-6">
      <h1 className="sr-only">{step.title}</h1>
      <ClarificationPrompt
        observation={step.observation}
        question={step.question}
        why={step.why}
      >
        <div className="flex flex-col gap-5">
          {step.options.length > 0 ? (
            <ChoiceList
              id="clarification-choice"
              name="clarification"
              legend={step.question}
              legendHidden
              options={step.options}
              value={choice}
              error={error}
              disabled={busy}
              onChange={(next) => {
                setChoice(next);
                setError(undefined);
              }}
            />
          ) : null}
          {step.allowText && needsText ? (
            <NarrativeInput
              id="clarification-text"
              label={
                step.options.length > 0
                  ? "Tell Q the current figure"
                  : step.question
              }
              labelHidden={step.options.length === 0}
              placeholder={
                step.options.length > 0
                  ? "For example: 38 paying customers as of this month"
                  : undefined
              }
              value={text}
              maxLength={600}
              disabled={busy}
              error={step.options.length === 0 ? error : undefined}
              onChange={(next) => {
                setText(next);
                setError(undefined);
              }}
            />
          ) : null}
        </div>
      </ClarificationPrompt>
    </form>
  );
}
