"use client";

import { useState, type FormEvent } from "react";

import { ChoiceList, MultiChoiceList } from "@capital-q/ui/choice-list";
import { NarrativeInput } from "@capital-q/ui/narrative-input";

import { StepHeading, StrengthNote, type StepProps } from "./step-props";

/**
 * I5 / I6. Positive criteria with an explicit strength: nothing is weighted
 * silently. Custom prose is kept for people to read and never becomes an
 * automatic filter.
 */
export function FlagsStep({ step, formId, busy, actions }: StepProps<"flags">) {
  const saved = step.response;
  const [codes, setCodes] = useState<readonly string[]>(saved?.codes ?? []);
  const [strength, setStrength] = useState<string | undefined>(saved?.strength);
  const [customText, setCustomText] = useState(saved?.customText ?? "");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const custom = customText.trim();
    if (codes.length === 0 && custom.length === 0) {
      void actions.skip();
      return;
    }
    void actions.submit({
      kind: "flags",
      codes: [...codes],
      ...(strength === undefined ? {} : { strength }),
      ...(step.allowCustom && custom.length > 0 ? { customText: custom } : {}),
    });
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-7">
      <StepHeading title={step.title} prompt={step.prompt} help={step.help} />
      <MultiChoiceList
        id={`${step.id}-codes`}
        name="codes"
        legend={step.prompt ?? step.title}
        legendHidden
        options={step.options}
        values={codes}
        disabled={busy}
        onChange={setCodes}
      />
      <StrengthNote>
        Recorded as “{step.defaultStrengthLabel}” unless you choose a strength
        below. A strength is a preference, never a hard exclusion.
      </StrengthNote>
      {codes.length > 0 ? (
        <ChoiceList
          id={`${step.id}-strength`}
          name="strength"
          legend="How firm are those?"
          options={step.strengthOptions}
          value={strength}
          disabled={busy}
          onChange={setStrength}
        />
      ) : null}
      {step.allowCustom ? (
        <NarrativeInput
          id={`${step.id}-custom`}
          label="Anything else you look for?"
          description="In your own words. Kept for people to read; it never becomes an automatic filter."
          value={customText}
          maxLength={1000}
          disabled={busy}
          onChange={setCustomText}
        />
      ) : null}
    </form>
  );
}
