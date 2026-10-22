import { z } from "zod";

import { DecimalStringSchema } from "../common/decimal.js";
import { UuidSchema } from "../common/ids.js";
import { CurrencyCodeSchema, MoneySchema } from "../common/money.js";
import { UtcTimestampSchema } from "../common/time.js";
import { ResourceVersionSchema } from "../common/version.js";
import {
  EvidenceStatusSchema,
  TruthClassSchema,
} from "../evidence/vocabulary.js";

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

/**
 * The card's richer sections (owner 2026-10-21, Q Story S6: "your story,
 * your numbers, your raise, your intelligence, and your relationships").
 * Each is one card field like any other -- off until the owner puts it on
 * the card and picks its audience -- and carries a structured `detail`.
 * Every number keeps its truth class and evidence status; relationships
 * are counts by stage, never names; documents are titles offered on
 * request, never the files.
 */
export const COMPANY_SECTION_CARD_FIELDS = [
  "tractionMetrics",
  "currentRaise",
  "investabilitySummary",
  "relationshipSummary",
  "team",
  "documentsOnRequest",
] as const;
export type CompanySectionCardField =
  (typeof COMPANY_SECTION_CARD_FIELDS)[number];

/**
 * Sections that can reach Capital Q members only, never a public link:
 * Q's reading is built from member-visible evidence (a public summary would
 * launder it), team members are other people, and data room titles are
 * listed only to investors who can find the company (DATA_ROOM_LISTED_LEVELS).
 * The server refuses `public_external` for these.
 */
export const NETWORK_ONLY_CARD_FIELDS = [
  "investabilitySummary",
  "team",
  "documentsOnRequest",
] as const;

/**
 * The declared fields a company card may show. The name is always public.
 * `photo` and `cover` are the subject's profile images (profile-images.ts):
 * on the card their value is a short-lived signed read URL, and they reach
 * an audience only through the same scope as any other field.
 */
export const COMPANY_CARD_FIELDS = [
  "canonicalName",
  "shortDescription",
  "currentStageCode",
  "headquartersCity",
  "headquartersCountry",
  "websiteUrl",
  "foundedDate",
  "photo",
  "cover",
  ...COMPANY_SECTION_CARD_FIELDS,
] as const;
/**
 * The investor's declared mandate, as a card may show it (founder design
 * 2026-09-28: "Investment at a glance"). Each is off until the owner puts
 * it on the card and chooses who sees it; values are the active mandate's
 * own names, "; "-separated for lists. Never the raw mandate narrative,
 * never exclusions.
 */
export const INVESTOR_MANDATE_CARD_FIELDS = [
  "mandateTypicalCheque",
  "mandateStages",
  "mandateSectors",
  "mandateBusinessModels",
  "mandateCustomerTypes",
  "mandateGeographies",
  "mandateLookFor",
] as const;

/** The declared fields an investor organisation card may show. */
export const INVESTOR_CARD_FIELDS = [
  "displayName",
  "investorType",
  "publicDescription",
  "hqCountry",
  "websiteUrl",
  "deploymentState",
  "photo",
  "cover",
  ...INVESTOR_MANDATE_CARD_FIELDS,
  /** The people who represent the firm, with their roles. */
  "team",
] as const;
export const QCardFieldSchema = z.enum([
  ...COMPANY_CARD_FIELDS,
  "displayName",
  "investorType",
  "publicDescription",
  "hqCountry",
  "deploymentState",
  ...INVESTOR_MANDATE_CARD_FIELDS,
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

const CardTruthShape = {
  truthClass: TruthClassSchema,
  evidenceStatus: EvidenceStatusSchema,
};

/**
 * One number on a card. `amount` null is unknown, never zero; money has a
 * currency, a count or a percentage has none.
 */
export const CardMetricSchema = z
  .object({
    label: z.string().min(1).max(80),
    amount: DecimalStringSchema.nullable(),
    currency: CurrencyCodeSchema.nullable(),
    /** "%", "customers": how a non-money amount reads; null for money. */
    unit: z.string().min(1).max(24).nullable(),
    /** The period the number covers, as the owner stated it ("FY2025"). */
    period: z.string().min(1).max(40).nullable(),
    ...CardTruthShape,
  })
  .strict();
export type CardMetric = z.infer<typeof CardMetricSchema>;

export const CardDetailSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("METRICS"),
      metrics: z.array(CardMetricSchema).min(1).max(8),
    })
    .strict(),
  z
    .object({
      kind: z.literal("RAISE"),
      /** The round's stage code ("seed"); null unknown. The reader labels it. */
      stageCode: z.string().min(1).max(60).nullable(),
      /** The instrument code ("safe", "equity"); null unknown. */
      instrumentCode: z.string().min(1).max(60).nullable(),
      target: MoneySchema,
      /** The owner's own words on what the money is for; null unstated. */
      useOfFunds: z.string().min(1).max(1000).nullable(),
      targetCloseDate: z.iso.date().nullable(),
      ...CardTruthShape,
    })
    .strict(),
  z
    .object({
      kind: z.literal("INTELLIGENCE"),
      /**
       * Q's investor-facing InvestIQ reading (never the founder-private
       * readiness diagnosis), labelled as Q's: a band and a confidence in
       * words, never a percentage. INSUFFICIENT_EVIDENCE is unknown, not poor.
       */
      status: z.enum(["ASSESSED", "INSUFFICIENT_EVIDENCE"]),
      band: z.string().min(1).max(60).nullable(),
      confidence: z.string().min(1).max(60).nullable(),
      /** The strongest areas, by name ("Traction"), best first. */
      strengths: z.array(z.string().min(1).max(80)).max(3),
      areasScored: z.number().int().min(0).max(16),
      areasTotal: z.number().int().min(0).max(16),
      method: z.string().min(1).max(80),
      assessedAt: UtcTimestampSchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("RELATIONSHIPS"),
      /** Investor conversations by stage: counts only, never who. */
      stages: z
        .array(
          z
            .object({
              label: z.string().min(1).max(60),
              count: z.number().int().min(1),
            })
            .strict(),
        )
        .min(1)
        .max(8),
    })
    .strict(),
  z
    .object({
      kind: z.literal("TEAM"),
      members: z
        .array(
          z
            .object({
              name: z.string().min(1).max(120),
              role: z.string().min(1).max(120).nullable(),
            })
            .strict(),
        )
        .min(1)
        .max(12),
    })
    .strict(),
  z
    .object({
      kind: z.literal("DOCUMENTS"),
      /** Titles only: the files stay in the data room, behind a request. */
      documents: z
        .array(
          z
            .object({
              title: z.string().min(1).max(160),
              category: z.string().min(1).max(60).nullable(),
            })
            .strict(),
        )
        .min(1)
        .max(20),
    })
    .strict(),
]);
export type CardDetail = z.infer<typeof CardDetailSchema>;

export const PublicCardFieldSchema = z
  .object({
    key: QCardFieldSchema,
    /** The machine value (a stage code, a country code, a date); the reader labels it. */
    value: z.string().min(1).max(2048),
    scope: QCardScopeSchema,
    /** A section's structured content (COMPANY_SECTION_CARD_FIELDS, team). */
    detail: CardDetailSchema.optional(),
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
    fields: z.array(PublicCardFieldSchema).max(24),
    verified: z.array(z.enum(PUBLIC_VERIFICATION_LABELS)).max(2),
    /**
     * The subset of `verified` that rests on the synthetic-demo attestation
     * (demo data on a demo deployment, not a real-world check). A surface
     * must never present these as Capital Q's verification.
     */
    demoAttested: z.array(z.enum(PUBLIC_VERIFICATION_LABELS)).max(2),
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
