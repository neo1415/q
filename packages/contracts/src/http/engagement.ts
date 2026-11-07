import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { HandleSchema } from "./public-identity.js";

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
/** An investor's own engagement: what they viewed and how founders answered. */
export const MY_ENGAGEMENT_PATH = "/v1/engagement/me" as const;

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
  // A Q Card is reached by its handle (the public card carries no subject
  // id): the server resolves an ACTIVE company handle to the company.
  z
    .object({
      clientEventId: base.clientEventId,
      sessionId: base.sessionId,
      occurredAt: base.occurredAt,
      type: z.literal("Q_CARD_VIEW"),
      companyId: UuidSchema.optional(),
      handle: HandleSchema.optional(),
    })
    .strict()
    .refine(
      (event) =>
        (event.companyId === undefined) !== (event.handle === undefined),
      { message: "Name the company or its handle, not both." },
    ),
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

/**
 * What a founder is shown: a viewer's own level where the founder sees
 * viewers individually (Founder Pro, or the admin's named-viewers switch),
 * else one merged AGGREGATE row. ANONYMOUS reads "an investor".
 */
export const ENGAGEMENT_SHOWN_LEVELS = [
  ...VIEWING_VISIBILITIES,
  "AGGREGATE",
] as const;
export const EngagementShownLevelSchema = z.enum(ENGAGEMENT_SHOWN_LEVELS);

export const EngagementViewerDtoSchema = z
  .object({
    /** The level the founder is shown, after the platform settings. */
    visibility: EngagementShownLevelSchema,
    /** PAID_REVEAL only where the admin override named an Anonymous viewer. */
    basis: z.enum(ENGAGEMENT_SHOWN_BASES),
    /** Only for FULL_IDENTITY. */
    viewerUserId: UuidSchema.nullable(),
    /** FULL_IDENTITY and ORGANISATION_ONLY. */
    viewerOrganisationId: UuidSchema.nullable(),
    viewerName: z.string().nullable(),
    organisationName: z.string().nullable(),
    organisations: z.number().int().min(0),
    people: z.number().int().min(0),
    events: z.number().int().min(0),
    profileViews: z.number().int().min(0),
    deckOpens: z.number().int().min(0),
    /** Null unless the viewer is named and per-person analytics is on. */
    deckDwellMs: z.number().int().min(0).nullable(),
    videoWatchMs: z.number().int().min(0).nullable(),
    qCardViews: z.number().int().min(0),
    dataRoomDocumentViews: z.number().int().min(0),
    /** The batch (week) of the latest view; never a time. Null for merged rows. */
    lastPeriodStart: z.iso.date().nullable(),
  })
  .strict();
export type EngagementViewerDto = z.infer<typeof EngagementViewerDtoSchema>;

export const EngagementPeriodDtoSchema = z
  .object({
    /** The start of a completed batch (a week by default). */
    periodStart: z.iso.date(),
    organisations: z.number().int().min(0),
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

export const INTENT_SIGNAL_TYPES = [
  "SAVE",
  "INTEREST",
  "DATA_ROOM_REQUEST",
] as const;

/**
 * An intent signal (§6.7.12), real time and with no floor. A save follows
 * the investor's own level; a deliberate request always shows the firm (the
 * relationship already does) and names the person only at Full identity.
 */
export const IntentSignalDtoSchema = z
  .object({
    type: z.enum(INTENT_SIGNAL_TYPES),
    occurredAt: z.iso.datetime({ offset: true }),
    visibility: ViewingVisibilitySchema,
    viewerUserId: UuidSchema.nullable(),
    viewerName: z.string().nullable(),
    viewerOrganisationId: UuidSchema.nullable(),
    organisationName: z.string().nullable(),
  })
  .strict();
export type IntentSignalDto = z.infer<typeof IntentSignalDtoSchema>;

export const CompanyEngagementDtoSchema = z
  .object({
    companyId: UuidSchema,
    since: z.iso.datetime({ offset: true }).nullable(),
    /** False below the headline floor: passive aggregates are withheld. */
    floorMet: z.boolean(),
    floor: z.number().int().min(3),
    sliceFloor: z.number().int().min(5),
    passiveBatch: z.enum(["WEEKLY", "DAILY"]),
    /** Whether viewers appear individually (Founder Pro or the admin switch). */
    perViewer: z.boolean(),
    /** Whether this company's plan includes viewer identity. */
    entitled: z.boolean(),
    /** Real time, every plan, no floor. */
    intent: z.array(IntentSignalDtoSchema),
    periods: z.array(EngagementPeriodDtoSchema),
    slices: z.array(
      z
        .object({
          dimension: z.enum(["INVESTOR_TYPE", "GEOGRAPHY"]),
          /** OTHER for the merged, suppressed slices. */
          slice: z.string(),
          organisations: z.number().int().min(0).nullable(),
          suppressed: z.boolean(),
        })
        .strict(),
    ),
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
    /** Distinct organisations before any passive total; admins raise it, never below 3. */
    headlineFloor: z.number().int().min(3).max(100),
    /** Distinct organisations for any breakdown slice; never below 5. */
    sliceFloor: z.number().int().min(5).max(100),
    /** Passive figures in completed batches only; WEEKLY by default. */
    passiveBatch: z.enum(["WEEKLY", "DAILY"]),
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
  paidIdentityReveal: true,
  paidRevealOverridesAnonymous: false,
  perPersonPassiveAnalytics: false,
  passiveViewNotifications: false,
  intentSignalNotifications: true,
  qUsesPassiveSignals: true,
  headlineFloor: 3,
  sliceFloor: 5,
  passiveBatch: "WEEKLY",
};

/**
 * Plain English for the admin console. `beyondSpec` marks a value that goes
 * beyond the Product Specification §6.7; `locked` marks a setting whose
 * change needs an explicit acknowledgement of the investor-trust risk.
 */
export const ANALYTICS_SETTING_DESCRIPTIONS: Readonly<
  Record<
    keyof AnalyticsSettings,
    {
      readonly title: string;
      readonly description: string;
      readonly beyondSpec: (value: unknown) => boolean;
      readonly locked?: true;
    }
  >
> = {
  defaultVisibility: {
    title: "Default viewer identity",
    description:
      'What an investor who has not chosen shows to founders: their name, their organisation ("Someone from Apex Capital"), or nothing. Investors may always choose to be more private, for free.',
    beyondSpec: (value) => value === "FULL_IDENTITY",
  },
  allowedVisibilities: {
    title: "Levels investors may choose",
    description:
      "Which visibility levels an investor can pick. The default and anything more private are always allowed. A stored choice that is later disallowed is still honoured, never made less private.",
    beyondSpec: () => false,
  },
  paidIdentityReveal: {
    title: "Viewer identity for Founder Pro",
    description:
      'Founders whose plan includes "Viewer identity" (Founder Pro) see each viewer at the level the investor chose: name, organisation, or just "an investor". It never reveals an Anonymous investor. A subscription feature, not credits; investors never pay for visibility or anonymity. The specification (§6.7.12) says passive viewing is generally not granular founder analytics.',
    beyondSpec: (value) => value === true,
  },
  namedPassiveViewers: {
    title: "Viewer identity for every founder",
    description:
      "The same per-viewer display for every founder, without the plan. Off: free founders see aggregates and every intent signal.",
    beyondSpec: (value) => value === true,
  },
  paidRevealOverridesAnonymous: {
    title: "Reveal Anonymous investors (locked)",
    description:
      "Lets Founder Pro name investors who chose Anonymous. This breaks the promise Capital Q makes to investors (§6.7.13) and can end their trust in the platform. Needs Viewer identity on, a step-up and an explicit acknowledgement of that risk.",
    beyondSpec: (value) => value === true,
    locked: true,
  },
  perPersonPassiveAnalytics: {
    title: "Per-person viewing time",
    description:
      'Slide-by-slide and video time for each named viewer. Off by default: time tied to a person invites the "I saw you spent four minutes on slide 7" follow-up investors find invasive.',
    beyondSpec: (value) => value === true,
  },
  headlineFloor: {
    title: "Minimum organisations for totals",
    description:
      'No passive total appears until this many distinct organisations viewed in the period. Below it founders read "Fewer than 3 investor organisations viewed this week". Never below 3.',
    beyondSpec: () => false,
  },
  sliceFloor: {
    title: "Minimum organisations per breakdown",
    description:
      "Any breakdown (investor type, geography) shows a slice only at this many organisations, and hides the next-smallest too so nothing can be found by subtraction. Never below 5.",
    beyondSpec: () => false,
  },
  passiveBatch: {
    title: "Viewing figures refresh",
    description:
      "Weekly: viewing figures cover completed weeks only, with no view times, so a founder cannot match a view to a meeting. Intent signals always arrive in real time.",
    beyondSpec: (value) => value === "DAILY",
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
      "Email and push to founders on a save, an expression of interest, a connection request or a data-room request, in real time (§6.7.12 intent signals).",
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
    /**
     * Required to turn the locked Anonymous override on: the admin has read
     * that it breaks the anonymity promise made to investors.
     */
    acknowledgeInvestorTrustRisk: z.literal(true).optional(),
  })
  .strict();
export type UpdateAnalyticsSettingsRequest = z.infer<
  typeof UpdateAnalyticsSettingsRequestSchema
>;

// ---------------------------------------------------------------------------
// An investor's own engagement (A4): their own records only.
// ---------------------------------------------------------------------------

export const MyEngagementDtoSchema = z
  .object({
    privacy: ViewingPrivacyDtoSchema,
    /** Companies they viewed, their own history (exact times are theirs). */
    viewed: z.array(
      z
        .object({
          companyId: UuidSchema,
          companyName: z.string(),
          views: z.number().int().min(0),
          deckMinutes: z.number().int().min(0),
          lastViewedAt: z.iso.datetime({ offset: true }),
        })
        .strict(),
    ),
    /** How founders answered what they asked. */
    responses: z.array(
      z
        .object({
          companyId: UuidSchema,
          companyName: z.string(),
          kind: z.enum(["INTEREST", "DATA_ROOM_REQUEST"]),
          state: z.enum(["WAITING", "ACCEPTED", "DECLINED"]),
          askedAt: z.iso.datetime({ offset: true }),
          answeredAt: z.iso.datetime({ offset: true }).nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export type MyEngagementDto = z.infer<typeof MyEngagementDtoSchema>;
