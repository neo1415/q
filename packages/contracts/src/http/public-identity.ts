import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import { ResourceVersionSchema } from "../common/version.js";

/**
 * Handles and the Q Card (BIZ-004).
 *
 * A handle is a display route (`/@kivu-freight`), never an identifier the
 * system trusts: the canonical UUID stays the identity. The Q Card is the
 * owner's deliberate choice of which declared profile fields appear on the
 * shareable card and to whom -- `public_external` (anyone with the link) or
 * `network_visible` (signed-in Capital Q participants). Nothing narrower is
 * expressible, so founder-private or organisation-private data has no way
 * onto a card. The card is a presentation over the canonical profile;
 * nothing is copied.
 */

export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 30;
/** Lowercase letters, digits and single hyphens, never at either end. */
export const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
/** How long a renamed-away handle redirects and stays unclaimable. */
export const HANDLE_HOLD_DAYS = 90;

export const HandleSchema = z
  .string()
  .regex(HANDLE_PATTERN, "expected 3-30 lowercase letters, digits or hyphens")
  .refine((value) => !value.includes("--"), {
    message: "expected no double hyphens",
  });
export type Handle = z.infer<typeof HandleSchema>;

export const Q_CARD_SUBJECT_TYPES = [
  "COMPANY",
  "INVESTOR_ORGANISATION",
] as const;
export const QCardSubjectTypeSchema = z.enum(Q_CARD_SUBJECT_TYPES);
export type QCardSubjectType = z.infer<typeof QCardSubjectTypeSchema>;

/** The only two audiences a card field can have. */
export const Q_CARD_SCOPES = ["public_external", "network_visible"] as const;
export const QCardScopeSchema = z.enum(Q_CARD_SCOPES);
export type QCardScope = z.infer<typeof QCardScopeSchema>;

/** The declared fields a company card may show. The name is always public. */
export const COMPANY_CARD_FIELDS = [
  "canonicalName",
  "shortDescription",
  "currentStageCode",
  "headquartersCity",
  "headquartersCountry",
  "websiteUrl",
  "foundedDate",
] as const;
/** The declared fields an investor organisation card may show. */
export const INVESTOR_CARD_FIELDS = [
  "displayName",
  "investorType",
  "publicDescription",
  "hqCountry",
  "websiteUrl",
  "deploymentState",
] as const;
export const QCardFieldSchema = z.enum([
  ...COMPANY_CARD_FIELDS,
  "displayName",
  "investorType",
  "publicDescription",
  "hqCountry",
  "deploymentState",
]);
export type QCardField = z.infer<typeof QCardFieldSchema>;

/** Partial: a field absent from the map is not on the card. */
export const QCardFieldScopesSchema = z.partialRecord(
  QCardFieldSchema,
  QCardScopeSchema,
);
export type QCardFieldScopes = z.infer<typeof QCardFieldScopesSchema>;

export const Q_CARDS_PATH = "/v1/q-cards" as const;
/** `/v1/q-cards/:subjectType/:subjectId` and its `/handle` child. */
export const Q_CARD_HANDLE_SEGMENT = "/handle" as const;

export const QCardDtoSchema = z
  .object({
    subjectType: QCardSubjectTypeSchema,
    subjectId: UuidSchema,
    /** Null until the organisation claims one. */
    handle: HandleSchema.nullable(),
    /** The opaque short code the QR encodes (`/c/<code>`). */
    publicCode: z.string().regex(/^[a-z0-9]{10}$/),
    fieldScopes: QCardFieldScopesSchema,
    indexable: z.boolean(),
    /** First-party, aggregate only: never who. */
    scansLast30Days: z.number().int().min(0),
    version: ResourceVersionSchema,
    updatedAt: UtcTimestampSchema,
  })
  .strict();
export type QCardDto = z.infer<typeof QCardDtoSchema>;

export const ClaimHandleRequestSchema = z
  .object({
    /** Case and a leading "@" are forgiven; the server normalises. */
    handle: z.string().trim().min(1).max(40),
  })
  .strict();
export type ClaimHandleRequest = z.infer<typeof ClaimHandleRequestSchema>;

export const UpdateQCardRequestSchema = z
  .object({
    expectedVersion: ResourceVersionSchema,
    fieldScopes: QCardFieldScopesSchema.optional(),
    indexable: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => value.fieldScopes !== undefined || value.indexable !== undefined,
    { message: "expected at least one change" },
  );
export type UpdateQCardRequest = z.infer<typeof UpdateQCardRequestSchema>;

// ---------------------------------------------------------------------------
// Public reads
// ---------------------------------------------------------------------------

export const PUBLIC_HANDLES_PATH = "/v1/public/handles" as const;
export const PUBLIC_CARD_CODES_PATH = "/v1/public/cards" as const;

export const PublicCardFieldSchema = z
  .object({
    key: QCardFieldSchema,
    /** The machine value (a stage code, a country code, a date); the reader labels it. */
    value: z.string().min(1).max(2048),
    scope: QCardScopeSchema,
  })
  .strict();
export type PublicCardField = z.infer<typeof PublicCardFieldSchema>;

/** A claim Capital Q verified, said exactly (never a general "verified"). */
export const PUBLIC_VERIFICATION_LABELS = [
  "ORGANISATION_VERIFIED",
  "FOUNDER_IDENTITY_VERIFIED",
] as const;

export const PublicCardDtoSchema = z
  .object({
    kind: z.literal("CARD"),
    handle: HandleSchema,
    subjectType: QCardSubjectTypeSchema,
    name: z.string().min(1).max(200),
    /** Only fields the audience may see; public first, then network. */
    fields: z.array(PublicCardFieldSchema).max(12),
    verified: z.array(z.enum(PUBLIC_VERIFICATION_LABELS)).max(2),
    /** Who this projection was built for. */
    audience: z.enum(["PUBLIC", "PARTICIPANT"]),
    indexable: z.boolean(),
  })
  .strict();
export type PublicCardDto = z.infer<typeof PublicCardDtoSchema>;

/** An old handle, held or retired: send the reader to the current one. */
export const PublicHandleRedirectDtoSchema = z
  .object({
    kind: z.literal("REDIRECT"),
    handle: HandleSchema,
  })
  .strict();

export const PublicHandleResponseSchema = z.discriminatedUnion("kind", [
  PublicCardDtoSchema,
  PublicHandleRedirectDtoSchema,
]);
export type PublicHandleResponse = z.infer<typeof PublicHandleResponseSchema>;

/** A card short code resolved: where the QR sends the reader. */
export const PublicCardCodeDtoSchema = z
  .object({ handle: HandleSchema })
  .strict();
export type PublicCardCodeDto = z.infer<typeof PublicCardCodeDtoSchema>;
