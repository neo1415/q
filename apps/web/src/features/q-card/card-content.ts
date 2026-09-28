import type {
  PublicCardDto,
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

/** The two image fields: their value is a signed URL, never shown as text. */
export const CARD_IMAGE_FIELDS: ReadonlySet<QCardField> = new Set([
  "photo",
  "cover",
]);

const IMAGE_LABELS: Readonly<Partial<Record<QCardField, string>>> = {
  photo: "Logo or photo",
  cover: "Cover photo",
};

export function cardFieldLabel(key: QCardField): string {
  return IMAGE_LABELS[key] ?? SPECS.get(key)?.label ?? key;
}

/** A card's text fields: everything except the image URLs. */
export function textFields(
  fields: readonly PublicCardField[],
): readonly PublicCardField[] {
  return fields.filter((field) => !CARD_IMAGE_FIELDS.has(field.key));
}

/** The signed URL of a card image the audience may see, or null. */
export function cardImage(
  fields: readonly PublicCardField[],
  key: "photo" | "cover",
): string | null {
  const value = fields.find((field) => field.key === key)?.value;
  return value !== undefined && /^https?:\/\//.test(value) ? value : null;
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

/**
 * The fields this visitor may be shown, re-checked on the page. The API's
 * projection already decides the audience (public_external for anyone,
 * network_visible too for a signed-in participant); this is the second
 * layer, so a projection bug can never put a members-only value on the
 * page an anonymous scanner sees.
 */
export function fieldsForAudience(
  card: Pick<PublicCardDto, "audience" | "fields">,
): readonly PublicCardField[] {
  return card.audience === "PARTICIPANT"
    ? card.fields
    : card.fields.filter((field) => field.scope === "public_external");
}

/** Only what anyone may see: for metadata, JSON-LD and link previews. */
export function publicExternalFields(
  fields: readonly PublicCardField[],
): readonly PublicCardField[] {
  return fields.filter((field) => field.scope === "public_external");
}

/**
 * The line that says what kind of organisation this is -- the card's
 * "role" line: "Seed · Nairobi, Kenya", "Venture capital · Kenya". Built
 * only from the fields handed in; absent parts are left out, never
 * guessed, and nothing at all returns null.
 */
export function cardDescriptor(
  subjectType: QCardSubjectType,
  fields: readonly PublicCardField[],
): string | null {
  const read = (key: QCardField): string | null => {
    const field = fields.find((candidate) => candidate.key === key);
    return field === undefined ? null : cardFieldValue(field);
  };
  const parts =
    subjectType === "COMPANY"
      ? [
          read("currentStageCode"),
          [read("headquartersCity"), read("headquartersCountry")]
            .filter((part) => part !== null)
            .join(", ") || null,
        ]
      : [read("investorType"), read("hqCountry")];
  const present = parts.filter((part) => part !== null);
  return present.length === 0 ? null : present.join(" · ");
}

/** "https://www.kivu.africa/" -> "kivu.africa", for a link's visible text. */
export function websiteLabel(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
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
