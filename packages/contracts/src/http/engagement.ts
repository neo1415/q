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
 * The specification default for `analytics.platform_settings`
 * .default_visibility (owner-confirmed 6 Nov 2026). The live value is the
 * admin setting, read through `analytics.settings()`.
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
    /** What the platform lets a person choose (admin setting). */
    allowedVisibilities: z.array(ViewingVisibilitySchema).min(1).max(3),
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

export const ENGAGEMENT_SHOWN_BASES = ["VIEWER_CHOICE", "PAID_REVEAL"] as const;

export const EngagementViewerDtoSchema = z
  .object({
    /** The level the founder is shown, after the platform settings. */
    visibility: ViewingVisibilitySchema,
    /** PAID_REVEAL where the shown level is less private than the viewer's own. */
    basis: z.enum(ENGAGEMENT_SHOWN_BASES),
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
    /** Null unless the viewer is named and per-person analytics is on. */
    deckDwellMs: z.number().int().min(0).nullable(),
    videoWatchMs: z.number().int().min(0).nullable(),
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
    /** Slide dwell per named viewer; empty unless per-person analytics is on. */
    viewerDeckDetail: z.array(
      z
        .object({
          viewerUserId: UuidSchema,
          documentId: UuidSchema,
          slideNumber: z.number().int().min(1),
          dwellMs: z.number().int().min(0),
        })
        .strict(),
    ),
  })
  .strict();
export type CompanyEngagementDto = z.infer<typeof CompanyEngagementDtoSchema>;

export const CompanyEngagementParamsSchema = z
  .object({ companyId: UuidSchema })
  .strict();
export const CompanyEngagementQuerySchema = z
  .object({ since: z.iso.datetime({ offset: true }).optional() })
  .strict();

// ---------------------------------------------------------------------------
// Admin-controlled analytics settings (owner, 6 Nov 2026). Mirrors
// analytics.platform_settings, constraints included. The defaults are the
// Product Specification §6.7 behaviour.
// ---------------------------------------------------------------------------

export const ANALYTICS_SETTINGS_PATH = "/v1/admin/analytics-settings" as const;

const privacyRank = (v: ViewingVisibility): number =>
  v === "FULL_IDENTITY" ? 0 : v === "ORGANISATION_ONLY" ? 1 : 2;

export const AnalyticsSettingsSchema = z
  .object({
    defaultVisibility: ViewingVisibilitySchema,
    allowedVisibilities: z.array(ViewingVisibilitySchema).min(1).max(3),
    namedPassiveViewers: z.boolean(),
    paidIdentityReveal: z.boolean(),
    paidRevealOverridesAnonymous: z.boolean(),
    perPersonPassiveAnalytics: z.boolean(),
    passiveViewNotifications: z.boolean(),
    intentSignalNotifications: z.boolean(),
    qUsesPassiveSignals: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    const allowed = new Set(value.allowedVisibilities);
    if (allowed.size !== value.allowedVisibilities.length) {
      context.addIssue({
        code: "custom",
        path: ["allowedVisibilities"],
        message: "Each level once.",
      });
    }
    for (const level of VIEWING_VISIBILITIES) {
      if (
        privacyRank(level) >= privacyRank(value.defaultVisibility) &&
        !allowed.has(level)
      ) {
        context.addIssue({
          code: "custom",
          path: ["allowedVisibilities"],
          message:
            "A person may always choose the default or anything more private.",
        });
      }
    }
    if (value.paidRevealOverridesAnonymous && !value.paidIdentityReveal) {
      context.addIssue({
        code: "custom",
        path: ["paidRevealOverridesAnonymous"],
        message: "Overriding Anonymous needs paid identity reveal on.",
      });
    }
  });
export type AnalyticsSettings = z.infer<typeof AnalyticsSettingsSchema>;

export const ANALYTICS_SETTINGS_DEFAULTS: AnalyticsSettings = {
  defaultVisibility: "ORGANISATION_ONLY",
  allowedVisibilities: ["FULL_IDENTITY", "ORGANISATION_ONLY", "ANONYMOUS"],
  namedPassiveViewers: false,
  paidIdentityReveal: false,
  paidRevealOverridesAnonymous: false,
  perPersonPassiveAnalytics: false,
  passiveViewNotifications: false,
  intentSignalNotifications: true,
  qUsesPassiveSignals: true,
};

/** Plain English for the admin console; `beyondSpec` marks what changes §6.7. */
export const ANALYTICS_SETTING_DESCRIPTIONS: Readonly<
  Record<
    keyof AnalyticsSettings,
    {
      readonly title: string;
      readonly description: string;
      readonly beyondSpec: (value: unknown) => boolean;
    }
  >
> = {
  defaultVisibility: {
    title: "Default viewer identity",
    description:
      'What founders see about an investor who has not chosen: their name, their organisation ("Someone from Apex Capital"), or nothing. Investors may always choose to be more private.',
    beyondSpec: (value) => value === "FULL_IDENTITY",
  },
  allowedVisibilities: {
    title: "Levels investors may choose",
    description:
      "Which visibility levels an investor can pick. The default and anything more private are always allowed. A stored choice that is later disallowed is still honoured, never made less private.",
    beyondSpec: () => false,
  },
  namedPassiveViewers: {
    title: 'Named viewers ("who viewed you")',
    description:
      "Show founders the name of an investor who chose Full identity when they only viewed. Off shows their organisation. Specification §6.7.12: passive viewing is generally not granular founder analytics.",
    beyondSpec: (value) => value === true,
  },
  paidIdentityReveal: {
    title: "Paid identity reveal",
    description:
      'A founder whose plan includes "Viewer identity reveal" sees viewers by name, even those who chose Organisation only. Overrides the investor\'s choice (§6.7.13). Anonymous stays anonymous unless the next setting is on.',
    beyondSpec: (value) => value === true,
  },
  paidRevealOverridesAnonymous: {
    title: "Paid reveal overrides Anonymous",
    description:
      "Lets a paid reveal name investors who chose Anonymous. Needs paid identity reveal on. Directly overrides §6.7.13.",
    beyondSpec: (value) => value === true,
  },
  perPersonPassiveAnalytics: {
    title: "Per-person viewing detail",
    description:
      "Slide-by-slide time and video time for each named viewer. Off shows these only as aggregates across at least 3 organisations.",
    beyondSpec: (value) => value === true,
  },
  passiveViewNotifications: {
    title: "View notifications",
    description:
      'Email and push to founders when someone views ("X viewed your deck"). Never suggests contacting the viewer (§6.7.14).',
    beyondSpec: (value) => value === true,
  },
  intentSignalNotifications: {
    title: "Intent notifications",
    description:
      "Email and push to founders on a save, an expression of interest, a connection request or a data-room request (§6.7.12 intent signals).",
    beyondSpec: () => false,
  },
  qUsesPassiveSignals: {
    title: "Q uses viewing in advice",
    description:
      "Q may use viewing, within each viewer's visibility, as context when advising whom to focus on. Q never suggests contacting someone because they viewed.",
    beyondSpec: () => false,
  },
};

export const AnalyticsSettingsDtoSchema = z
  .object({
    settings: AnalyticsSettingsSchema,
    version: z.number().int().min(1),
    updatedByName: z.string().nullable(),
    reason: z.string().nullable(),
    updatedAt: z.iso.datetime({ offset: true }),
    history: z.array(
      z
        .object({
          actorName: z.string().nullable(),
          reason: z.string(),
          changed: z.array(z.string()),
          at: z.iso.datetime({ offset: true }),
        })
        .strict(),
    ),
  })
  .strict();
export type AnalyticsSettingsDto = z.infer<typeof AnalyticsSettingsDtoSchema>;

export const UpdateAnalyticsSettingsRequestSchema = z
  .object({
    settings: AnalyticsSettingsSchema,
    /** Optimistic concurrency: the version the admin was looking at. */
    expectedVersion: z.number().int().min(1),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export type UpdateAnalyticsSettingsRequest = z.infer<
  typeof UpdateAnalyticsSettingsRequestSchema
>;
