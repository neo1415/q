"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@capital-q/ui/button";
import { ChoiceList } from "@capital-q/ui/choice-list";
import { Input } from "@capital-q/ui/input";

import type { TaxonomyCandidateView } from "../../onboarding-kit/client";
import { StepHeading, StrengthNote, type StepProps } from "./step-props";

type Bucket = "focus" | "avoid";

/**
 * I3. Canonical taxonomy nodes found from the investor's own words
 * ("Suggested categories", never "Q understood"), kept as explicit
 * preferences with a visible strength. The optional "rather not" list is a
 * soft AVOID: it can still appear. Hard exclusions live on the red-flags
 * screen, never here.
 */
export function TaxonomyFocusStep({
  step,
  formId,
  busy,
  actions,
}: StepProps<"taxonomy_focus">) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<
    readonly TaxonomyCandidateView[]
  >([]);
  const [searching, setSearching] = useState(false);
  const [focus, setFocus] = useState<readonly TaxonomyCandidateView[]>(
    step.selected,
  );
  const [avoid, setAvoid] = useState<readonly TaxonomyCandidateView[]>(
    step.avoidSelected,
  );
  const [strength, setStrength] = useState<string | undefined>(
    step.response?.strength,
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const { findTaxonomyCandidates } = actions;

  async function search() {
    const text = query.trim();
    if (text.length === 0) return;
    setSearching(true);
    try {
      setCandidates(await findTaxonomyCandidates(text));
      setError(undefined);
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Suggestions aren't available right now.",
      );
    } finally {
      setSearching(false);
    }
  }

  const inList = (list: readonly TaxonomyCandidateView[], id: string) =>
    list.some((item) => item.nodeId === id);

  function add(bucket: Bucket, candidate: TaxonomyCandidateView) {
    if (bucket === "focus") {
      setAvoid((list) =>
        list.filter((item) => item.nodeId !== candidate.nodeId),
      );
      setFocus((list) =>
        inList(list, candidate.nodeId) || list.length >= step.maxItems
          ? list
          : [...list, candidate],
      );
    } else {
      setFocus((list) =>
        list.filter((item) => item.nodeId !== candidate.nodeId),
      );
      setAvoid((list) =>
        inList(list, candidate.nodeId) || list.length >= step.maxItems
          ? list
          : [...list, candidate],
      );
    }
  }

  function remove(bucket: Bucket, id: string) {
    (bucket === "focus" ? setFocus : setAvoid)((list) =>
      list.filter((item) => item.nodeId !== id),
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (focus.length === 0 && avoid.length === 0) {
      void actions.skip();
      return;
    }
    void actions.submit({
      kind: "taxonomy_focus",
      nodeIds: focus.map((item) => item.nodeId),
      ...(strength === undefined ? {} : { strength }),
      ...(step.allowAvoid
        ? { avoidNodeIds: avoid.map((item) => item.nodeId) }
        : {}),
    });
  }

  const offered = candidates.filter(
    (candidate) =>
      !inList(focus, candidate.nodeId) && !inList(avoid, candidate.nodeId),
  );

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-6">
      <StepHeading title={step.title} prompt={step.prompt} help={step.help} />
      <div className="flex items-end gap-2">
        <Input
          id={`${step.id}-search`}
          label="Search categories"
          description="Type a word or two; suggested categories come from the canonical taxonomy."
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
          disabled={busy || searching}
          onClick={() => void search()}
        >
          Suggest
        </Button>
      </div>
      {offered.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="cq-label text-(--cq-text-primary)">
            Suggested categories
          </legend>
          <ul
            className="flex flex-wrap gap-2"
            aria-label="Suggested categories"
          >
            {offered.map((candidate) => (
              <li key={candidate.nodeId} className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="secondary"
                  size="compact"
                  disabled={busy}
                  onClick={() => add("focus", candidate)}
                  title={candidate.reason}
                >
                  {candidate.label}
                  <span className="sr-only">, add as a preference</span>
                </Button>
                {step.allowAvoid ? (
                  <Button
                    type="button"
                    variant="quiet"
                    size="compact"
                    disabled={busy}
                    onClick={() => add("avoid", candidate)}
                  >
                    Rather not
                    <span className="sr-only"> {candidate.label}</span>
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}
      <fieldset className="flex flex-col gap-2" data-focus-list>
        <legend className="cq-label text-(--cq-text-primary)">
          Your preferences
        </legend>
        {focus.length === 0 ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            Nothing chosen yet. Leaving this empty means anywhere.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2" aria-label="Chosen categories">
            {focus.map((item) => (
              <li key={item.nodeId}>
                <Button
                  type="button"
                  variant="primary"
                  size="compact"
                  aria-pressed
                  disabled={busy}
                  onClick={() => remove("focus", item.nodeId)}
                >
                  {item.label}
                  <span className="sr-only">, remove</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      {focus.length > 0 ? (
        <ChoiceList
          id={`${step.id}-strength`}
          name="strength"
          legend="How firm is that?"
          description="Not chosen means a strong preference."
          options={step.strengthOptions}
          value={strength}
          disabled={busy}
          onChange={setStrength}
        />
      ) : null}
      {step.allowAvoid ? (
        <fieldset className="flex flex-col gap-2" data-avoid-list>
          <legend className="cq-label text-(--cq-text-primary)">
            Rather not see
          </legend>
          <StrengthNote>
            A soft preference: these can still appear, ranked lower. Nothing is
            hidden here.
          </StrengthNote>
          {avoid.length === 0 ? (
            <p className="cq-body-sm text-(--cq-text-secondary)">None.</p>
          ) : (
            <ul className="flex flex-wrap gap-2" aria-label="Rather not see">
              {avoid.map((item) => (
                <li key={item.nodeId}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="compact"
                    aria-pressed
                    disabled={busy}
                    onClick={() => remove("avoid", item.nodeId)}
                  >
                    {item.label}
                    <span className="sr-only">, remove</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      ) : null}
      {error !== undefined ? (
        <p role="alert" className="cq-caption text-(--cq-danger)">
          {error}
        </p>
      ) : null}
    </form>
  );
}
