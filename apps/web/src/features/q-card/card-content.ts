import type {
  PublicCardField,
  QCardField,
  QCardSubjectType,
} from "@capital-q/contracts";

import {
  COMPANY_FIELDS,
  INVESTOR_FIELDS,
  displayValue,
  type FieldSpec,
} from "@/features/profile/profile-fields";

/**
 * How a Q Card reads (BIZ-004): labels and values in the words the owner
 * chose them by -- never a code ("seed", "KE") -- from the same field
 * definitions the profile page edits with, so the card and the profile
 * cannot describe one value two ways.
 */

const SPECS: ReadonlyMap<string, FieldSpec<string>> = new Map(
  [...COMPANY_FIELDS, ...INVESTOR_FIELDS].map((spec) => [spec.field, spec]),
);

export function cardFieldLabel(key: QCardField): string {
  return SPECS.get(key)?.label ?? key;
}

export function cardFieldValue(field: PublicCardField): string {
  const spec = SPECS.get(field.key);
  return spec === undefined
    ? field.value
    : (displayValue(spec.input, field.value) ?? field.value);
}

/** The line under the name: the one-liner the owner chose to show, if any. */
export function cardTagline(
  subjectType: QCardSubjectType,
  fields: readonly PublicCardField[],
): string | null {
  const key =
    subjectType === "COMPANY" ? "shortDescription" : "publicDescription";
  const found = fields.find((field) => field.key === key);
  if (found === undefined) return null;
  return found.value.length > 180
    ? `${found.value.slice(0, 177)}…`
    : found.value;
}

/** A handle suggestion from a name: lowercase, hyphenated, trimmed to fit. */
export function suggestHandle(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "");
  return slug.length >= 3 ? slug : `${slug}-q`.replace(/^-/, "");
}

export function cardPath(handle: string): string {
  return `/@${handle}`;
}

export function shortLinkPath(code: string): string {
  return `/c/${code}`;
}
