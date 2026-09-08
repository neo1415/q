"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@capital-q/ui/button";
import { ContextIndicator } from "@capital-q/ui/context-indicator";
import { InlineNotice } from "@capital-q/ui/states";

import type { FounderSuggestionView } from "../models/presentation";

import { StepHeading, type StepProps } from "./step-props";

/**
 * F3. Two lists, and the difference between them is the whole point.
 *
 * What the founder entered, each fact with a Change action that reopens its
 * screen — no inference, no score, no verification language.
 *
 * And, since CQ-C5-R2B, what Q read in the documents they shared: real
 * proposals from the real extraction, each one still a proposal. Confirm
 * records it as the founder's own answer through the same validated path a
 * typed answer takes; Change reopens the screen so they can write what is
 * actually true; No thanks records that they declined, and a declined
 * proposal is not company truth waiting to be found again later.
 *
 * The heading says "Q read", never "Q verified". Nothing on this screen has
 * been checked against anything.
 */
export function ReviewStep({
  step,
  formId,
  busy,
  actions,
}: StepProps<"review">) {
  const [problem, setProblem] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void actions.submit({ kind: "review", confirmed: true });
  }

  async function decide(
    suggestion: FounderSuggestionView,
    resolution: "ACCEPT" | "REJECT",
  ): Promise<void> {
    setProblem(null);
    const recorded = await actions.resolveSuggestion({
      suggestionId: suggestion.id,
      resolution,
    });
    if (!recorded) {
      setProblem("Capital Q couldn't record that just now. Please try again.");
    }
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-6">
      <StepHeading title={step.title} prompt={step.prompt} help={step.intro} />

      {step.suggestions.length > 0 ? (
        <section className="flex flex-col gap-3" aria-labelledby="q-read">
          <h2 id="q-read" className="cq-label text-(--cq-text-secondary)">
            What Q read in your documents
          </h2>
          <ul className="flex flex-col divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            {step.suggestions.map((suggestion) => (
              <li
                key={suggestion.id}
                data-suggestion={suggestion.id}
                className="flex flex-col gap-3 py-4"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="cq-caption text-(--cq-text-tertiary)">
                    {suggestion.label}
                    {suggestion.source === undefined
                      ? ""
                      : ` · ${suggestion.source}`}
                  </span>
                  <span className="cq-body text-(--cq-text-primary)">
                    {suggestion.value}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="compact"
                    disabled={busy}
                    onClick={() => void decide(suggestion, "ACCEPT")}
                  >
                    That&apos;s right
                    <span className="sr-only"> — {suggestion.label}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    size="compact"
                    disabled={busy}
                    onClick={() => void actions.openStep(suggestion.stepId)}
                  >
                    Change
                    <span className="sr-only"> {suggestion.label}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    size="compact"
                    disabled={busy}
                    onClick={() => void decide(suggestion, "REJECT")}
                  >
                    No thanks
                    <span className="sr-only"> — {suggestion.label}</span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {problem !== null ? (
            <InlineNotice tone="warning">{problem}</InlineNotice>
          ) : null}
        </section>
      ) : null}
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
