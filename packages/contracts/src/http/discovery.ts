import { z } from "zod";

import { UtcTimestampSchema } from "../common/time.js";
import { UuidSchema } from "../common/ids.js";
import { CurrencyCodeSchema } from "../common/money.js";
import { StageCodeSchema } from "./companies.js";
import { PitchSummaryDtoSchema } from "./media.js";

/**
 * `GET /v1/discovery/companies` and `/v1/discovery/investors` (doc 19).
 *
 * A slate: who this person could reasonably meet, in a deterministic
 * order, with the declared reasons that produced it. Cursor-paged, never
 * offset. No score reaches the wire — doc 19 forbids presenting an
 * invented number as a verdict, and `rank` exists only so a slate can be
 * reproduced server-side.
 */

export const DISCOVERY_COMPANIES_PATH = "/v1/discovery/companies" as const;
export const DISCOVERY_INVESTORS_PATH = "/v1/discovery/investors" as const;

export const DiscoveryReasonDtoSchema = z
  .object({
    kind: z.enum([
      "STAGE_IN_RANGE",
      "SECTOR_MATCH",
      "GEOGRAPHY_MATCH",
      "BUSINESS_MODEL_MATCH",
      "CUSTOMER_TYPE_MATCH",
      "DECLARED_DEPLOYING",
      "PROFILE_COMPLETE",
    ]),
    detail: z.string().max(200),
  })
  .strict();
export type DiscoveryReasonDto = z.infer<typeof DiscoveryReasonDtoSchema>;

export const DiscoveryNoteDtoSchema = z.enum([
  "NO_ACTIVE_MANDATE",
  "MANDATE_HAS_NO_PREFERENCES",
  "NO_DISCOVERABLE_COUNTERPARTS",
  "RANKED_ON_DECLARED_PROFILE_ONLY",
  /** No servable persisted slate yet; a rebuild has been requested (CQ-REC-006). */
  "RECOMMENDATIONS_REFRESHING",
  /** The cursor's slate is no longer servable; this page starts the current one. */
  "SLATE_RESTARTED",
  /**
   * Companies are discoverable and a declared hard rule removed every one
   * (ADR 0020); `excludingRules` names the rules. Never shown as "nobody
   * is discoverable".
   */
  "NONE_PASS_HARD_RULES",
  /** Companies are discoverable and pass the hard rules; none matched the mandate. */
  "NONE_MATCH_MANDATE",
  /**
   * The reader's own Discover filters left nothing on this first page's
   * scan (lead-owned contract change, ux/discover-filters). Never said when
   * no filter is applied.
   */
  "NONE_MATCH_FILTERS",
]);
export type DiscoveryNoteDto = z.infer<typeof DiscoveryNoteDtoSchema>;

/**
 * A declared mandate rule, by dimension (`stage`, `geography.country`,
 * `taxonomy`, `red_flag`, …). The investor's own rule, never a value from
 * it and never anything about the company.
 */
export const MandateRuleCodeDtoSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_.]*$/)
  .max(64);

// ---------------------------------------------------------------------------
// Discover filters (lead-owned contract change, ux/discover-filters; doc 19
// §15 explicit filters, ADR 0020).
//
// Optional query parameters on GET /v1/discovery/companies. They narrow the
// served slate at read time: ranks stay the slate's, nothing is re-ranked,
// and the cursor carries a fingerprint of the filters so every page of one
// scroll is read under the same ones. A request whose filters differ from
// its cursor's starts again from the first page (SLATE_RESTARTED).
//
// Unknown never excludes silently: a company whose sector, stage or
// country is not stated, or whose raise is not shared with this reader,
// stays and is marked (`filterUnknown`), unless the reader asked for
// disclosed raises only. "Verified only" and "has pitch" ask for a
// positive fact, so only a company that has it passes.
// ---------------------------------------------------------------------------

export const DISCOVER_FILTER_DIMENSIONS = [
  "sector",
  "stage",
  "country",
  "raise",
] as const;
export const DiscoverFilterDimensionSchema = z.enum(DISCOVER_FILTER_DIMENSIONS);
export type DiscoverFilterDimension = z.infer<
  typeof DiscoverFilterDimensionSchema
>;

/** A non-negative exact amount, bounded; never a float. */
export const DiscoverRaiseAmountSchema = z
  .string()
  .regex(
    /^(?:0|[1-9]\d{0,14})(?:\.\d{1,2})?$/,
    "expected an amount such as 500000",
  );

export const DISCOVER_FILTER_LIST_MAX = 12;

export const DiscoverRaiseFilterSchema = z
  .object({
    min: DiscoverRaiseAmountSchema.optional(),
    max: DiscoverRaiseAmountSchema.optional(),
    currency: CurrencyCodeSchema,
  })
  .strict();
export type DiscoverRaiseFilter = z.infer<typeof DiscoverRaiseFilterSchema>;

export const DiscoverFiltersSchema = z
  .object({
    /** Taxonomy node ids (sector vocabularies); a parent includes its children. */
    sectorNodeIds: z
      .array(UuidSchema)
      .max(DISCOVER_FILTER_LIST_MAX)
      .default([]),
    stageCodes: z
      .array(StageCodeSchema)
      .max(DISCOVER_FILTER_LIST_MAX)
      .default([]),
    /** ISO 3166-1 alpha-2, uppercase, as company records store them. */
    countryCodes: z
      .array(z.string().regex(/^[A-Z]{2}$/))
      .max(DISCOVER_FILTER_LIST_MAX)
      .default([]),
    raise: DiscoverRaiseFilterSchema.nullable().default(null),
    /** Only companies whose raise is shared with this reader (and in range). */
    raiseDisclosedOnly: z.boolean().default(false),
    verifiedOnly: z.boolean().default(false),
    hasPitch: z.boolean().default(false),
  })
  .strict();
export type DiscoverFilters = z.infer<typeof DiscoverFiltersSchema>;

export const NO_DISCOVER_FILTERS: DiscoverFilters = Object.freeze({
  sectorNodeIds: [],
  stageCodes: [],
  countryCodes: [],
  raise: null,
  raiseDisclosedOnly: false,
  verifiedOnly: false,
  hasPitch: false,
});

/** True when nothing narrows the slate. */
export function isEmptyDiscoverFilters(filters: DiscoverFilters): boolean {
  return (
    filters.sectorNodeIds.length === 0 &&
    filters.stageCodes.length === 0 &&
    filters.countryCodes.length === 0 &&
    (filters.raise === null ||
      (filters.raise.min === undefined && filters.raise.max === undefined)) &&
    !filters.raiseDisclosedOnly &&
    !filters.verifiedOnly &&
    !filters.hasPitch
  );
}

/** How many filter groups are on: the badge on the filter button. */
export function activeDiscoverFilterCount(filters: DiscoverFilters): number {
  return [
    filters.sectorNodeIds.length > 0,
    filters.stageCodes.length > 0,
    filters.countryCodes.length > 0,
    (filters.raise !== null &&
      (filters.raise.min !== undefined || filters.raise.max !== undefined)) ||
      filters.raiseDisclosedOnly,
    filters.verifiedOnly,
    filters.hasPitch,
  ].filter(Boolean).length;
}

/** Sorted, de-duplicated, empty raise dropped: equal filters compare equal. */
export function canonicalDiscoverFilters(
  filters: DiscoverFilters,
): DiscoverFilters {
  const sorted = (values: readonly string[]): string[] =>
    [...new Set(values)].sort();
  const raise =
    filters.raise === null ||
    (filters.raise.min === undefined && filters.raise.max === undefined)
      ? null
      : {
          ...(filters.raise.min === undefined
            ? {}
            : { min: filters.raise.min }),
          ...(filters.raise.max === undefined
            ? {}
            : { max: filters.raise.max }),
          currency: filters.raise.currency,
        };
  return {
    sectorNodeIds: sorted(filters.sectorNodeIds.map((id) => id.toLowerCase())),
    stageCodes: sorted(filters.stageCodes),
    countryCodes: sorted(filters.countryCodes),
    raise,
    raiseDisclosedOnly: filters.raiseDisclosedOnly,
    verifiedOnly: filters.verifiedOnly,
    hasPitch: filters.hasPitch,
  };
}

/** The query parameters, all optional; lists are comma-separated. */
export const DISCOVER_FILTER_QUERY_KEYS = [
  "sector",
  "stage",
  "country",
  "raiseMin",
  "raiseMax",
  "raiseCurrency",
  "raiseDisclosedOnly",
  "verifiedOnly",
  "hasPitch",
] as const;

const list = (value: unknown): string[] =>
  typeof value === "string" && value.length > 0
    ? value
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
    : [];
const flag = z.enum(["true", "false"]).optional();

/**
 * Parses the query string's filter parameters (external input: `unknown`
 * until here). A raise bound without a currency is refused rather than
 * guessed: money is never currency-less.
 */
export const DiscoverFiltersQuerySchema = z
  .object({
    sector: z.string().max(600).optional(),
    stage: z.string().max(400).optional(),
    country: z.string().max(100).optional(),
    raiseMin: DiscoverRaiseAmountSchema.optional(),
    raiseMax: DiscoverRaiseAmountSchema.optional(),
    raiseCurrency: CurrencyCodeSchema.optional(),
    raiseDisclosedOnly: flag,
    verifiedOnly: flag,
    hasPitch: flag,
  })
  .refine(
    (q) =>
      (q.raiseMin === undefined && q.raiseMax === undefined) ||
      q.raiseCurrency !== undefined,
    { message: "a raise bound needs raiseCurrency", path: ["raiseCurrency"] },
  )
  .transform((q, ctx): DiscoverFilters => {
    const parsed = DiscoverFiltersSchema.safeParse({
      sectorNodeIds: list(q.sector),
      stageCodes: list(q.stage),
      countryCodes: list(q.country).map((code) => code.toUpperCase()),
      raise:
        q.raiseCurrency === undefined ||
        (q.raiseMin === undefined && q.raiseMax === undefined)
          ? null
          : {
              ...(q.raiseMin === undefined ? {} : { min: q.raiseMin }),
              ...(q.raiseMax === undefined ? {} : { max: q.raiseMax }),
              currency: q.raiseCurrency,
            },
      raiseDisclosedOnly: q.raiseDisclosedOnly === "true",
      verifiedOnly: q.verifiedOnly === "true",
      hasPitch: q.hasPitch === "true",
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: "custom",
          message: issue.message,
          path: issue.path,
        });
      }
      return z.NEVER;
    }
    return canonicalDiscoverFilters(parsed.data);
  });

/** The query parameters for a set of filters; none for an empty set. */
export function discoverFiltersToQuery(
  filters: DiscoverFilters,
): Record<string, string> {
  const f = canonicalDiscoverFilters(filters);
  const out: Record<string, string> = {};
  if (f.sectorNodeIds.length > 0) out.sector = f.sectorNodeIds.join(",");
  if (f.stageCodes.length > 0) out.stage = f.stageCodes.join(",");
  if (f.countryCodes.length > 0) out.country = f.countryCodes.join(",");
  if (f.raise !== null) {
    if (f.raise.min !== undefined) out.raiseMin = f.raise.min;
    if (f.raise.max !== undefined) out.raiseMax = f.raise.max;
    out.raiseCurrency = f.raise.currency;
  }
  if (f.raiseDisclosedOnly) out.raiseDisclosedOnly = "true";
  if (f.verifiedOnly) out.verifiedOnly = "true";
  if (f.hasPitch) out.hasPitch = "true";
  return out;
}

export const DiscoveredCompanyDtoSchema = z
  .object({
    companyId: UuidSchema,
    canonicalName: z.string(),
    websiteUrl: z.string().nullable(),
    headquartersCountry: z.string().nullable(),
    currentStageCode: z.string().nullable(),
    shortDescription: z.string().nullable(),
    reasons: z.array(DiscoveryReasonDtoSchema).max(8),
    /**
     * Declared-alignment codes from the persisted slate (CQ-REC-006):
     * machine-readable, bounded, never a score. Explanations are REC-007's.
     */
    reasonCodes: z.array(z.string().max(64)).max(8),
    /**
     * The company's current pitch as the feed may show it (doc 20); null
     * when there is none or it is not playable. Only a READY, moderation-
     * ALLOWED, non-PRIVATE pitch is ever placed here, and the item carries
     * no provider id and no URL: the client asks `/playback` for each item
     * it activates. Defaults to null so slates built before pitches
     * existed still parse.
     */
    pitch: PitchSummaryDtoSchema.nullable().default(null),
    /**
     * The company's other publishable videos, newest first, after `pitch`
     * (ADR 0022). The item is still one company, ranked once; these are
     * how it tells its story. Absent from older APIs.
     */
    morePitches: z.array(PitchSummaryDtoSchema).max(29).optional(),
    /**
     * Declared hard exclusions this company's own facts could not answer
     * (its stage, country or sector is not stated). Unknown never excludes
     * (ADR 0020): the company is shown and the investor is told. Optional
     * so a page from an API that predates it still parses; absent is none.
     */
    unverifiedExclusions: z.array(MandateRuleCodeDtoSchema).max(8).optional(),
    /**
     * Passed before, and offered again because something is new (doc 19
     * §67): the card says "since you last saw it". `change` is a bounded
     * code (NEW_PITCH), or null when the reason names no single change.
     * Absent for everything not reintroduced.
     */
    sinceYouLastSaw: z
      .object({ change: z.enum(["NEW_PITCH"]).nullable() })
      .strict()
      .optional(),
    /**
     * Whether this viewer has saved the company (their own interaction
     * state, never a ranking input). Absent when the state could not be
     * read: the client then shows the card as not saved yet.
     */
    viewerSaved: z.boolean().optional(),
    /**
     * Filters the reader applied that this company's shared facts could
     * not answer (its sector or stage is not stated, or its raise is not
     * shared with this reader). Unknown never excludes silently: the
     * company stays and the card says which filter it was not checked
     * against. Absent when no filter was applied.
     */
    filterUnknown: z.array(DiscoverFilterDimensionSchema).max(4).optional(),
  })
  .strict();
export type DiscoveredCompanyDto = z.infer<typeof DiscoveredCompanyDtoSchema>;

export const DiscoveredInvestorDtoSchema = z
  .object({
    investorOrganisationId: UuidSchema,
    displayName: z.string(),
    investorType: z.string(),
    websiteUrl: z.string().nullable(),
    hqCountry: z.string().nullable(),
    publicDescription: z.string().nullable(),
    deploymentState: z.string().nullable(),
    /**
     * How founders may reach them (ADR 0023): the investor's own declared
     * choice. Null is not stated; absent on a page from an older API.
     */
    inboundPreference: z
      .enum(["CLOSED", "QUALIFIED", "OPEN"])
      .nullable()
      .optional(),
    /**
     * The organisation's own photo and cover, as short-lived signed URLs,
     * minted only after the investor was found visible to this reader.
     * Absent or null: none uploaded, or not readable right now.
     */
    photoUrl: z.string().url().nullable().optional(),
    coverUrl: z.string().url().nullable().optional(),
    reasons: z.array(DiscoveryReasonDtoSchema).max(8),
  })
  .strict();
export type DiscoveredInvestorDto = z.infer<typeof DiscoveredInvestorDtoSchema>;

/**
 * `GET /v1/discovery/investors/:investorOrganisationId` — one investor as
 * a founder may see them (network-visible and admitted by disclosure; not
 * the caller's own). Anything else is the same 404 (ADR 0023).
 */
export const DISCOVERY_INVESTOR_PATH =
  "/v1/discovery/investors/:investorOrganisationId" as const;
export const DiscoveredInvestorProfileDtoSchema =
  DiscoveredInvestorDtoSchema.omit({ reasons: true });
export type DiscoveredInvestorProfileDto = z.infer<
  typeof DiscoveredInvestorProfileDtoSchema
>;

export const DiscoveryCompanySlateDtoSchema = z
  .object({
    /** The persisted slate this page came from; null while none is servable. */
    slateId: UuidSchema.nullable(),
    /** Which ranking produced this slate, so a result can be reproduced. */
    rankingVersion: z.string().max(64),
    items: z.array(DiscoveredCompanyDtoSchema),
    notes: z.array(DiscoveryNoteDtoSchema).max(4),
    nextCursor: z.string().max(200).nullable(),
    /**
     * Declared hard exclusions V1 cannot evaluate for any company, said
     * once per page. They withhold nothing (ADR 0020).
     */
    unverifiableExclusions: z
      .array(MandateRuleCodeDtoSchema)
      .max(16)
      .optional(),
    /** With NONE_PASS_HARD_RULES: the declared rules that removed every company. */
    excludingRules: z.array(MandateRuleCodeDtoSchema).max(16).optional(),
    /** How many companies are discoverable to this investor, when an empty page counted them. */
    discoverableCount: z.number().int().min(0).nullable().optional(),
  })
  .strict();
export type DiscoveryCompanySlateDto = z.infer<
  typeof DiscoveryCompanySlateDtoSchema
>;

export const DiscoveryInvestorSlateDtoSchema = z
  .object({
    rankingVersion: z.string().max(64),
    items: z.array(DiscoveredInvestorDtoSchema),
    notes: z.array(DiscoveryNoteDtoSchema).max(4),
    nextCursor: z.string().max(200).nullable(),
  })
  .strict();
export type DiscoveryInvestorSlateDto = z.infer<
  typeof DiscoveryInvestorSlateDtoSchema
>;

// ---------------------------------------------------------------------------
// Why an investor is seeing a company (CQ-REC-007; doc 19 §57, §65).
// ---------------------------------------------------------------------------

/**
 * `GET /v1/discovery/slates/:slateId/companies/:companyId/explanation`.
 *
 * One recommendation, explained by the factors that produced it. The path
 * names a slate and a company because an explanation belongs to the
 * ordering it came from, not to a company in general — and because an old
 * recommendation must be explained by the ranking that produced it.
 * Neither id is authority: the server resolves the actor's own investor
 * organisation and answers NOT_FOUND for anybody else's slate.
 */
export const DISCOVERY_EXPLANATION_PATH =
  "/v1/discovery/slates/:slateId/companies/:companyId/explanation" as const;

export const ExplanationFactorDtoSchema = z
  .object({
    /** STAGE, GEOGRAPHY, TAXONOMY, SEMANTIC, CHEQUE. */
    dimension: z.string().max(32),
    /** MATCH, PARTIAL, MISMATCH, UNKNOWN, NOT_APPLICABLE. */
    outcome: z.string().max(32),
    /** Plain English, bounded, safe to show. */
    label: z.string().max(160),
    /** The ranker's own bounded code. Machine-readable, never a score. */
    reasonCode: z.string().max(64),
  })
  .strict();
export type ExplanationFactorDto = z.infer<typeof ExplanationFactorDtoSchema>;

export const RecommendationExplanationDtoSchema = z
  .object({
    slateId: UuidSchema,
    companyId: UuidSchema,
    /** Position in the reader's own slate. A place in a list, not a verdict. */
    rank: z.number().int().min(1),
    /** Q's phrasing when it was available, the deterministic wording otherwise. */
    summary: z.string().max(1200),
    matchedFactors: z.array(ExplanationFactorDtoSchema).max(8),
    mismatchedFactors: z.array(ExplanationFactorDtoSchema).max(8),
    uncertainties: z.array(ExplanationFactorDtoSchema).max(8),
    /** The ranking that produced this item, so an explanation is reproducible. */
    generatedFromRankingVersion: z.string().max(128),
    /**
     * DETERMINISTIC or Q_SYNTHESIZED. The factors are the same either way;
     * this says only who chose the words, so a reader is never told a model
     * decided something it did not.
     */
    source: z.enum(["DETERMINISTIC", "Q_SYNTHESIZED"]),
  })
  .strict();
export type RecommendationExplanationDto = z.infer<
  typeof RecommendationExplanationDtoSchema
>;

/**
 * Recommendation interactions (CQ-REC-008; doc 19 §66–§69).
 *
 * Two shapes, because two things are happening. A decision — save, unsave,
 * pass — is an explicit command on a named company, and the URL says which
 * one so that no request can change its own meaning. An observation is
 * bounded telemetry: the client reports what it saw, and the `type` enum
 * here admits only the four kinds it is allowed to report.
 *
 * There is deliberately no `POST /interactions { type, tenantId,
 * investorOrganisationId, rank }`. A single endpoint taking an open type
 * and the caller's own context is how an analytics dump becomes an
 * authorisation hole: the server resolves who this is, which organisation
 * it belongs to, what rank the item held and which ranking version
 * produced it, and a client that could name any of those could name better
 * ones.
 */

export const DISCOVERY_INTERACTIONS_PATH =
  "/v1/discovery/interactions" as const;
export const DISCOVERY_SAVED_PATH = "/v1/discovery/saved" as const;
/** `POST /v1/discovery/companies/:companyId/{save|unsave|pass}`. */
export const DISCOVERY_COMPANY_SAVE_PATH =
  "/v1/discovery/companies/:companyId/save" as const;
export const DISCOVERY_COMPANY_UNSAVE_PATH =
  "/v1/discovery/companies/:companyId/unsave" as const;
export const DISCOVERY_COMPANY_PASS_PATH =
  "/v1/discovery/companies/:companyId/pass" as const;
/** Undo a pass (doc 19 §68): the company may be offered again. */
export const DISCOVERY_COMPANY_UNPASS_PATH =
  "/v1/discovery/companies/:companyId/unpass" as const;
/** The investor's passed companies, for Undo pass. Identities only. */
export const DISCOVERY_PASSED_PATH = "/v1/discovery/passed" as const;

/** Bounded, opaque, never a device fingerprint. */
const InteractionOpaqueIdSchema = z.string().regex(/^[A-Za-z0-9_:-]{8,64}$/);

/**
 * What every interaction request may carry.
 *
 * `slateId` is the slate the person was looking at — the server checks it
 * is theirs and reads the rank from it. There is no `position`, no
 * `rankingConfigVersion`, no `investorOrganisationId` and no `tenantId`,
 * because those are the server's answers and a field for them would be a
 * field to forge.
 */
const InteractionContextDtoSchema = {
  clientEventId: InteractionOpaqueIdSchema,
  sessionId: InteractionOpaqueIdSchema.optional(),
  slateId: UuidSchema.optional(),
  surface: z.enum([
    "RECOMMENDATION_FEED",
    "COMPANY_PROFILE",
    "SAVED_LIST",
    "SEARCH",
    "Q_CONVERSATION",
  ]),
} as const;

/**
 * The only interaction types a client may report.
 *
 * SAVE, UNSAVE and PASS are absent because they are commands with their
 * own paths. INTEREST_OBSERVED is absent because Express Interest creates
 * relationship state and CQ-NET-010 owns it — a recommendation route that
 * could write it would be a second, quieter way to start a relationship.
 */
export const ObservedInteractionTypeDtoSchema = z.enum([
  "IMPRESSION",
  "WATCH_MILESTONE",
  "PROFILE_OPEN",
  "ASK_Q",
]);
export type ObservedInteractionTypeDto = z.infer<
  typeof ObservedInteractionTypeDtoSchema
>;

export const RecordInteractionRequestSchema = z
  .object({
    ...InteractionContextDtoSchema,
    type: ObservedInteractionTypeDtoSchema,
    companyId: UuidSchema,
    mediaAssetId: UuidSchema.optional(),
    watchMilestone: z
      .enum(["STARTED", "P25", "P50", "P75", "COMPLETED"])
      .optional(),
  })
  .strict();
export type RecordInteractionRequest = z.infer<
  typeof RecordInteractionRequestSchema
>;

export const SaveCompanyRequestSchema = z
  .object({ ...InteractionContextDtoSchema })
  .strict();
export type SaveCompanyRequest = z.infer<typeof SaveCompanyRequestSchema>;

export const PassCompanyRequestSchema = z
  .object({
    ...InteractionContextDtoSchema,
    /** Optional, always. Doc 17: no feedback modal after every pass. */
    reason: z
      .enum([
        "NOT_NOW",
        "STAGE",
        "SECTOR",
        "GEOGRAPHY",
        "TRACTION",
        "RAISE",
        "TIMING",
        "OTHER",
      ])
      .optional(),
  })
  .strict();
export type PassCompanyRequest = z.infer<typeof PassCompanyRequestSchema>;

/**
 * What an interaction returns.
 *
 * `deduplicated` tells a client its retry was recognised, so it need not
 * guess. No internal score, no rank and no ranking version: the caller
 * told us where they were, and telling them back what the server resolved
 * would hand them the vocabulary to forge it next time.
 */
export const InteractionRecordedDtoSchema = z
  .object({
    recorded: z.literal(true),
    deduplicated: z.boolean(),
    state: z
      .object({
        saved: z.boolean(),
        passed: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type InteractionRecordedDto = z.infer<
  typeof InteractionRecordedDtoSchema
>;

/** The Saved section: identities only; the reader re-checks disclosure. */
export const SavedCompaniesDtoSchema = z
  .object({ companyIds: z.array(UuidSchema).max(200) })
  .strict();
export type SavedCompaniesDto = z.infer<typeof SavedCompaniesDtoSchema>;

// ---------------------------------------------------------------------------
// Founders' network videos (ADR 0021)
// ---------------------------------------------------------------------------

/**
 * `GET /v1/discovery/network-pitches` — videos their owners opened to
 * everyone on Capital Q, newest first, for any signed-in participant.
 * Each company is shown only when disclosure says this viewer may see it;
 * the viewer's own organisation's videos are not included. No ranking,
 * no counters: newest first, cursor pagination.
 */
export const DISCOVERY_NETWORK_PITCHES_PATH =
  "/v1/discovery/network-pitches" as const;

export const NetworkPitchItemDtoSchema = z
  .object({
    companyId: UuidSchema,
    canonicalName: z.string(),
    shortDescription: z.string().nullable(),
    headquartersCountry: z.string().nullable(),
    currentStageCode: z.string().nullable(),
    pitch: PitchSummaryDtoSchema,
    postedAt: UtcTimestampSchema,
  })
  .strict();
export type NetworkPitchItemDto = z.infer<typeof NetworkPitchItemDtoSchema>;

export const NetworkPitchPageDtoSchema = z
  .object({
    items: z.array(NetworkPitchItemDtoSchema).max(50),
    nextCursor: z.string().max(200).nullable(),
  })
  .strict();
export type NetworkPitchPageDto = z.infer<typeof NetworkPitchPageDtoSchema>;

/** The network feed's keyset cursor, decoded: the last video's time and id. */
export const NetworkPitchCursorSchema = z
  .object({ createdAt: UtcTimestampSchema, mediaAssetId: UuidSchema })
  .strict();
