"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { OnboardingResponseValue } from "@capital-q/contracts";
import { FOUNDER_DEFINITION_CURRENT } from "@capital-q/founder-onboarding/definition";
import { INVESTOR_DEFINITION_V1 } from "@capital-q/investor-onboarding/definition";
import { Button } from "@capital-q/ui/button";
import { ChoiceChip } from "@capital-q/ui/chip";
import { DialogContent, DialogRoot } from "@capital-q/ui/dialog";
import { ICON_SIZE, Pencil, X } from "@capital-q/ui/icons";
import { Input, Textarea } from "@capital-q/ui/input";
import { InlineNotice } from "@capital-q/ui/states";
import type { OnboardingStepManifest } from "@capital-q/onboarding";

import {
  reviseProfileAnswerAction,
  taxonomyChoicesAction,
  type TaxonomyChoice,
} from "./answer-actions";
import type { ProfileJourney } from "./profile-answers";

/**
 * Edit one profile card's facts (ADR 0024): each fact is the step the
 * person answered in setup, shown with that step's own options, and saved
 * as a revision of their completed setup, which changes the mandate or the
 * company the way setup did. Only the facts that changed are sent. Nothing
 * is saved until the person presses Save, and nothing reads "saved" until
 * the server has recorded it.
 */

type Step = OnboardingStepManifest;

function stepsOf(journey: ProfileJourney): readonly Step[] {
  return (
    journey === "founder" ? FOUNDER_DEFINITION_CURRENT : INVESTOR_DEFINITION_V1
  ).steps;
}

type Draft = Readonly<Record<string, OnboardingResponseValue | null>>;

function same(
  a: OnboardingResponseValue | null | undefined,
  b: OnboardingResponseValue | null | undefined,
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function AnswerEditor({
  journey,
  title,
  stepKeys,
  responses,
  labels,
}: {
  readonly journey: ProfileJourney;
  readonly title: string;
  /** The facts this card edits, in order (revisable steps only). */
  readonly stepKeys: readonly string[];
  readonly responses: Readonly<Record<string, OnboardingResponseValue>>;
  readonly labels: Readonly<Record<string, string>>;
}) {
  const router = useRouter();
  const steps = useMemo(
    () =>
      stepKeys.flatMap((key) => {
        const step = stepsOf(journey).find((s) => s.stepKey === key);
        return step === undefined ? [] : [step];
      }),
    [journey, stepKeys],
  );
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    setDraft(
      Object.fromEntries(
        steps.map((s) => [s.stepKey, responses[s.stepKey] ?? null]),
      ),
    );
    setError(null);
    setOpen(true);
  };

  const save = async () => {
    const changed = steps.filter(
      (s) =>
        draft[s.stepKey] !== null &&
        draft[s.stepKey] !== undefined &&
        !same(draft[s.stepKey], responses[s.stepKey]),
    );
    if (changed.length === 0) {
      setOpen(false);
      return;
    }
    setBusy(true);
    setError(null);
    for (const step of changed) {
      const result = await reviseProfileAnswerAction({
        journey,
        stepKey: step.stepKey,
        value: draft[step.stepKey],
      });
      if (!result.ok) {
        setBusy(false);
        setError(`${step.configuration.prompt}: ${result.message}`);
        router.refresh();
        return;
      }
    }
    setBusy(false);
    setOpen(false);
    router.refresh();
  };

  if (steps.length === 0) return null;
  return (
    <>
      <Button
        variant="quiet"
        onClick={start}
        aria-label={`Edit ${title.toLowerCase()}`}
        data-answer-edit
      >
        <Pencil size={ICON_SIZE.compact} aria-hidden="true" />
        Edit
      </Button>
      <DialogRoot open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        {open ? (
          <DialogContent
            title={`Edit ${title.toLowerCase()}`}
            description="What you change here updates your profile and what Discover works from."
            className="max-w-xl"
            actions={
              <>
                <Button
                  variant="quiet"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  disabled={busy}
                  aria-busy={busy}
                  onClick={() => void save()}
                  data-answer-save
                >
                  {busy ? "Saving…" : "Save"}
                </Button>
              </>
            }
          >
            <div className="flex max-h-[60vh] flex-col gap-6 overflow-y-auto pr-1">
              {error === null ? null : (
                <InlineNotice tone="warning" title="Not saved">
                  {error}
                </InlineNotice>
              )}
              {steps.map((step) => (
                <StepField
                  key={step.stepKey}
                  step={step}
                  value={draft[step.stepKey] ?? null}
                  labels={labels}
                  onChange={(value) =>
                    setDraft((known) => ({ ...known, [step.stepKey]: value }))
                  }
                />
              ))}
            </div>
          </DialogContent>
        ) : null}
      </DialogRoot>
    </>
  );
}

function StepField({
  step,
  value,
  labels,
  onChange,
}: {
  readonly step: Step;
  readonly value: OnboardingResponseValue | null;
  readonly labels: Readonly<Record<string, string>>;
  readonly onChange: (value: OnboardingResponseValue | null) => void;
}) {
  const c = step.configuration;
  const id = `answer-${step.stepKey.replace(/\W+/g, "-")}`;
  switch (c.stepType) {
    case "single_select": {
      const current = value?.type === "SINGLE_SELECT" ? value.optionKey : null;
      return (
        <fieldset
          className="flex flex-col gap-2"
          data-answer-field={step.stepKey}
        >
          <legend className="cq-label pb-1 text-(--cq-text-primary)">
            {c.prompt}
          </legend>
          <div className="flex flex-wrap gap-2">
            {c.options.map((option) => (
              <ChoiceChip
                key={option.optionKey}
                selected={current === option.optionKey}
                onClick={() =>
                  onChange({
                    type: "SINGLE_SELECT",
                    optionKey: option.optionKey,
                  })
                }
              >
                {option.label}
              </ChoiceChip>
            ))}
          </div>
        </fieldset>
      );
    }
    case "multi_select": {
      const current = value?.type === "MULTI_SELECT" ? value.optionKeys : [];
      const exclusive = new Set(c.exclusiveOptionKeys ?? []);
      const toggle = (key: string) => {
        const next = current.includes(key)
          ? current.filter((k) => k !== key)
          : exclusive.has(key)
            ? [key]
            : [...current.filter((k) => !exclusive.has(k)), key].slice(
                0,
                c.maxSelections,
              );
        onChange(
          next.length === 0 ? null : { type: "MULTI_SELECT", optionKeys: next },
        );
      };
      return (
        <fieldset
          className="flex flex-col gap-2"
          data-answer-field={step.stepKey}
        >
          <legend className="cq-label pb-1 text-(--cq-text-primary)">
            {c.prompt}
          </legend>
          <div className="flex flex-wrap gap-2">
            {c.options.map((option) => (
              <ChoiceChip
                key={option.optionKey}
                selected={current.includes(option.optionKey)}
                onClick={() => toggle(option.optionKey)}
              >
                {option.label}
              </ChoiceChip>
            ))}
          </div>
        </fieldset>
      );
    }
    case "range": {
      const current = value?.type === "RANGE" ? value.value : "";
      return (
        <Input
          id={id}
          label={c.prompt}
          inputMode="decimal"
          value={current}
          onChange={(event) => {
            const text = event.target.value.replace(/[,\s]/g, "");
            onChange(
              /^\d+(?:\.\d+)?$/.test(text)
                ? { type: "RANGE", value: text }
                : null,
            );
          }}
          data-answer-field={step.stepKey}
        />
      );
    }
    case "short_text":
    case "long_text":
    case "voice_text": {
      const current = value?.type === "TEXT" ? value.text : "";
      const max = c.maxLength;
      const set = (text: string) =>
        onChange(
          text.trim().length === 0
            ? null
            : { type: "TEXT", text: text.slice(0, max) },
        );
      return c.stepType === "short_text" ? (
        <Input
          id={id}
          label={c.prompt}
          value={current}
          maxLength={max}
          onChange={(event) => set(event.target.value)}
          data-answer-field={step.stepKey}
        />
      ) : (
        <Textarea
          id={id}
          label={c.prompt}
          value={current}
          maxLength={max}
          rows={4}
          onChange={(event) => set(event.target.value)}
          data-answer-field={step.stepKey}
        />
      );
    }
    case "reference_select":
      return c.resourceType === "TAXONOMY_NODE" ? (
        <CategoryField
          stepKey={step.stepKey}
          prompt={c.prompt}
          vocabularies={c.vocabularyCodes}
          maxItems={c.maxItems}
          ids={value?.type === "RESOURCE_REFERENCE" ? value.resourceIds : []}
          labels={labels}
          onChange={(ids) =>
            onChange(
              ids.length === 0
                ? null
                : {
                    type: "RESOURCE_REFERENCE",
                    resourceType: "TAXONOMY_NODE",
                    resourceIds: [...ids],
                  },
            )
          }
        />
      ) : null;
    case "confirmation":
    case "document_upload":
      return null;
  }
}

/** Categories from Capital Q's own taxonomy: search, pick, remove. */
function CategoryField({
  stepKey,
  prompt,
  vocabularies,
  maxItems,
  ids,
  labels,
  onChange,
}: {
  readonly stepKey: string;
  readonly prompt: string;
  readonly vocabularies: readonly string[];
  readonly maxItems: number;
  readonly ids: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
  readonly onChange: (ids: readonly string[]) => void;
}) {
  const [choices, setChoices] = useState<readonly TaxonomyChoice[] | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const load = () => {
    if (choices !== null) return;
    void taxonomyChoicesAction(vocabularies).then((result) => {
      if (result === null) setFailed(true);
      else setChoices(result);
    });
  };
  const nameOf = (id: string) =>
    labels[id] ?? choices?.find((choice) => choice.id === id)?.name ?? "…";
  const wanted = query.trim().toLowerCase();
  const matches =
    choices === null || wanted.length === 0
      ? []
      : choices
          .filter(
            (choice) =>
              !ids.includes(choice.id) &&
              choice.name.toLowerCase().includes(wanted),
          )
          .slice(0, 12);
  return (
    <fieldset className="flex flex-col gap-2" data-answer-field={stepKey}>
      <legend className="cq-label pb-1 text-(--cq-text-primary)">
        {prompt}
      </legend>
      <div className="flex flex-wrap gap-2">
        {ids.map((id) => (
          <span
            key={id}
            className="cq-body-sm inline-flex min-h-8 items-center gap-1 rounded-full border border-(--cq-border-subtle) bg-(--cq-surface-subtle) py-1 pr-1 pl-3 text-(--cq-text-primary)"
          >
            {nameOf(id)}
            <button
              type="button"
              onClick={() => onChange(ids.filter((known) => known !== id))}
              aria-label={`Remove ${nameOf(id)}`}
              className="inline-flex size-7 items-center justify-center rounded-full text-(--cq-text-secondary) hover:bg-(--cq-surface-strong)"
            >
              <X size={ICON_SIZE.compact} aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      {ids.length >= maxItems ? (
        // F18: say why the search went away instead of hiding it silently.
        <p
          className="cq-caption text-(--cq-text-secondary)"
          role="status"
          data-answer-limit
        >
          That&apos;s the most you can keep ({maxItems}). Remove one to add
          another.
        </p>
      ) : (
        <Input
          id={`answer-${stepKey.replace(/\W+/g, "-")}-search`}
          label="Add"
          labelHidden
          placeholder="Type to find a category"
          value={query}
          onFocus={load}
          onChange={(event) => {
            load();
            setQuery(event.target.value);
          }}
        />
      )}
      {failed ? (
        <p className="cq-caption text-(--cq-text-secondary)">
          Categories couldn&apos;t load just now. Try again in a moment.
        </p>
      ) : null}
      {matches.length === 0 ? null : (
        <div className="flex flex-wrap gap-2" data-answer-matches>
          {matches.map((choice) => (
            <ChoiceChip
              key={choice.id}
              selected={false}
              onClick={() => {
                onChange([...ids, choice.id]);
                setQuery("");
              }}
            >
              {choice.name}
            </ChoiceChip>
          ))}
        </div>
      )}
    </fieldset>
  );
}
