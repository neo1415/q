import { z } from "zod";

/**
 * Discovery (doc 19).
 *
 * Who an investor or a founder could reasonably meet, chosen by declared
 * eligibility and declared fit, ranked deterministically, and explained
 * from the fields that produced it.
 *
 * The rules this exists to keep, all from doc 19 and the PADL:
 *
 * No model runs in this path. Ranking is deterministic, explainable,
 * versioned and reproducible: the same inputs give the same slate, and the
 * weights live in one versioned constant rather than scattered numbers.
 *
 * Hard exclusions come only from declared rules. Nothing is inferred from
 * browsing, and viewing is not interest.
 *
 * Nothing private crosses the network. An investor is matched against
 * their own mandate — their data, used for them. A founder is NOT matched
 * against an investor's mandate, because that mandate is investor-private
 * and §204.9 makes it release-blocking that private investor behaviour
 * must not shape what a founder sees. Until an investor publishes a
 * mandate deliberately, founder-facing discovery ranks on the declared
 * profile alone and says so.
 *
 * Nothing is ranked by popularity, watch time, clicks or recency of
 * activity. There is no pay-to-rank and there never will be.
 */

/** Bumped whenever a weight, a signal or the order changes. Recorded on every slate. */
export const DISCOVERY_RANKING_VERSION = "discovery.v1" as const;

/**
 * Why one counterpart is in the slate. Each reason names the declared
 * field that produced it, so a person can check it against their own
 * profile. A slate entry with no reasons is eligible but unexplained, and
 * is ranked below every explained one.
 */
export const DISCOVERY_REASON_KINDS = [
  /** The company's declared stage sits inside the mandate's declared range. */
  "STAGE_IN_RANGE",
  /** A taxonomy node the mandate asked for is one the company is classified under. */
  "SECTOR_MATCH",
  "GEOGRAPHY_MATCH",
  "BUSINESS_MODEL_MATCH",
  "CUSTOMER_TYPE_MATCH",
  /** The investor says they are deploying. Declared, never observed. */
  "DECLARED_DEPLOYING",
  /** Enough of the declared profile is filled in to be worth reading. */
  "PROFILE_COMPLETE",
] as const;
export const DiscoveryReasonKindSchema = z.enum(DISCOVERY_REASON_KINDS);
export type DiscoveryReasonKind = z.infer<typeof DiscoveryReasonKindSchema>;

export const DiscoveryReasonSchema = z
  .object({
    kind: DiscoveryReasonKindSchema,
    /** The declared value that matched, in the person's own vocabulary. */
    detail: z.string().max(200),
  })
  .strict();
export type DiscoveryReason = z.infer<typeof DiscoveryReasonSchema>;

/**
 * One company as a founder-facing investor sees it: the network projection
 * and nothing else, plus why it is here.
 */
export const DiscoveredCompanySchema = z
  .object({
    companyId: z.string().uuid(),
    canonicalName: z.string(),
    websiteUrl: z.string().nullable(),
    headquartersCountry: z.string().nullable(),
    currentStageCode: z.string().nullable(),
    shortDescription: z.string().nullable(),
    reasons: z.array(DiscoveryReasonSchema).max(8),
    /**
     * The deterministic score that produced this position. Shown to no
     * one: it is here so a slate can be reproduced and audited, and doc 19
     * forbids presenting an invented number as a verdict.
     */
    rank: z.number().int().min(0),
  })
  .strict();
export type DiscoveredCompany = z.infer<typeof DiscoveredCompanySchema>;

/** One investor as a founder sees it: the declared profile, and why it is here. */
export const DiscoveredInvestorSchema = z
  .object({
    investorOrganisationId: z.string().uuid(),
    displayName: z.string(),
    investorType: z.string(),
    websiteUrl: z.string().nullable(),
    hqCountry: z.string().nullable(),
    publicDescription: z.string().nullable(),
    deploymentState: z.string().nullable(),
    reasons: z.array(DiscoveryReasonSchema).max(8),
    rank: z.number().int().min(0),
  })
  .strict();
export type DiscoveredInvestor = z.infer<typeof DiscoveredInvestorSchema>;

/**
 * Why a slate is thin, when it is. A person who sees three results
 * deserves to know whether that is the whole network or their own mandate.
 */
export const DISCOVERY_NOTES = [
  /** The person has no active mandate, so nothing could be matched on. */
  "NO_ACTIVE_MANDATE",
  /** Their mandate declares no stage range, sector or geography yet. */
  "MANDATE_HAS_NO_PREFERENCES",
  /** Nobody on the network is discoverable yet. */
  "NO_DISCOVERABLE_COUNTERPARTS",
  /**
   * Founder-facing results are ranked on the declared investor profile
   * only; an investor's mandate is theirs and is not read here.
   */
  "RANKED_ON_DECLARED_PROFILE_ONLY",
] as const;
export const DiscoveryNoteSchema = z.enum(DISCOVERY_NOTES);
export type DiscoveryNote = z.infer<typeof DiscoveryNoteSchema>;

export const DiscoveryCompanySlateSchema = z
  .object({
    rankingVersion: z.literal(DISCOVERY_RANKING_VERSION),
    items: z.array(DiscoveredCompanySchema),
    notes: z.array(DiscoveryNoteSchema).max(4),
    /** Keyset, never an offset. Absent when the slate is complete. */
    nextCursor: z.string().max(200).nullable(),
  })
  .strict();
export type DiscoveryCompanySlate = z.infer<typeof DiscoveryCompanySlateSchema>;

export const DiscoveryInvestorSlateSchema = z
  .object({
    rankingVersion: z.literal(DISCOVERY_RANKING_VERSION),
    items: z.array(DiscoveredInvestorSchema),
    notes: z.array(DiscoveryNoteSchema).max(4),
    nextCursor: z.string().max(200).nullable(),
  })
  .strict();
export type DiscoveryInvestorSlate = z.infer<
  typeof DiscoveryInvestorSlateSchema
>;

export const DISCOVERY_LIMIT_DEFAULT = 20;
export const DISCOVERY_LIMIT_MAX = 50;
/** Candidates considered before ranking. Bounded: a slate is not a scan. */
export const DISCOVERY_CANDIDATE_MAX = 200;
