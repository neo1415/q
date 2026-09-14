"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { ChoiceList } from "@capital-q/ui/choice-list";
import { InlineNotice } from "@capital-q/ui/states";

import { StepHeading, type StepProps } from "./step-props";

/**
 * I1 mandate context. Most investors have exactly one open mandate: it is
 * selected and submitted for them, once, with a line saying so (§38). With
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
  const only =
    step.candidates.length === 1 && step.response === undefined
      ? step.candidates[0]
      : undefined;
  const autoSubmittedRef = useRef(false);
  const { submit } = actions;
  useEffect(() => {
    if (only === undefined || busy || autoSubmittedRef.current) {
      return;
    }
    const timer = setTimeout(() => {
      autoSubmittedRef.current = true;
      void submit({ kind: "mandate_select", mandateId: only.mandateId });
    }, 0);
    return () => clearTimeout(timer);
  }, [only, busy, submit]);

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
      ) : only !== undefined ? (
        <InlineNotice tone="info">
          You have one mandate, {only.name}. That&apos;s the one we&apos;ll
          define.
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
