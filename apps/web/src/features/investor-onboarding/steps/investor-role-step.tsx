"use client";

import { useState, type FormEvent } from "react";

import { ChoiceList } from "@capital-q/ui/choice-list";
import { Input } from "@capital-q/ui/input";

import { StepHeading, type StepProps } from "./step-props";

/**
 * I0. Investor type describes the organisation; the firm name creates or
 * names its workspace; the title is descriptive only. A solo angel keeps
 * the personal workspace name. Nobody joins a firm by typing its name.
 */
export function InvestorRoleStep({
  step,
  formId,
  busy,
  actions,
}: StepProps<"investor_role">) {
  const saved = step.response;
  const [investorType, setInvestorType] = useState<string | undefined>(
    saved?.investorType,
  );
  const [organisationName, setOrganisationName] = useState(
    saved?.organisationName ?? "",
  );
  const [businessTitle, setBusinessTitle] = useState(
    saved?.businessTitle ?? "",
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const [nameError, setNameError] = useState<string | undefined>(undefined);

  function chooseType(next: string) {
    setInvestorType(next);
    setError(undefined);
    if (next === "angel" && organisationName.trim().length === 0) {
      setOrganisationName(step.personalWorkspaceName);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (investorType === undefined) {
      setError("Choose how you invest to continue.");
      return;
    }
    const name = organisationName.trim();
    if (name.length === 0) {
      setNameError("Name your firm, or keep the personal workspace name.");
      return;
    }
    const title = businessTitle.trim();
    void actions.submit({
      kind: "investor_role",
      investorType,
      organisationName: name,
      ...(title.length > 0 ? { businessTitle: title } : {}),
    });
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-7">
      <StepHeading title={step.title} prompt={step.prompt} help={step.help} />
      <ChoiceList
        id="investor-type"
        name="investorType"
        legend="How do you invest?"
        legendHidden
        options={step.typeOptions}
        value={investorType}
        error={error}
        disabled={busy}
        onChange={chooseType}
      />
      <Input
        id="investor-organisation"
        label="Your firm"
        description={`Investing personally? Keep “${step.personalWorkspaceName}”. Typing another firm's name never joins it.`}
        autoComplete="organization"
        value={organisationName}
        disabled={busy}
        error={nameError}
        onChange={(event) => {
          setOrganisationName(event.target.value);
          setNameError(undefined);
        }}
      />
      <Input
        id="investor-title"
        label="Your role there"
        description="Optional. A title is descriptive only; it grants no permissions."
        placeholder="Partner, Principal, Angel"
        autoComplete="organization-title"
        value={businessTitle}
        disabled={busy}
        onChange={(event) => setBusinessTitle(event.target.value)}
      />
    </form>
  );
}
