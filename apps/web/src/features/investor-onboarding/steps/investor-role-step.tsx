"use client";

import { useState, type FormEvent } from "react";

import { ChoiceList } from "@capital-q/ui/choice-list";
import { Input } from "@capital-q/ui/input";

import { useRegistrationDefaults } from "../../onboarding-kit/registration-defaults";
import { StepHeading, type StepProps } from "./step-props";
import { useT } from "@/features/i18n/language";

/**
 * I0. Investor type describes the organisation; the firm name creates or
 * names its workspace; the website (v2) is what they say it is, never a
 * verified domain; the title is descriptive only. A solo angel keeps
 * the personal workspace name. Nobody joins a firm by typing its name.
 */
export function InvestorRoleStep({
  step,
  formId,
  busy,
  actions,
}: StepProps<"investor_role">) {
  const t = useT();
  const saved = step.response;
  const [investorType, setInvestorType] = useState<string | undefined>(
    saved?.investorType,
  );
  // A saved answer wins; otherwise the firm typed at sign-up, confirmed by
  // continuing (owner directive 2026-10-16: never re-asked).
  const registered = useRegistrationDefaults().organisationName;
  const savedName =
    saved?.organisationName === undefined || saved.organisationName === ""
      ? null
      : saved.organisationName;
  const [organisationName, setOrganisationName] = useState(
    savedName ?? registered ?? "",
  );
  const fromRegistration =
    savedName === null &&
    registered !== null &&
    organisationName === registered;
  const [businessTitle, setBusinessTitle] = useState(
    saved?.businessTitle ?? "",
  );
  const [website, setWebsite] = useState(saved?.website ?? "");
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
    const site = website.trim();
    void actions.submit({
      kind: "investor_role",
      investorType,
      organisationName: name,
      ...(title.length > 0 ? { businessTitle: title } : {}),
      ...(step.offersWebsite && site.length > 0 ? { website: site } : {}),
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
        label={t("Your firm")}
        description={
          fromRegistration
            ? "From your sign-up. Typing another firm's name never joins it."
            : `Investing personally? Keep “${step.personalWorkspaceName}”. Typing another firm's name never joins it.`
        }
        autoComplete="organization"
        value={organisationName}
        disabled={busy}
        error={nameError}
        onChange={(event) => {
          setOrganisationName(event.target.value);
          setNameError(undefined);
        }}
      />
      {step.offersWebsite ? (
        <Input
          id="investor-website"
          label={t("Your firm's website")}
          description={t(
            "Optional. Founders can see who you are before they reply.",
          )}
          placeholder="example.com"
          // A text field with the URL keyboard, not type="url": the browser
          // refuses "example.com", which the write path reads as https.
          type="text"
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          autoComplete="url"
          value={website}
          disabled={busy}
          onChange={(event) => setWebsite(event.target.value)}
        />
      ) : null}
      <Input
        id="investor-title"
        label={t("Your role there")}
        description={t(
          "Optional. Shown with your name; it changes nothing you can do.",
        )}
        placeholder={t("Partner, Principal, Angel")}
        autoComplete="organization-title"
        value={businessTitle}
        disabled={busy}
        onChange={(event) => setBusinessTitle(event.target.value)}
      />
    </form>
  );
}
