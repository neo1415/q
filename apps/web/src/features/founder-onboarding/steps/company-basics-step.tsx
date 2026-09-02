"use client";

import { useState, type FormEvent } from "react";

import { Input } from "@capital-q/ui/input";
import { Select } from "@capital-q/ui/select";

import { StepHeading, type StepProps } from "./step-props";

/** Name first; website optional; country from a native picker. */
export function CompanyBasicsStep({
  step,
  formId,
  busy,
  actions,
}: StepProps<"company_basics">) {
  const [name, setName] = useState(step.response?.name ?? "");
  const [website, setWebsite] = useState(step.response?.website ?? "");
  const [countryCode, setCountryCode] = useState(
    step.response?.countryCode ?? "",
  );
  const [error, setError] = useState<string | undefined>(undefined);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError("Enter the company name to continue.");
      return;
    }
    void actions.submit({
      kind: "company_basics",
      name: trimmed,
      ...(website.trim().length > 0 ? { website: website.trim() } : {}),
      ...(countryCode.length === 2 ? { countryCode } : {}),
    });
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-6">
      <StepHeading title={step.title} prompt={step.prompt} help={step.help} />
      <Input
        id="company-name"
        label="Company name"
        autoComplete="organization"
        autoFocus
        value={name}
        disabled={busy}
        error={error}
        onChange={(event) => {
          setName(event.target.value);
          setError(undefined);
        }}
      />
      <Input
        id="company-website"
        label="Website"
        description="Optional. Q can read a website later to fill gaps."
        type="text"
        inputMode="url"
        autoComplete="url"
        placeholder="example.com"
        value={website}
        disabled={busy}
        onChange={(event) => setWebsite(event.target.value)}
      />
      <Select
        id="company-country"
        label="Where is the company based?"
        description="Optional for now."
        placeholder="Choose a country"
        options={step.countries}
        value={countryCode}
        disabled={busy}
        onChange={(event) => setCountryCode(event.target.value)}
      />
    </form>
  );
}
