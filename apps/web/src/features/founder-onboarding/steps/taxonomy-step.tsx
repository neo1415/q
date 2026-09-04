"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@capital-q/ui/button";
import { InlineNotice, Skeleton } from "@capital-q/ui/states";

import type { TaxonomyCandidateView } from "../models/presentation";
import { StepHeading, type StepProps } from "./step-props";

/**
 * F1 categories. Suggested categories come from the deterministic
 * classifier over the founder's own description; each is a button the
 * founder presses to keep. Nothing is assigned until Continue, and a
 * suggestion is never presented as Q's analysis of the company.
 */
export function TaxonomyStep({
  step,
  formId,
  busy,
  actions,
}: StepProps<"taxonomy_select">) {
  const hasSource =
    step.sourceText !== undefined && step.sourceText.trim().length > 0;
  // Without a description there is nothing to derive candidates from.
  const [candidates, setCandidates] = useState<
    readonly TaxonomyCandidateView[] | undefined
  >(hasSource ? undefined : []);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<readonly TaxonomyCandidateView[]>(
    step.selected,
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const { sourceText } = step;
  const { findTaxonomyCandidates } = actions;

  useEffect(() => {
    if (sourceText === undefined || sourceText.trim().length === 0) {
      return;
    }
    let cancelled = false;
    findTaxonomyCandidates(sourceText)
      .then((found) => {
        if (!cancelled) {
          setCandidates(found);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setCandidates([]);
          setLoadError(
            cause instanceof Error
              ? cause.message
              : "Suggestions aren't available right now.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sourceText, findTaxonomyCandidates]);

  const isSelected = (nodeId: string) =>
    selected.some((item) => item.nodeId === nodeId);

  function toggle(candidate: TaxonomyCandidateView) {
    setError(undefined);
    setSelected((current) =>
      isSelected(candidate.nodeId)
        ? current.filter((item) => item.nodeId !== candidate.nodeId)
        : current.length >= step.maxItems
          ? current
          : [...current, candidate],
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected.length === 0) {
      if (step.optional) {
        void actions.skip();
        return;
      }
      setError("Choose at least one category.");
      return;
    }
    void actions.submit({
      kind: "taxonomy_select",
      nodeIds: selected.map((item) => item.nodeId),
    });
  }

  const offered = [
    ...selected,
    ...(candidates ?? []).filter((candidate) => !isSelected(candidate.nodeId)),
  ];

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-6">
      <StepHeading title={step.title} prompt={step.prompt} help={step.help} />
      {candidates === undefined ? (
        <div aria-busy="true" aria-label="Finding suggested categories">
          <Skeleton lines={3} />
        </div>
      ) : (
        <fieldset className="flex flex-col gap-3">
          <legend className="cq-label text-(--cq-text-primary)">
            Suggested categories
          </legend>
          {sourceText === undefined ? (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              Add a short description first and suggestions will appear here.
            </p>
          ) : offered.length === 0 ? (
            <p className="cq-body-sm text-(--cq-text-secondary)">
              No suggestions matched your description. You can skip this for
              now.
            </p>
          ) : null}
          <ul
            className="flex flex-wrap gap-2"
            aria-label="Suggested categories"
          >
            {offered.map((candidate) => (
              <li key={candidate.nodeId}>
                <Button
                  type="button"
                  variant={
                    isSelected(candidate.nodeId) ? "primary" : "secondary"
                  }
                  size="compact"
                  aria-pressed={isSelected(candidate.nodeId)}
                  disabled={busy}
                  onClick={() => toggle(candidate)}
                  title={candidate.reason}
                >
                  {candidate.label}
                  <span className="sr-only">, {candidate.vocabularyLabel}</span>
                </Button>
              </li>
            ))}
          </ul>
          <p className="cq-caption text-(--cq-text-tertiary)">
            Up to {step.maxItems}. Suggestions come from the words you used;
            only what you keep is recorded.
          </p>
        </fieldset>
      )}
      {loadError !== undefined ? (
        <InlineNotice tone="info">{loadError}</InlineNotice>
      ) : null}
      {error !== undefined ? (
        <p role="alert" className="cq-caption text-(--cq-danger)">
          {error}
        </p>
      ) : null}
    </form>
  );
}
