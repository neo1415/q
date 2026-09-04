"use client";

import { type FormEvent } from "react";

import { Button } from "@capital-q/ui/button";
import { ContextIndicator } from "@capital-q/ui/context-indicator";

import { StepHeading, type StepProps } from "./step-props";

/**
 * F3. "Here's what we have so far": exactly what the founder entered, each
 * fact with a Change action that reopens its screen. No inference, no
 * score, no verification language.
 */
export function ReviewStep({
  step,
  formId,
  busy,
  actions,
}: StepProps<"review">) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void actions.submit({ kind: "review", confirmed: true });
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-6">
      <StepHeading title={step.title} prompt={step.prompt} help={step.intro} />
      <dl className="flex flex-col divide-y divide-(--cq-border-subtle)">
        {step.items.map((item) => (
          <div
            key={item.id}
            data-review-item={item.id}
            className="flex items-start justify-between gap-4 py-3"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <dt className="cq-caption text-(--cq-text-tertiary)">
                {item.label}
              </dt>
              <dd className="cq-body text-(--cq-text-primary)">
                {item.value ?? (
                  <span className="text-(--cq-text-secondary)">
                    Not added yet
                  </span>
                )}
              </dd>
            </div>
            <Button
              type="button"
              variant="quiet"
              size="compact"
              disabled={busy}
              onClick={() => void actions.openStep(item.editStepId)}
            >
              Change
              <span className="sr-only"> {item.label}</span>
            </Button>
          </div>
        ))}
        <div
          data-review-item="categories"
          className="flex items-start justify-between gap-4 py-3"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="cq-caption text-(--cq-text-tertiary)">Categories</dt>
            <dd className="cq-body text-(--cq-text-primary)">
              {step.categories.length === 0 ? (
                <span className="text-(--cq-text-secondary)">
                  None chosen yet
                </span>
              ) : (
                step.categories.join(", ")
              )}
            </dd>
          </div>
          <Button
            type="button"
            variant="quiet"
            size="compact"
            disabled={busy}
            onClick={() => void actions.openStep("categories")}
          >
            Change<span className="sr-only"> categories</span>
          </Button>
        </div>
        <div
          data-review-item="materials"
          className="flex items-start justify-between gap-4 py-3"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="cq-caption text-(--cq-text-tertiary)">
              Materials you have
            </dt>
            <dd className="cq-body text-(--cq-text-primary)">
              {step.materials === undefined || step.materials.length === 0 ? (
                <span className="text-(--cq-text-secondary)">
                  None declared yet
                </span>
              ) : (
                step.materials.join(", ")
              )}
            </dd>
          </div>
          <Button
            type="button"
            variant="quiet"
            size="compact"
            disabled={busy}
            onClick={() => void actions.openStep("materials")}
          >
            Change<span className="sr-only"> materials</span>
          </Button>
        </div>
      </dl>
      <ContextIndicator
        scope="organisation_private"
        detail="Entered by you. Q hasn't reviewed it, and investors can't see it."
      />
    </form>
  );
}
