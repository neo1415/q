"use client";

import { type FormEvent } from "react";

import { InlineNotice } from "@capital-q/ui/states";

import { StepHeading, type StepProps } from "./step-props";

/**
 * I12. The truthful handoff. The mandate is real and active; recommendation
 * and inbound qualification are not built yet, and the screen says exactly
 * that. No fake feed, no "matches found", no invented counts.
 */
export function HandoffStep({
  step,
  formId,
  busy: _busy,
  actions,
}: StepProps<"handoff">) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void actions.submit({ kind: "handoff", confirmed: true });
  }

  const handoff = step.handoff;
  const active = handoff?.mandate.status === "ACTIVE";

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-6">
      <StepHeading title={step.title} prompt={step.prompt} help={step.help} />
      <dl className="flex flex-col gap-3" data-handoff>
        <div className="flex flex-col gap-1">
          <dt className="cq-caption text-(--cq-text-tertiary)">Mandate</dt>
          <dd className="cq-body text-(--cq-text-primary)" data-handoff-mandate>
            {handoff === undefined
              ? "Not available"
              : active
                ? `Active, version ${handoff.mandate.version}.`
                : `Saved as ${handoff.mandate.status.toLowerCase()}, version ${handoff.mandate.version}.`}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="cq-caption text-(--cq-text-tertiary)">
            Recommendations
          </dt>
          <dd
            className="cq-body text-(--cq-text-primary)"
            data-handoff-recommendation
          >
            Discover ranks companies against this mandate and explains every
            result.
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="cq-caption text-(--cq-text-tertiary)">
            Inbound from founders
          </dt>
          <dd className="cq-body text-(--cq-text-primary)" data-handoff-inbound>
            {handoff?.inboundPreference === null || handoff === undefined
              ? "Not set. Founders can't contact you directly yet."
              : `Recorded as “${handoff.inboundPreference.label}”. It takes effect once founders can contact you directly.`}
          </dd>
        </div>
      </dl>
      <InlineNotice tone="info" title="What happens next">
        Your mandate is stored and stays private to your organisation. You can
        change it at any time.
      </InlineNotice>
    </form>
  );
}
