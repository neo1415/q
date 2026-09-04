"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@capital-q/ui/button";
import { ChoiceList } from "@capital-q/ui/choice-list";

import type { TaxonomyCandidateView } from "../../onboarding-kit/client";
import { StepHeading, StrengthNote, type StepProps } from "./step-props";

function Picker({
  id,
  legend,
  options,
  selected,
  busy,
  onToggle,
}: {
  readonly id: string;
  readonly legend: string;
  readonly options: readonly TaxonomyCandidateView[];
  readonly selected: readonly string[];
  readonly busy: boolean;
  readonly onToggle: (nodeId: string) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2" id={id}>
      <legend className="cq-label text-(--cq-text-primary)">{legend}</legend>
      <StrengthNote>Recorded as a strong preference. Optional.</StrengthNote>
      <ul className="flex flex-wrap gap-2" aria-label={legend}>
        {options.map((option) => {
          const pressed = selected.includes(option.nodeId);
          return (
            <li key={option.nodeId}>
              <Button
                type="button"
                variant={pressed ? "primary" : "secondary"}
                size="compact"
                aria-pressed={pressed}
                disabled={busy}
                onClick={() => onToggle(option.nodeId)}
              >
                {option.label}
              </Button>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

/** I4. Separate dimensions, each explicit; nothing collapses into one label. */
export function AttributesStep({
  step,
  formId,
  busy,
  actions,
}: StepProps<"attributes">) {
  const saved = step.response;
  const [businessModelIds, setBusinessModelIds] = useState<readonly string[]>(
    saved?.businessModelIds ?? [],
  );
  const [customerTypeIds, setCustomerTypeIds] = useState<readonly string[]>(
    saved?.customerTypeIds ?? [],
  );
  const [capitalIntensity, setCapitalIntensity] = useState<string | undefined>(
    saved?.capitalIntensity,
  );
  const [regulatoryAppetite, setRegulatoryAppetite] = useState<
    string | undefined
  >(saved?.regulatoryAppetite);
  const [revenueState, setRevenueState] = useState<string | undefined>(
    saved?.revenueState,
  );

  const toggle = (list: readonly string[], id: string) =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id];

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const answered =
      businessModelIds.length > 0 ||
      customerTypeIds.length > 0 ||
      capitalIntensity !== undefined ||
      regulatoryAppetite !== undefined ||
      revenueState !== undefined;
    if (!answered) {
      void actions.skip();
      return;
    }
    void actions.submit({
      kind: "attributes",
      businessModelIds: [...businessModelIds],
      customerTypeIds: [...customerTypeIds],
      ...(capitalIntensity === undefined ? {} : { capitalIntensity }),
      ...(regulatoryAppetite === undefined ? {} : { regulatoryAppetite }),
      ...(revenueState === undefined ? {} : { revenueState }),
    });
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-7">
      <StepHeading title={step.title} prompt={step.prompt} help={step.help} />
      <Picker
        id="attributes-business-models"
        legend="Business models you back"
        options={step.businessModelOptions}
        selected={businessModelIds}
        busy={busy}
        onToggle={(id) => setBusinessModelIds((list) => toggle(list, id))}
      />
      <Picker
        id="attributes-customer-types"
        legend="Customer types you back"
        options={step.customerTypeOptions}
        selected={customerTypeIds}
        busy={busy}
        onToggle={(id) => setCustomerTypeIds((list) => toggle(list, id))}
      />
      <ChoiceList
        id="attributes-capital"
        name="capitalIntensity"
        legend="Capital intensity"
        description="Optional."
        options={step.capitalOptions}
        value={capitalIntensity}
        disabled={busy}
        onChange={setCapitalIntensity}
      />
      <ChoiceList
        id="attributes-regulatory"
        name="regulatoryAppetite"
        legend="Regulated markets"
        description="Optional."
        options={step.regulatoryOptions}
        value={regulatoryAppetite}
        disabled={busy}
        onChange={setRegulatoryAppetite}
      />
      <ChoiceList
        id="attributes-revenue"
        name="revenueState"
        legend="Revenue expectations"
        description="Optional. Kept with your onboarding answers until revenue thresholds are supported as policy."
        options={step.revenueOptions}
        value={revenueState}
        disabled={busy}
        onChange={setRevenueState}
      />
    </form>
  );
}
