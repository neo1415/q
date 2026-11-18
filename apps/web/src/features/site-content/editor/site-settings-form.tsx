"use client";

import { useState } from "react";

import type { AdminSiteSettingsDto, SiteSettings } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import { ResultLine, useConsoleAction } from "@/features/admin/console-ui";

import { saveSiteSettingsAction } from "./content-actions";

/**
 * The one record that fills {{COMPANY_NAME}} and the other placeholders on
 * every page (decision 107). Changing it changes every published page at
 * once, with no new version: the words did not change, the name did.
 */

const FIELDS: readonly {
  readonly key: keyof SiteSettings;
  readonly token: string;
  readonly label: string;
  readonly hint: string;
  readonly multiline?: true;
}[] = [
  {
    key: "companyName",
    token: "COMPANY_NAME",
    label: "Brand name",
    hint: "What the product is called on every page.",
  },
  {
    key: "legalEntity",
    token: "LEGAL_ENTITY",
    label: "Registered company name",
    hint: "The legal entity in the terms and policies.",
  },
  {
    key: "registeredAddress",
    token: "REGISTERED_ADDRESS",
    label: "Registered office address",
    hint: "As registered.",
    multiline: true,
  },
  {
    key: "contactEmail",
    token: "CONTACT_EMAIL",
    label: "Contact email",
    hint: "For privacy and data protection requests too.",
  },
  {
    key: "governingLawCity",
    token: "GOVERNING_LAW_CITY",
    label: "City for courts or arbitration",
    hint: "Named in the terms.",
  },
];

export function SiteSettingsForm({
  saved,
}: {
  readonly saved: AdminSiteSettingsDto;
}) {
  const [values, setValues] = useState<SiteSettings>(saved.settings);
  const { perform, pending, result } = useConsoleAction();
  const dirty = JSON.stringify(values) !== JSON.stringify(saved.settings);
  const set = (key: keyof SiteSettings, raw: string) =>
    setValues((current) => ({
      ...current,
      [key]: key === "companyName" ? raw : raw.trim() === "" ? null : raw,
    }));
  return (
    <form
      data-q-editing=""
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        perform(async () => {
          const outcome = await saveSiteSettingsAction({
            settings: values,
            expectedRevision: saved.revision,
          });
          return outcome.ok
            ? { ok: true, message: outcome.message }
            : {
                ok: false,
                message: outcome.message,
                ...(outcome.stepUp === true ? { stepUp: true as const } : {}),
              };
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <label
            key={field.key}
            className={`flex flex-col gap-1 ${field.multiline === true ? "sm:col-span-2" : ""}`}
          >
            <span className="cq-label text-(--cq-text-primary)">
              {field.label}{" "}
              <code className="cq-cms-placeholder-token cq-caption text-(--cq-text-secondary)">{`{{${field.token}}}`}</code>
            </span>
            <input
              value={values[field.key] ?? ""}
              onChange={(event) => set(field.key, event.target.value)}
              type={field.key === "contactEmail" ? "email" : "text"}
              className="cq-body-sm h-11 rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface) px-3 text-(--cq-text-primary)"
            />
            <span className="cq-caption text-(--cq-text-tertiary)">
              {values[field.key] === null
                ? "Not set: pages show the label in brackets."
                : field.hint}
            </span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save details"}
        </Button>
        <ResultLine result={result} />
      </div>
    </form>
  );
}
