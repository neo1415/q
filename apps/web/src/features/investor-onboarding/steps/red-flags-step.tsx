"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@capital-q/ui/button";
import { MultiChoiceList } from "@capital-q/ui/choice-list";
import { Input } from "@capital-q/ui/input";
import { InlineNotice } from "@capital-q/ui/states";

import type { TaxonomyCandidateView } from "../../onboarding-kit/client";
import { StepHeading, type StepProps } from "./step-props";

/**
 * I7. Two clearly different lists. "I'd rather not see" is a soft
 * negative (AVOID): it can still appear. "Never show me" is a hard
 * exclusion: not shown in standard discovery, whatever the discovery style.
 * The same flag cannot be in both.
 */
export function RedFlagsStep({
  step,
  formId,
  busy,
  actions,
}: StepProps<"red_flags">) {
  const saved = step.response;
  const [avoid, setAvoid] = useState<readonly string[]>(saved?.avoid ?? []);
  const [hard, setHard] = useState<readonly string[]>(saved?.hard ?? []);
  const [sectors, setSectors] = useState<readonly TaxonomyCandidateView[]>(
    step.sectorExclusionSelected,
  );
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<
    readonly TaxonomyCandidateView[]
  >([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const { findTaxonomyCandidates } = actions;

  async function search() {
    const text = query.trim();
    if (text.length === 0) return;
    try {
      setCandidates(await findTaxonomyCandidates(text));
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Suggestions aren't available right now.",
      );
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const overlap = avoid.filter((code) => hard.includes(code));
    if (overlap.length > 0) {
      setError(
        "A red flag is either something to avoid or something never to show, not both.",
      );
      return;
    }
    if (avoid.length === 0 && hard.length === 0 && sectors.length === 0) {
      void actions.skip();
      return;
    }
    void actions.submit({
      kind: "red_flags",
      avoid: [...avoid],
      hard: [...hard],
      sectorExclusionIds: sectors.map((item) => item.nodeId),
    });
  }

  const offered = candidates.filter(
    (c) => !sectors.some((s) => s.nodeId === c.nodeId),
  );

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-7">
      <StepHeading title={step.title} prompt={step.prompt} help={step.help} />
      <section className="flex flex-col gap-2" data-red-flags="avoid">
        <MultiChoiceList
          id="red-flags-avoid"
          name="avoid"
          legend="I'd rather not see"
          description="A soft preference. These can still appear, ranked lower."
          options={step.options}
          values={avoid}
          disabled={busy}
          onChange={(next) => {
            setAvoid(next);
            setError(undefined);
          }}
        />
      </section>
      <section className="flex flex-col gap-2" data-red-flags="hard">
        <MultiChoiceList
          id="red-flags-hard"
          name="hard"
          legend="Never show me"
          description="A hard exclusion. Opportunities matching these are not shown in standard discovery, whatever the discovery style."
          options={step.options}
          values={hard}
          disabled={busy}
          onChange={(next) => {
            setHard(next);
            setError(undefined);
          }}
        />
      </section>
      <fieldset className="flex flex-col gap-3" data-red-flags="sectors">
        <legend className="cq-label text-(--cq-text-primary)">
          Sectors to exclude outright
        </legend>
        <InlineNotice tone="info" title="Hard exclusion">
          Companies in these categories are not shown in standard discovery.
          This is not a preference.
        </InlineNotice>
        <div className="flex items-end gap-2">
          <Input
            id="red-flags-search"
            label="Search sectors"
            value={query}
            disabled={busy}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void search();
              }
            }}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void search()}
          >
            Suggest
          </Button>
        </div>
        {offered.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Suggested sectors">
            {offered.map((candidate) => (
              <li key={candidate.nodeId}>
                <Button
                  type="button"
                  variant="secondary"
                  size="compact"
                  disabled={busy}
                  onClick={() => setSectors((list) => [...list, candidate])}
                >
                  Exclude {candidate.label}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {sectors.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Excluded sectors">
            {sectors.map((item) => (
              <li key={item.nodeId}>
                <Button
                  type="button"
                  variant="primary"
                  size="compact"
                  aria-pressed
                  disabled={busy}
                  onClick={() =>
                    setSectors((list) =>
                      list.filter((s) => s.nodeId !== item.nodeId),
                    )
                  }
                >
                  Never: {item.label}
                  <span className="sr-only">, remove</span>
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </fieldset>
      {error !== undefined ? (
        <p role="alert" className="cq-caption text-(--cq-danger)">
          {error}
        </p>
      ) : null}
    </form>
  );
}
