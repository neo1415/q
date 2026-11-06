import { z } from "zod";

import { UuidSchema } from "../common/ids.js";

/**
 * Engagement analytics (Q Workspace §8 A1-A3; Product Specification
 * §6.7.12-6.7.14).
 *
 *   ANALYTICS ≠ DOMAIN EVENT. A view is observed behaviour: never interest,
 *   never relationship state, never a ranking input, never contact
 *   permission.
 *
 * The ingest carries no viewer, organisation, tenant or visibility: the
 * server resolves who is looking from the actor context, and the database
 * stamps the viewer's privacy level. A client can only say what was on its
 * screen and for how long.
 */

export const ENGAGEMENT_EVENTS_PATH = "/v1/engagement/events" as const;
export const VIEWING_PRIVACY_PATH = "/v1/engagement/viewing-privacy" as const;
export const COMPANY_ENGAGEMENT_PATH =
  "/v1/engagement/companies/:companyId" as const;

export const ENGAGEMENT_VERSION = "engagement.v1" as const;

export const ENGAGEMENT_TYPES = [
  "PROFILE_VIEW",
  "DECK_OPEN",
  "DECK_SLIDE_DWELL",
  "VIDEO_WATCH",
  "Q_CARD_VIEW",
  "DATA_ROOM_DOCUMENT_VIEW",
] as const;
export const EngagementTypeSchema = z.enum(ENGAGEMENT_TYPES);
export type EngagementType = z.infer<typeof EngagementTypeSchema>;

/** §6.7.13. Persisted uppercase in analytics.viewing_privacy_settings. */
export const VIEWING_VISIBILITIES = [
  "FULL_IDENTITY",
  "ORGANISATION_ONLY",
  "ANONYMOUS",
] as const;
export const ViewingVisibilitySchema = z.enum(VIEWING_VISIBILITIES);
export type ViewingVisibility = z.infer<typeof ViewingVisibilitySchema>;

/**
 * Display mirror of `analytics.default_viewing_visibility()`. The database
 * value is the enforcement; this only labels the setting for a person who
 * has not chosen. Pending the owner's confirmation (Q Workspace §8 A2).
 */
export const DEFAULT_VIEWING_VISIBILITY: ViewingVisibility =
  "ORGANISATION_ONLY";

/** Mirror of `analytics.engagement_floor()` and results ENGAGEMENT_FLOOR. */
export const ENGAGEMENT_ORGANISATION_FLOOR = 3;

/** One hour: the database ceiling for a single event's duration. */
export const ENGAGEMENT_MAX_DURATION_MS = 3_600_000;
export const ENGAGEMENT_BATCH_MAX = 25;

const ClientIdSchema = z.string().regex(/^[A-Za-z0-9_:-]{8,64}$/);
const DurationSchema = z.number().int().min(0).max(ENGAGEMENT_MAX_DURATION_MS);

const base = {
  clientEventId: ClientIdSchema,
  sessionId: ClientIdSchema.optional(),
  companyId: UuidSchema,
  occurredAt: z.iso.datetime({ offset: true }),
};

export const EngagementEventInputSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("PROFILE_VIEW") }).strict(),
  z.object({ ...base, type: z.literal("Q_CARD_VIEW") }).strict(),
  z
    .object({ ...base, type: z.literal("DECK_OPEN"), documentId: UuidSchema })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("DECK_SLIDE_DWELL"),
      documentId: UuidSchema,
      slideNumber: z.number().int().min(1).max(500),
      durationMs: DurationSchema,
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("VIDEO_WATCH"),
      mediaAssetId: UuidSchema,
      durationMs: DurationSchema,
      maxPositionMs: z.number().int().min(0).max(86_400_000).optional(),
      mediaDurationMs: z.number().int().min(1).max(86_400_000).optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("DATA_ROOM_DOCUMENT_VIEW"),
      documentId: UuidSchema,
      durationMs: DurationSchema.optional(),
    })
    .strict(),
]);
export type EngagementEventInput = z.infer<typeof EngagementEventInputSchema>;

export const RecordEngagementBatchRequestSchema = z
  .object({
    events: z
      .array(EngagementEventInputSchema)
      .min(1)
      .max(ENGAGEMENT_BATCH_MAX),
  })
  .strict();
export type RecordEngagementBatchRequest = z.infer<
  typeof RecordEngagementBatchRequestSchema
>;

/**
 * Counts only. Which events were refused, and why, is not said: a reason
 * per event would let a caller probe which companies and documents exist.
 */
export const RecordEngagementBatchResponseSchema = z
  .object({
    accepted: z.number().int().min(0),
    deduplicated: z.number().int().min(0),
    dropped: z.number().int().min(0),
  })
  .strict();
export type RecordEngagementBatchResponse = z.infer<
  typeof RecordEngagementBatchResponseSchema
>;

export const ViewingPrivacyDtoSchema = z
  .object({
    visibility: ViewingVisibilitySchema,
    /** False when the person has never chosen and the default applies. */
    chosen: z.boolean(),
    defaultVisibility: ViewingVisibilitySchema,
  })
  .strict();
export type ViewingPrivacyDto = z.infer<typeof ViewingPrivacyDtoSchema>;

export const UpdateViewingPrivacyRequestSchema = z
  .object({ visibility: ViewingVisibilitySchema })
  .strict();
export type UpdateViewingPrivacyRequest = z.infer<
  typeof UpdateViewingPrivacyRequestSchema
>;

// ---------------------------------------------------------------------------
// The founder-facing projection (A3). Identity is already redacted by SQL.
// ---------------------------------------------------------------------------

export const EngagementViewerDtoSchema = z
  .object({
    visibility: ViewingVisibilitySchema,
    /** Only for FULL_IDENTITY. */
    viewerUserId: UuidSchema.nullable(),
    /** FULL_IDENTITY and ORGANISATION_ONLY. */
    viewerOrganisationId: UuidSchema.nullable(),
    viewerName: z.string().nullable(),
    organisationName: z.string().nullable(),
    people: z.number().int().min(0),
    events: z.number().int().min(0),
    profileViews: z.number().int().min(0),
    deckOpens: z.number().int().min(0),
    deckDwellMs: z.number().int().min(0),
    videoWatchMs: z.number().int().min(0),
    qCardViews: z.number().int().min(0),
    dataRoomDocumentViews: z.number().int().min(0),
    /** Null for the anonymous bucket. */
    lastViewedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();
export type EngagementViewerDto = z.infer<typeof EngagementViewerDtoSchema>;

export const EngagementDayDtoSchema = z
  .object({
    day: z.iso.date(),
    viewers: z.number().int().min(0),
    profileViews: z.number().int().min(0),
    deckOpens: z.number().int().min(0),
    videoWatches: z.number().int().min(0),
    qCardViews: z.number().int().min(0),
    dataRoomDocumentViews: z.number().int().min(0),
  })
  .strict();

export const DeckFunnelStepDtoSchema = z
  .object({
    documentId: UuidSchema,
    slideNumber: z.number().int().min(1),
    viewersReached: z.number().int().min(0),
    totalDwellMs: z.number().int().min(0),
    medianDwellMs: z.number().int().min(0),
  })
  .strict();

export const VideoCompletionDtoSchema = z
  .object({
    mediaAssetId: UuidSchema,
    viewers: z.number().int().min(0),
    totalWatchMs: z.number().int().min(0),
    completedViewers: z.number().int().min(0),
  })
  .strict();

export const DocumentViewsDtoSchema = z
  .object({
    documentId: UuidSchema,
    type: z.enum(["DECK_OPEN", "DATA_ROOM_DOCUMENT_VIEW"]),
    views: z.number().int().min(0),
    viewers: z.number().int().min(0),
    totalMs: z.number().int().min(0),
  })
  .strict();

export const CompanyEngagementDtoSchema = z
  .object({
    companyId: UuidSchema,
    since: z.iso.datetime({ offset: true }).nullable(),
    /** False when fewer than the floor of organisations engaged: aggregates are withheld. */
    floorMet: z.boolean(),
    floor: z.number().int().min(1),
    daily: z.array(EngagementDayDtoSchema),
    deckFunnel: z.array(DeckFunnelStepDtoSchema),
    videos: z.array(VideoCompletionDtoSchema),
    documents: z.array(DocumentViewsDtoSchema),
    viewers: z.array(EngagementViewerDtoSchema),
  })
  .strict();
export type CompanyEngagementDto = z.infer<typeof CompanyEngagementDtoSchema>;

export const CompanyEngagementParamsSchema = z
  .object({ companyId: UuidSchema })
  .strict();
export const CompanyEngagementQuerySchema = z
  .object({ since: z.iso.datetime({ offset: true }).optional() })
  .strict();
