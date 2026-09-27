import {
  COMPANY_CITY_MAX_LENGTH,
  COMPANY_NAME_MAX_LENGTH,
  COMPANY_PRIMARY_DESCRIPTION_MAX_LENGTH,
  COMPANY_SHORT_DESCRIPTION_MAX_LENGTH,
  INVESTOR_DISPLAY_NAME_MAX_LENGTH,
  INVESTOR_PUBLIC_DESCRIPTION_MAX_LENGTH,
  PERSON_DISPLAY_NAME_MAX_LENGTH,
  PERSON_HEADLINE_MAX_LENGTH,
  type CompanyEditableField,
  type InvestorDeploymentState,
  type InvestorEditableField,
  type InvestorType,
  type PersonEditableField,
} from "@capital-q/contracts";
import { COUNTRY_OPTIONS, STAGE_OPTIONS } from "@capital-q/founder-onboarding";
import { formatLongDay } from "@/components/date-format";

/**
 * The editable profile fields (BIZ-002), as the page presents them.
 *
 * Pure description: which contract field a row edits, how it is labelled
 * and entered, and how a stored value reads. No rule about what may be
 * stored lives here -- the contract schemas validate in the server action
 * and the owning context validates again -- so a field shown here can only
 * be as permissive as the write path behind it.
 */

export type ProfileKind = "PERSON" | "COMPANY" | "INVESTOR_ORGANISATION";

export type FieldInput =
  | { readonly kind: "text"; readonly maxLength: number }
  | { readonly kind: "url" }
  | { readonly kind: "date" }
  | { readonly kind: "textarea"; readonly maxLength: number }
  | {
      readonly kind: "select";
      readonly options: readonly {
        readonly value: string;
        readonly label: string;
      }[];
    };

export type FieldSpec<F extends string> = {
  readonly field: F;
  readonly label: string;
  /** Helps the person enter it; never the accessible name. */
  readonly hint?: string | undefined;
  readonly input: FieldInput;
  /** False for a field that must always hold something (a name). */
  readonly clearable: boolean;
};

const STAGES = STAGE_OPTIONS.filter(
  (option) => option.optionKey !== "unsure",
).map((option) => ({ value: option.optionKey, label: option.label }));

/** Option keys are lowercase ISO codes; profiles store them uppercase. */
const COUNTRIES = COUNTRY_OPTIONS.map((option) => ({
  value: option.optionKey.toUpperCase(),
  label: option.label,
}));

const INVESTOR_TYPE_LABELS: Readonly<Record<InvestorType, string>> = {
  ANGEL: "Angel investor",
  VC: "Venture capital firm",
  FAMILY_OFFICE: "Family office",
  CVC: "Corporate venture capital",
  SYNDICATE: "Syndicate",
  ACCELERATOR: "Accelerator",
  SCOUT: "Scout",
  INSTITUTIONAL: "Institutional investor",
  OTHER: "Other",
};

const DEPLOYMENT_LABELS: Readonly<Record<InvestorDeploymentState, string>> = {
  ACTIVELY_INVESTING: "Actively investing",
  SELECTIVE: "Investing selectively",
  PAUSED: "Paused",
  EXPLORING_ONLY: "Exploring only",
};

export const PERSON_FIELDS: readonly FieldSpec<PersonEditableField>[] = [
  {
    field: "displayName",
    label: "Name",
    hint: "What Capital Q and the people you work with call you.",
    input: { kind: "text", maxLength: PERSON_DISPLAY_NAME_MAX_LENGTH },
    clearable: false,
  },
  {
    field: "headline",
    label: "Headline",
    hint: "One line about you, such as “Founder, Kivu Freight” or “Angel investor in climate”.",
    input: { kind: "text", maxLength: PERSON_HEADLINE_MAX_LENGTH },
    clearable: true,
  },
];

export const COMPANY_FIELDS: readonly FieldSpec<CompanyEditableField>[] = [
  {
    field: "canonicalName",
    label: "Company name",
    input: { kind: "text", maxLength: COMPANY_NAME_MAX_LENGTH },
    clearable: false,
  },
  {
    field: "shortDescription",
    label: "In one line",
    hint: "The sentence an investor reads first.",
    input: { kind: "text", maxLength: COMPANY_SHORT_DESCRIPTION_MAX_LENGTH },
    clearable: true,
  },
  {
    field: "primaryDescription",
    label: "Description",
    hint: "What you do, for whom, and why now.",
    input: {
      kind: "textarea",
      maxLength: COMPANY_PRIMARY_DESCRIPTION_MAX_LENGTH,
    },
    clearable: true,
  },
  {
    field: "currentStageCode",
    label: "Stage",
    input: { kind: "select", options: STAGES },
    clearable: true,
  },
  {
    field: "websiteUrl",
    label: "Website",
    hint: "A full address, such as https://example.com.",
    input: { kind: "url" },
    clearable: true,
  },
  {
    field: "headquartersCity",
    label: "City",
    input: { kind: "text", maxLength: COMPANY_CITY_MAX_LENGTH },
    clearable: true,
  },
  {
    field: "headquartersCountry",
    label: "Country",
    input: { kind: "select", options: COUNTRIES },
    clearable: true,
  },
  {
    field: "foundedDate",
    label: "Founded",
    input: { kind: "date" },
    clearable: true,
  },
  {
    field: "legalName",
    label: "Legal name",
    hint: "As registered, if it differs from the company name.",
    input: { kind: "text", maxLength: COMPANY_NAME_MAX_LENGTH },
    clearable: true,
  },
];

export const INVESTOR_FIELDS: readonly FieldSpec<InvestorEditableField>[] = [
  {
    field: "displayName",
    label: "Name",
    input: { kind: "text", maxLength: INVESTOR_DISPLAY_NAME_MAX_LENGTH },
    clearable: false,
  },
  {
    field: "investorType",
    label: "Type",
    input: {
      kind: "select",
      options: Object.entries(INVESTOR_TYPE_LABELS).map(([value, label]) => ({
        value,
        label,
      })),
    },
    clearable: false,
  },
  {
    field: "publicDescription",
    label: "Description",
    hint: "What founders should know about how you invest.",
    input: {
      kind: "textarea",
      maxLength: INVESTOR_PUBLIC_DESCRIPTION_MAX_LENGTH,
    },
    clearable: true,
  },
  {
    field: "deploymentState",
    label: "Deploying capital",
    input: {
      kind: "select",
      options: Object.entries(DEPLOYMENT_LABELS).map(([value, label]) => ({
        value,
        label,
      })),
    },
    clearable: true,
  },
  {
    field: "websiteUrl",
    label: "Website",
    hint: "A full address, such as https://example.com.",
    input: { kind: "url" },
    clearable: true,
  },
  {
    field: "hqCountry",
    label: "Country",
    input: { kind: "select", options: COUNTRIES },
    clearable: true,
  },
];

/**
 * How a stored value reads. Codes never reach a reader as codes; a value a
 * select does not know is shown as stored rather than hidden.
 */
export function displayValue(
  input: FieldInput,
  value: string | null,
): string | null {
  if (value === null) return null;
  if (input.kind === "select") {
    return (
      input.options.find((option) => option.value === value)?.label ??
      value.replace(/_/g, " ")
    );
  }
  if (input.kind === "date") {
    return formatLongDay(value);
  }
  return value;
}

/**
 * What the person typed, as the write path expects it: trimmed, empty
 * meaning "clear" (null) where the field may be cleared, and a website
 * given without a scheme read as https -- the same reading Q's write
 * path applies, so both front doors store the same thing.
 */
export function normaliseDraft(
  spec: FieldSpec<string>,
  draft: string,
):
  | { readonly ok: true; readonly value: string | null }
  | {
      readonly ok: false;
      readonly message: string;
    } {
  const trimmed = draft.trim();
  if (trimmed.length === 0) {
    return spec.clearable
      ? { ok: true, value: null }
      : { ok: false, message: `${spec.label} can't be empty.` };
  }
  if (spec.input.kind === "url") {
    return {
      ok: true,
      value: /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    };
  }
  if (
    (spec.input.kind === "text" || spec.input.kind === "textarea") &&
    trimmed.length > spec.input.maxLength
  ) {
    return {
      ok: false,
      message: `${spec.label} can be at most ${String(spec.input.maxLength)} characters.`,
    };
  }
  return { ok: true, value: trimmed };
}
