import {
  type CardDetail,
  COMPANY_CARD_FIELDS,
  INVESTOR_CARD_FIELDS,
  NETWORK_ONLY_CARD_FIELDS,
  PERSON_CARD_FIELDS,
  QCardFieldScopesSchema,
  type PublicCardField,
  type QCardField,
  type QCardFieldScopes,
  type QCardScope,
  type QCardSubjectType,
} from "@capital-q/contracts";

/**
 * The Q Card, pure (BIZ-004).
 *
 * The card is an allowlist, not a redaction: a closed set of declared
 * fields per subject type, each shown to an audience the owner chose.
 * Anything not in the set -- financials, the capital objective, anything a
 * founder holds privately -- has no key here and so no way onto a card,
 * whatever the canonical row holds. The name is always public: a public
 * page about an unnamed subject would be no page at all.
 */

export const CARD_FIELDS: Readonly<
  Record<QCardSubjectType, readonly QCardField[]>
> = {
  COMPANY: COMPANY_CARD_FIELDS,
  INVESTOR_ORGANISATION: INVESTOR_CARD_FIELDS,
  PERSON: PERSON_CARD_FIELDS,
};

export const NAME_FIELD: Readonly<Record<QCardSubjectType, QCardField>> = {
  COMPANY: "canonicalName",
  INVESTOR_ORGANISATION: "displayName",
  PERSON: "displayName",
};

/**
 * The logo or photo has the name's scope, always (founder decision
 * 2026-10-04: "they're literally profile pictures"): whoever may see the
 * name may see the picture beside it. Only the cover keeps its own scope.
 */
function PINNED_TO_NAME(subjectType: QCardSubjectType): QCardFieldScopes {
  return {
    [NAME_FIELD[subjectType]]: "public_external",
    photo: "public_external",
  };
}

/**
 * A new card's defaults: identity-level facts public, the rest to the
 * network. The owner sees and changes every one before sharing.
 */
export const DEFAULT_FIELD_SCOPES: Readonly<
  Record<QCardSubjectType, QCardFieldScopes>
> = {
  COMPANY: {
    canonicalName: "public_external",
    photo: "public_external",
    cover: "public_external",
    shortDescription: "public_external",
    websiteUrl: "public_external",
    currentStageCode: "network_visible",
    headquartersCity: "network_visible",
    headquartersCountry: "network_visible",
    foundedDate: "network_visible",
  },
  INVESTOR_ORGANISATION: {
    displayName: "public_external",
    photo: "public_external",
    cover: "public_external",
    investorType: "public_external",
    publicDescription: "public_external",
    websiteUrl: "public_external",
    hqCountry: "network_visible",
    deploymentState: "network_visible",
  },
  // A person's card: who they are and where they work is identity-level;
  // where they live and what they're after start with members.
  PERSON: {
    displayName: "public_external",
    photo: "public_external",
    headline: "public_external",
    roleTitle: "public_external",
    affiliation: "public_external",
    countryCode: "network_visible",
    personFocus: "network_visible",
  },
};

const NETWORK_ONLY: ReadonlySet<string> = new Set(NETWORK_ONLY_CARD_FIELDS);

/** A section that may reach members only, never anyone with the link. */
export function isNetworkOnly(key: QCardField): boolean {
  return NETWORK_ONLY.has(key);
}

/**
 * A section's content per audience scope. Content whose own rows carry a
 * scope (claims, data room levels) is built twice: what may be shown to
 * anyone, and what may be shown to members. A section the owner made
 * public then never carries an item its row keeps to members.
 */
export type CardSectionDetails = Readonly<
  Record<string, Readonly<Partial<Record<QCardScope, CardDetail | null>>>>
>;

export type CardScopesReading =
  | { readonly ok: true; readonly scopes: QCardFieldScopes }
  | { readonly ok: false; readonly fields: readonly string[] };

/**
 * Fit requested scopes to the subject type: every key must be one of its
 * card fields, and the name (and the photo with it) stays public
 * whatever was asked.
 */
export function fitFieldScopes(
  subjectType: QCardSubjectType,
  requested: QCardFieldScopes,
): CardScopesReading {
  const allowed = new Set<string>(CARD_FIELDS[subjectType]);
  const misplaced = Object.entries(requested)
    .filter(
      ([key, scope]) =>
        !allowed.has(key) ||
        (scope === "public_external" && NETWORK_ONLY.has(key)),
    )
    .map(([key]) => key);
  if (misplaced.length > 0) return { ok: false, fields: misplaced };
  return {
    ok: true,
    scopes: { ...requested, ...PINNED_TO_NAME(subjectType) },
  };
}

/** Stored scopes read back defensively: anything unknown is dropped. */
export function readStoredScopes(
  subjectType: QCardSubjectType,
  stored: unknown,
): QCardFieldScopes {
  const parsed = QCardFieldScopesSchema.safeParse(stored);
  if (!parsed.success) return { ...PINNED_TO_NAME(subjectType) };
  const allowed = new Set<string>(CARD_FIELDS[subjectType]);
  const scopes: Partial<Record<QCardField, QCardScope>> = {};
  for (const [key, scope] of Object.entries(parsed.data)) {
    if (allowed.has(key) && scope !== undefined) {
      // Never wider than a section may go, whatever was stored.
      scopes[key as QCardField] = NETWORK_ONLY.has(key)
        ? "network_visible"
        : scope;
    }
  }
  return { ...scopes, ...PINNED_TO_NAME(subjectType) };
}

/**
 * Owner 23 Oct 2026: whether a company's Q Card shows its current raise to
 * every signed-in Capital Q participant. Both card scopes reach them
 * (network_visible, and public_external, which is wider), so any stored
 * `currentRaise` scope on an ACTIVE card means yes; a revoked card, a
 * malformed record or no scope means no.
 */
export function companyCardSharesRaise(
  card: { readonly status: string; readonly fieldScopes: unknown } | null,
): boolean {
  if (card === null || card.status !== "ACTIVE") return false;
  return (
    readStoredScopes("COMPANY", card.fieldScopes).currentRaise !== undefined
  );
}

export type CardAudience = "PUBLIC" | "PARTICIPANT";

/**
 * The fields an audience may see, from the subject's declared facts.
 *
 * PUBLIC (anyone with the link) sees public_external fields only. A
 * PARTICIPANT (a signed-in Capital Q person) additionally sees
 * network_visible ones. A field with no value is left out -- unknown is
 * not shown as blank on a public page, and never as zero. A section's
 * structured detail travels only beside its own field, under that field's
 * scope: a detail with no field never reaches anyone.
 */
export function projectCardFields(
  subjectType: QCardSubjectType,
  scopes: QCardFieldScopes,
  facts: Readonly<Record<string, string | null | undefined>>,
  audience: CardAudience,
  details: CardSectionDetails = {},
): PublicCardField[] {
  const fields: PublicCardField[] = [];
  const name = NAME_FIELD[subjectType];
  for (const wanted of ["public_external", "network_visible"] as const) {
    if (wanted === "network_visible" && audience !== "PARTICIPANT") break;
    for (const key of CARD_FIELDS[subjectType]) {
      if (key === name || scopes[key] !== wanted) continue;
      if (wanted === "public_external" && NETWORK_ONLY.has(key)) continue;
      const value = facts[key];
      if (typeof value !== "string" || value.trim().length === 0) continue;
      const sectioned = details[key];
      const detail = sectioned?.[wanted];
      // A section shows only with content built for this very scope.
      if (sectioned !== undefined && (detail === null || detail === undefined))
        continue;
      fields.push({
        key,
        value: value.slice(0, 2048),
        scope: wanted,
        ...(detail === null || detail === undefined ? {} : { detail }),
      });
    }
  }
  return fields;
}
