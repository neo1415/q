"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@capital-q/ui/button";
import { ChoiceChip } from "@capital-q/ui/chip";
import { Input } from "@capital-q/ui/input";
import { countryName, countryOfName } from "@capital-q/taxonomy/countries";

import { useRegistrationDefaults } from "../../onboarding-kit/registration-defaults";
import type { CompanyBasicsField } from "../models/presentation";
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
 * Name first; the website; the country searched by name among every
 * country of the one canonical list (founder v8), with the browser's own
 * suggestions as they type; then (v10) the city and the year founded.
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
  const [city, setCity] = useState(step.response?.city ?? "");
  const [foundedYear, setFoundedYear] = useState(
    step.response?.foundedYear ?? "",
  );
  const [yearError, setYearError] = useState<string | undefined>(undefined);
  /**
   * D9 (re-check 2026-11-15): what they said they don't know, recorded as
   * unknown. A blank field is never taken as that: one this journey needs
   * asks for an answer or their "I don't know".
   */
  const needs = new Set(step.needsAnswer ?? []);
  const [unknown, setUnknown] = useState<ReadonlySet<CompanyBasicsField>>(
    () => new Set(step.response?.unknown ?? []),
  );
  const [cityError, setCityError] = useState<string | undefined>(undefined);
  const notKnown = (field: CompanyBasicsField) => unknown.has(field);
  const toggleUnknown = (field: CompanyBasicsField) => {
    setUnknown((now) => {
      const next = new Set(now);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
    if (field === "countryCode") setCountryError(undefined);
    if (field === "city") setCityError(undefined);
    if (field === "foundedYear") setYearError(undefined);
  };
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
    const countryWords = notKnown("countryCode") ? "" : countryText.trim();
    const countryCode =
      countryWords.length === 0 ? undefined : countryCodeOf(countryWords);
    if (countryWords.length > 0 && countryCode === undefined) {
      setCountryError(t("Choose a country from the list."));
      return;
    }
    const year = notKnown("foundedYear") ? "" : foundedYear.trim();
    if (
      step.asksCityAndYear &&
      year.length > 0 &&
      (!/^\d{4}$/u.test(year) || Number(year) > new Date().getFullYear())
    ) {
      setYearError(t("Enter the year, like 2021."));
      return;
    }
    const cityNow = notKnown("city") ? "" : city.trim();
    // A needed field left blank and not marked is asked for, never stored.
    const unanswered = (field: CompanyBasicsField, blank: boolean) =>
      needs.has(field) && blank && !notKnown(field);
    const blanks = {
      countryCode: unanswered("countryCode", countryCode === undefined),
      city: step.asksCityAndYear === true && unanswered("city", cityNow === ""),
      foundedYear:
        step.asksCityAndYear === true && unanswered("foundedYear", year === ""),
    };
    if (blanks.countryCode)
      setCountryError(t("Fill this in, or choose I don't know."));
    if (blanks.city) setCityError(t("Fill this in, or choose I don't know."));
    if (blanks.foundedYear)
      setYearError(t("Fill this in, or choose I don't know."));
    if (blanks.countryCode || blanks.city || blanks.foundedYear) return;
    const marked = [...unknown].filter(
      (field) => field === "countryCode" || step.asksCityAndYear === true,
    );
    void actions.submit({
      kind: "company_basics",
      name: trimmed,
      ...(website.trim().length > 0 ? { website: website.trim() } : {}),
      ...(countryCode === undefined ? {} : { countryCode }),
      ...(step.asksCityAndYear && cityNow.length > 0 ? { city: cityNow } : {}),
      ...(step.asksCityAndYear && year.length > 0 ? { foundedYear: year } : {}),
      ...(marked.length === 0 ? {} : { unknown: marked }),
    });
  }

  return (
    <form
      data-q-editing
      id={formId}
      onSubmit={handleSubmit}
      className="flex flex-col gap-6"
    >
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
        description={t("No website yet? Leave it empty; that's fine.")}
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
        description={t("Search for the country.")}
        placeholder={t("Choose a country")}
        list="company-country-options"
        autoComplete="country-name"
        value={notKnown("countryCode") ? "" : countryText}
        disabled={busy || notKnown("countryCode")}
        error={countryError}
        onChange={(event) => {
          setCountryText(event.target.value);
          setCountryError(undefined);
        }}
      />
      <NotKnownChoice
        field="countryCode"
        shown={needs.has("countryCode")}
        selected={notKnown("countryCode")}
        disabled={busy}
        onToggle={toggleUnknown}
      />
      <datalist id="company-country-options">
        {countries.map((country) => (
          <option key={country.value} value={country.label} />
        ))}
      </datalist>
      {step.asksCityAndYear ? (
        <>
          <Input
            id="company-city"
            label={t("City")}
            autoComplete="address-level2"
            value={notKnown("city") ? "" : city}
            disabled={busy || notKnown("city")}
            error={cityError}
            onChange={(event) => {
              setCity(event.target.value);
              setCityError(undefined);
            }}
          />
          <NotKnownChoice
            field="city"
            shown={needs.has("city")}
            selected={notKnown("city")}
            disabled={busy}
            onToggle={toggleUnknown}
          />
          <Input
            id="company-founded-year"
            label={t("Year founded")}
            inputMode="numeric"
            placeholder="2021"
            maxLength={4}
            value={notKnown("foundedYear") ? "" : foundedYear}
            disabled={busy || notKnown("foundedYear")}
            error={yearError}
            onChange={(event) => {
              setFoundedYear(event.target.value);
              setYearError(undefined);
            }}
          />
          <NotKnownChoice
            field="foundedYear"
            shown={needs.has("foundedYear")}
            selected={notKnown("foundedYear")}
            disabled={busy}
            onToggle={toggleUnknown}
          />
        </>
      ) : null}
    </form>
  );
}

/** Their explicit "I don't know" for one needed field (D9). */
function NotKnownChoice({
  field,
  shown,
  selected,
  disabled,
  onToggle,
}: {
  readonly field: CompanyBasicsField;
  readonly shown: boolean;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onToggle: (field: CompanyBasicsField) => void;
}) {
  const t = useT();
  if (!shown) return null;
  return (
    <div className="-mt-4 flex" data-not-known={field}>
      <ChoiceChip
        selected={selected}
        disabled={disabled}
        onClick={() => onToggle(field)}
      >
        {t("I don't know")}
      </ChoiceChip>
    </div>
  );
}
