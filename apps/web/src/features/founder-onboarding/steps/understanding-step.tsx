"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@capital-q/ui/button";
import { ContextIndicator } from "@capital-q/ui/context-indicator";
import { EditableFact, type FactVerdict } from "@capital-q/ui/editable-fact";
import { NarrativeInput } from "@capital-q/ui/narrative-input";
import { QMark } from "@capital-q/ui/q-mark";
import { TaxonomyChipEditor } from "@capital-q/ui/taxonomy-chip-editor";

import type { FactView } from "../models/presentation";
import { type StepProps } from "./step-props";

/**
 * F3. Q's understanding as editable facts with provenance. A suggested fact
 * becomes authoritative only through the founder's verdict: "Confirm and
 * continue" confirms whatever is still merely suggested; Edit and Mark
 * missing are per fact; "Something's missing" adds a note.
 */
export function UnderstandingStep({
  step,
  formId,
  busy,
  actions,
}: StepProps<"understanding_review">) {
  const [facts, setFacts] = useState<readonly FactView[]>(step.facts);
  const [taxonomy, setTaxonomy] = useState({
    options: step.taxonomyOptions,
    selected: step.taxonomySelected,
  });
  const [missingOpen, setMissingOpen] = useState(
    step.response?.missingNote !== undefined,
  );
  const [missingNote, setMissingNote] = useState(
    step.response?.missingNote ?? "",
  );

  function updateFact(
    id: string,
    next: { value: string; verdict: FactVerdict },
  ) {
    setFacts((current) =>
      current.map((fact) =>
        fact.id === id
          ? { ...fact, value: next.value, verdict: next.verdict }
          : fact,
      ),
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void actions.submit({
      kind: "understanding_review",
      facts: facts.map((fact) => ({
        id: fact.id,
        value: fact.value,
        verdict: fact.verdict === "suggested" ? "confirmed" : fact.verdict,
      })),
      taxonomy: [...taxonomy.selected],
      ...(missingNote.trim().length > 0
        ? { missingNote: missingNote.trim() }
        : {}),
    });
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-6">
      <header className="flex items-start gap-3">
        <QMark size="md" state="COMPLETE" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h1 className="cq-title-lg text-(--cq-text-primary)">{step.title}</h1>
          <p className="cq-body-sm text-(--cq-text-secondary)">{step.intro}</p>
          <ContextIndicator
            scope="organisation_private"
            detail="your company"
          />
        </div>
      </header>

      <div className="flex flex-col divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
        {facts.map((fact) => (
          <EditableFact
            key={fact.id}
            id={fact.id}
            label={fact.label}
            value={fact.value}
            evidence={fact.evidence}
            evidenceDetail={fact.evidenceDetail}
            verdict={fact.verdict}
            disabled={busy}
            onChange={(next) => updateFact(fact.id, next)}
          />
        ))}
      </div>

      <TaxonomyChipEditor
        id="taxonomy"
        legend="How Q would categorise this"
        description="Keep what fits, remove what doesn't, add what's missing."
        options={taxonomy.options}
        selected={taxonomy.selected}
        disabled={busy}
        onChange={setTaxonomy}
      />

      <div className="flex flex-col gap-3">
        {missingOpen ? (
          <NarrativeInput
            id="understanding-missing"
            label="What's missing?"
            placeholder="Tell Q what it should know that isn't here."
            value={missingNote}
            maxLength={600}
            disabled={busy}
            onChange={setMissingNote}
          />
        ) : (
          <Button
            variant="quiet"
            onClick={() => setMissingOpen(true)}
            disabled={busy}
            className="self-start"
          >
            Something&apos;s missing
          </Button>
        )}
      </div>
    </form>
  );
}
