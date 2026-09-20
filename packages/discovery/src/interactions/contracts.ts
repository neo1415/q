import { UuidSchema } from "@capital-q/contracts";
import { z } from "zod";

/**
 * Recommendation interactions (doc 19 §66-§69, §167; doc 20 §70-§73;
 * CQ-REC-008).
 *
 *   observed behaviour ≠ declared mandate ≠ Q inference ≠ GateQ rules
 *   viewing ≠ interest;  save ≠ interest;  pass ≠ poor company
 *   interaction ≠ relationship state;  exposure ≠ popularity
 *
 * What an investor did with a recommendation, recorded so that later work
 * — diversity, exploration, offline evaluation — has an honest record to
 * read. Nothing here changes what Capital Q recommends today: REC-005's
 * ranking config and the v1 feature schema are deliberately untouched, and
 * a behaviour feature must arrive through a governed feature-schema
 * version rather than by a table appearing.
 *
 * Two kinds of thing live in one taxonomy, and the difference is enforced
 * at the API rather than blurred here. IMPRESSION, WATCH_MILESTONE,
 * PROFILE_OPEN and ASK_Q are observations: a client reports them and the
 * server believes only the fact that they were reported. SAVE, UNSAVE and
 * PASS are decisions: they change durable state the person will see again.
 * INTEREST_OBSERVED is neither — it is the seam for a future canonical
 * Network event, and no client route may write it (CQ-NET-010 owns
 * Express Interest).
 */

export const INTERACTION_VERSION = "recommendation-interaction.v1" as const;

export const INTERACTION_TYPES = [
  /** The item was actually seen, not merely rendered (doc 20 §71). */
  "IMPRESSION",
  /** A bounded point in playback, never a continuous stream (doc 20 §72-§73). */
  "WATCH_MILESTONE",
  "PROFILE_OPEN",
  /** That Q was asked about this company. Never what was asked. */
  "ASK_Q",
  /** "I want to revisit this" (doc 17 §100). Not interest. */
  "SAVE",
  "UNSAVE",
  /** Context-specific and reversible. Never a hard exclusion. */
  "PASS",
  /** Server-internal seam for CQ-NET-010. No client route writes this. */
  "INTEREST_OBSERVED",
] as const;
export const InteractionTypeSchema = z.enum(INTERACTION_TYPES);
export type InteractionType = z.infer<typeof InteractionTypeSchema>;

/**
 * Semantic weight, recorded so later work need not re-derive it.
 *
 * Doc 19 §66: signals nearer a meeting carry more meaning than watching.
 * It is a CLASS and never a number — nothing multiplies it, nothing sums
 * it, and REC-005 does not read it.
 */
export const INTERACTION_STRENGTH_CLASSES = [
  "ATTENTION",
  "CONSIDERATION",
  "CONTEXTUAL_DECISION",
  "INTENT",
] as const;
export const InteractionStrengthClassSchema = z.enum(
  INTERACTION_STRENGTH_CLASSES,
);
export type InteractionStrengthClass = z.infer<
  typeof InteractionStrengthClassSchema
>;

/** Where the person was. Product vocabulary, not a label a client invents. */
export const INTERACTION_SURFACES = [
  "RECOMMENDATION_FEED",
  "COMPANY_PROFILE",
  "SAVED_LIST",
  "SEARCH",
  "Q_CONVERSATION",
] as const;
export const InteractionSurfaceSchema = z.enum(INTERACTION_SURFACES);
export type InteractionSurface = z.infer<typeof InteractionSurfaceSchema>;

/**
 * Bounded points in playback.
 *
 * STARTED means playback began, not that a poster rendered (doc 20 §72).
 * COMPLETED comes from playback progress, never from an error or an
 * auto-advance (doc 20 §73). Thresholds are engineering policy the player
 * owns; this is the vocabulary it reports in.
 */
export const WATCH_MILESTONES = [
  "STARTED",
  "P25",
  "P50",
  "P75",
  "COMPLETED",
] as const;
export const WatchMilestoneSchema = z.enum(WATCH_MILESTONES);
export type WatchMilestone = z.infer<typeof WatchMilestoneSchema>;

/**
 * Why, when the person volunteered it.
 *
 * Optional by design: doc 17 forbids a feedback modal after every pass, so
 * most passes carry nothing and that is the expected case. Bounded, because
 * free text about somebody's company is a liability nobody asked for.
 */
export const PASS_REASONS = [
  "NOT_NOW",
  "STAGE",
  "SECTOR",
  "GEOGRAPHY",
  "TRACTION",
  "RAISE",
  "TIMING",
  "OTHER",
] as const;
export const PassReasonSchema = z.enum(PASS_REASONS);
export type PassReason = z.infer<typeof PassReasonSchema>;

/** Opaque, bounded, never a device fingerprint. */
const OpaqueIdSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9_:-]{8,64}$/,
    "must be 8-64 characters of A-Z, a-z, 0-9, underscore, colon or hyphen",
  );

export const ClientEventIdSchema = OpaqueIdSchema;
export const InteractionSessionIdSchema = OpaqueIdSchema;

/**
 * The exposure context an impression must carry (doc 19 §69).
 *
 * Resolved by the server from the slate, never taken from the caller: a
 * client that could name its own position could also name a better one.
 */
export const InteractionExposureSchema = z
  .object({
    slateId: UuidSchema,
    slateItemId: UuidSchema,
    position: z.number().int().min(1),
    rankerVersion: z.string().regex(/^[a-z][a-z0-9-]*\.v[0-9]+$/),
    rankingConfigVersion: z.string().regex(/^[a-z][a-z0-9-]*\.[a-z0-9-]+$/),
  })
  .strict();
export type InteractionExposure = z.infer<typeof InteractionExposureSchema>;

/** One recorded interaction, as the repository stores and returns it. */
export const InteractionEventSchema = z
  .object({
    id: UuidSchema,
    tenantId: UuidSchema,
    actorUserId: UuidSchema,
    investorOrganisationId: UuidSchema,
    companyId: UuidSchema,
    companyTenantId: UuidSchema,
    interactionType: InteractionTypeSchema,
    strengthClass: InteractionStrengthClassSchema,
    interactionVersion: z.string(),
    surface: InteractionSurfaceSchema,
    exposure: InteractionExposureSchema.nullable(),
    mediaAssetId: UuidSchema.nullable(),
    watchMilestone: WatchMilestoneSchema.nullable(),
    passReason: PassReasonSchema.nullable(),
    clientEventId: ClientEventIdSchema,
    sessionId: InteractionSessionIdSchema.nullable(),
    occurredAt: z.string(),
    recordedAt: z.string(),
  })
  .strict();
export type InteractionEvent = z.infer<typeof InteractionEventSchema>;

/**
 * What the history adds up to, for one investor and one company.
 *
 * Deliberately small. It answers the questions a feed and a Saved section
 * ask — have they seen it, do they want to revisit it, did they move past
 * it — and refuses the question "how interested are they", which nothing
 * here can answer.
 */
export const InteractionStateSchema = z
  .object({
    companyId: UuidSchema,
    saved: z.boolean(),
    savedAt: z.string().nullable(),
    passed: z.boolean(),
    passedAt: z.string().nullable(),
    lastPassReason: PassReasonSchema.nullable(),
    impressionCount: z.number().int().min(0),
    lastImpressionAt: z.string().nullable(),
    lastInteractionAt: z.string().nullable(),
  })
  .strict();
export type InteractionState = z.infer<typeof InteractionStateSchema>;

/** Why an interaction was not recorded. Indistinguishable to the caller. */
export const INTERACTION_REFUSALS = [
  /** Not an investor, not their slate, not a company they may act on. */
  "NOT_FOUND",
  /** The type exists but no client route may write it. */
  "NOT_CLIENT_WRITABLE",
] as const;
export const InteractionRefusalSchema = z.enum(INTERACTION_REFUSALS);
export type InteractionRefusal = z.infer<typeof InteractionRefusalSchema>;

export type RecordInteractionResult =
  | {
      readonly kind: "RECORDED";
      readonly event: InteractionEvent;
      /** True when an earlier identical report already created it. */
      readonly deduplicated: boolean;
    }
  | { readonly kind: "REFUSED"; readonly refusal: InteractionRefusal };
