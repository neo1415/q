"use client";

import { useState, type FormEvent } from "react";

import { ChoiceList } from "@capital-q/ui/choice-list";
import { InlineNotice } from "@capital-q/ui/states";

import { StepHeading, type StepProps } from "./step-props";

/**
 * I1 mandate context. Most investors see one draft, preselected. With
 * several open mandates nothing is picked for them: the choice is explicit.
 */
export function MandateSelectStep({
  step,
  formId,
  busy,
  actions,
}: StepProps<"mandate_select">) {
  const [mandateId, setMandateId] = useState<string | undefined>(
    step.response?.mandateId ?? step.suggestedMandateId ?? undefined,
  );
  const [error, setError] = useState<string | undefined>(undefined);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mandateId === undefined) {
      setError("Choose the mandate to define.");
      return;
    }
    void actions.submit({ kind: "mandate_select", mandateId });
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-6">
      <StepHeading title={step.title} prompt={step.prompt} help={step.help} />
      {step.candidates.length === 0 ? (
        <InlineNotice tone="info">
          No mandate is available yet. Go back one step so a draft can be
          created.
        </InlineNotice>
      ) : (
        <ChoiceList
          id="mandate-context"
          name="mandateId"
          legend="Mandates"
          legendHidden
          options={step.candidates.map((candidate) => ({
            value: candidate.mandateId,
            label: candidate.name,
            description:
              candidate.status === "DRAFT"
                ? "Draft — not active yet"
                : "Active — changes recalibrate it",
          }))}
          value={mandateId}
          error={error}
          disabled={busy}
          onChange={(next) => {
            setMandateId(next);
            setError(undefined);
          }}
        />
      )}
    </form>
  );
}
