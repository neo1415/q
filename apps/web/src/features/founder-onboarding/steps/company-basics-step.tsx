"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@capital-q/ui/button";
import { Input } from "@capital-q/ui/input";
import { countryName, countryOfName } from "@capital-q/taxonomy/countries";

import { useRegistrationDefaults } from "../../onboarding-kit/registration-defaults";
import { StepHeading, type StepProps } from "./step-props";
import { useT, useUiLanguage } from "@/features/i18n/language";

/** "https://www.acme.com/" read as "acme.com". */
function displayHost(url: string): string {
  return url
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "");
}

/**
 * Name first; website optional; the country searched by name among every
 * country of the one canonical list (founder v8), with the browser's own
 * suggestions as they type.
 */
export function CompanyBasicsStep({
  step,
  formId,
  busy,
  actions,
}: StepProps<"company_basics">) {
  const t = useT();
  // A saved answer wins; otherwise what they typed at sign-up, which they
  // confirm by continuing (owner directive 2026-10-16: never re-asked).
  const registered = useRegistrationDefaults().organisationName;
  const fromRegistration =
    step.response?.name === undefined && registered !== null;
  const [name, setName] = useState(step.response?.name ?? registered ?? "");
  const [website, setWebsite] = useState(step.response?.website ?? "");
  const language = useUiLanguage();
  // Each country in the reader's language (Arabic from the platform's
  // ICU names), the canonical English name otherwise.
  const countries = step.countries.map((c) => ({
    value: c.value,
    label: countryName(c.value, language) ?? c.label,
    english: c.label,
  }));
  const nameOf = (code: string | undefined) =>
    countries.find((c) => c.value === code)?.label ?? "";
  const [countryText, setCountryText] = useState(
    nameOf(step.response?.countryCode),
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const [countryError, setCountryError] = useState<string | undefined>(
    undefined,
  );
  /** The offered country these words name, exactly; undefined for none. */
  const countryCodeOf = (words: string): string | undefined => {
    const wanted = words.trim().toLowerCase();
    const listed = countries.find(
      (c) =>
        c.label.toLowerCase() === wanted || c.english.toLowerCase() === wanted,
    )?.value;
    const iso = listed ?? countryOfName(words)?.iso;
    return countries.some((c) => c.value === iso) ? iso : undefined;
  };

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError("Enter the company name to continue.");
      return;
    }
    const countryCode =
      countryText.trim().length === 0 ? undefined : countryCodeOf(countryText);
    if (countryText.trim().length > 0 && countryCode === undefined) {
      setCountryError(t("Choose a country from the list."));
      return;
    }
    void actions.submit({
      kind: "company_basics",
      name: trimmed,
      ...(website.trim().length > 0 ? { website: website.trim() } : {}),
      ...(countryCode === undefined ? {} : { countryCode }),
    });
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-6">
      <StepHeading title={step.title} prompt={step.prompt} help={step.help} />
      <Input
        id="company-name"
        label={t("Company name")}
        description={
          fromRegistration && name === registered
            ? "From your sign-up. Change it if the company is called something else."
            : undefined
        }
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
        label={t("Website")}
        description={t("Optional. Q can read a website later to fill gaps.")}
        type="text"
        inputMode="url"
        autoComplete="url"
        placeholder="example.com"
        value={website}
        disabled={busy}
        onChange={(event) => setWebsite(event.target.value)}
      />
      {step.suggestedWebsite !== undefined && website.trim().length === 0 ? (
        // What Q's research found, offered in place: one tap fills it,
        // and nothing is recorded until they continue.
        <div
          className="flex flex-wrap items-center gap-2"
          data-suggested-website
        >
          <span className="cq-body-sm text-(--cq-text-secondary)">
            Q found {displayHost(step.suggestedWebsite)}. Is that yours?
          </span>
          <Button
            variant="secondary"
            size="compact"
            disabled={busy}
            onClick={() => {
              setWebsite(step.suggestedWebsite ?? "");
            }}
          >
            {t("Use it")}
          </Button>
        </div>
      ) : null}
      <Input
        id="company-country"
        label={t("Where is the company based?")}
        description={t("Optional for now. Search for the country.")}
        placeholder={t("Choose a country")}
        list="company-country-options"
        autoComplete="country-name"
        value={countryText}
        disabled={busy}
        error={countryError}
        onChange={(event) => {
          setCountryText(event.target.value);
          setCountryError(undefined);
        }}
      />
      <datalist id="company-country-options">
        {countries.map((country) => (
          <option key={country.value} value={country.label} />
        ))}
      </datalist>
    </form>
  );
}
