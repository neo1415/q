import { z } from "zod";

import { UtcTimestampSchema } from "../common/time.js";
import { UuidSchema } from "../common/ids.js";
import { PitchSummaryDtoSchema } from "./media.js";

/**
 * Explore (E1-E5, ADR 0055): every pitch on the network this viewer may
 * see, broader than Discover and only lightly personalised.
 *
 * Deterministic and explainable: each tile carries the one reason it is
 * shown, from a closed vocabulary. Nothing here is engagement: there is no
 * view, like or watch count on the wire, no popularity term in the order
 * and no score. Viewing is not interest; a tile's reason never comes from
 * what the viewer watched.
 */

export const DISCOVERY_EXPLORE_PATH = "/v1/discovery/explore" as const;
export const DISCOVERY_EXPLORE_RELATED_PATH =
  "/v1/discovery/explore/related/:mediaAssetId" as const;
export const DISCOVERY_EXPLORE_SEARCH_PATH =
  "/v1/discovery/explore/search" as const;

export const EXPLORE_MODES = ["FOR_YOU", "EVERYTHING"] as const;
export const ExploreModeSchema = z.enum(EXPLORE_MODES);
export type ExploreMode = z.infer<typeof ExploreModeSchema>;

/** The candidate source that put a tile in the slate. */
export const EXPLORE_SOURCES = [
  "MANDATE",
  "ADJACENT",
  "SAVED",
  "NEWEST",
  "EXPLORATION",
] as const;
export const ExploreSourceSchema = z.enum(EXPLORE_SOURCES);
export type ExploreSource = z.infer<typeof ExploreSourceSchema>;

/** Why a tile is shown, said in one line on the tile. */
export const EXPLORE_REASON_CODES = [
  /** In the viewer's Discover slate: their declared mandate fits. */
  "MATCHES_MANDATE",
  /** One rung either side of the mandate's stage, or a mandate sector at another stage. */
  "CLOSE_TO_MANDATE",
  /** Shares a sector with a company the viewer saved or expressed interest in (explicit actions, never views). */
  "LIKE_YOUR_SAVES",
  /** A founder's peer: shares a sector with their own company. */
  "NEAR_YOUR_COMPANY",
  /** Posted in the last seven days. */
  "NEW_THIS_WEEK",
  /** Outside what the viewer declared: exploration, labelled as such. */
  "OUTSIDE_USUAL_FOCUS",
  /** No personal reason: it is on the network (Everything, or no mandate). */
  "ON_THE_NETWORK",
] as const;
export const ExploreReasonCodeSchema = z.enum(EXPLORE_REASON_CODES);
export type ExploreReasonCode = z.infer<typeof ExploreReasonCodeSchema>;

/** Why a pitch is in a "Related to X" feed. */
export const EXPLORE_RELATED_REASONS = [
  "SAME_COMPANY",
  "SAME_SECTOR",
  "SAME_STAGE",
  "SAME_GEOGRAPHY",
] as const;
export const ExploreRelatedReasonSchema = z.enum(EXPLORE_RELATED_REASONS);
export type ExploreRelatedReason = z.infer<typeof ExploreRelatedReasonSchema>;

export const ExploreTileDtoSchema = z
  .object({
    companyId: UuidSchema,
    canonicalName: z.string(),
    shortDescription: z.string().nullable(),
    headquartersCountry: z.string().nullable(),
    currentStageCode: z.string().nullable(),
    /** Declared industry nodes, as disclosure shows them; the client names them. */
    sectorNodeIds: z.array(UuidSchema).max(8),
    pitch: PitchSummaryDtoSchema,
    postedAt: UtcTimestampSchema,
    source: ExploreSourceSchema,
    reason: ExploreReasonCodeSchema,
  })
  .strict();
export type ExploreTileDto = z.infer<typeof ExploreTileDtoSchema>;

/**
 * One page of an Explore slate. `upToDate` is the end of the slate: the
 * client says so and stops; there is no endless scroll past it.
 */
export const ExplorePageDtoSchema = z
  .object({
    rankingVersion: z.string().max(40),
    mode: ExploreModeSchema,
    items: z.array(ExploreTileDtoSchema).max(50),
    nextCursor: z.string().max(400).nullable(),
    upToDate: z.boolean(),
  })
  .strict();
export type ExplorePageDto = z.infer<typeof ExplorePageDtoSchema>;

/**
 * The cursor, opaque to the client: the slate's cut-off (pitches posted
 * after the first page do not shift later pages) and the next position.
 */
export const ExploreCursorSchema = z
  .object({
    v: z.literal(1),
    mode: ExploreModeSchema,
    asOf: UtcTimestampSchema,
    position: z.number().int().min(0).max(10_000),
  })
  .strict();
export type ExploreCursor = z.infer<typeof ExploreCursorSchema>;

export const ExploreRelatedItemDtoSchema = ExploreTileDtoSchema.extend({
  related: z.array(ExploreRelatedReasonSchema).min(1).max(4),
}).strict();
export type ExploreRelatedItemDto = z.infer<typeof ExploreRelatedItemDtoSchema>;

/** `GET .../explore/related/:mediaAssetId`: the opened pitch, then pitches like it. */
export const ExploreRelatedDtoSchema = z
  .object({
    anchor: ExploreTileDtoSchema,
    items: z.array(ExploreRelatedItemDtoSchema).max(24),
  })
  .strict();
export type ExploreRelatedDto = z.infer<typeof ExploreRelatedDtoSchema>;

export const EXPLORE_SEARCH_TABS = [
  "top",
  "companies",
  "investors",
  "people",
  "pitches",
] as const;
export const ExploreSearchTabSchema = z.enum(EXPLORE_SEARCH_TABS);
export type ExploreSearchTab = z.infer<typeof ExploreSearchTabSchema>;

/** A company result: it opens the company's profile, never a Q card. */
export const ExploreCompanyResultDtoSchema = z
  .object({
    companyId: UuidSchema,
    canonicalName: z.string(),
    shortDescription: z.string().nullable(),
    headquartersCountry: z.string().nullable(),
    currentStageCode: z.string().nullable(),
  })
  .strict();
export type ExploreCompanyResultDto = z.infer<
  typeof ExploreCompanyResultDtoSchema
>;

/** `GET .../explore/search?q=`: companies and pitches the viewer may see. */
export const ExploreSearchDtoSchema = z
  .object({
    query: z.string().max(80),
    companies: z.array(ExploreCompanyResultDtoSchema).max(30),
    pitches: z.array(ExploreTileDtoSchema).max(30),
  })
  .strict();
export type ExploreSearchDto = z.infer<typeof ExploreSearchDtoSchema>;

/** Where a result opens: always the profile (E4). */
export function exploreProfileHref(
  kind: "company" | "investor",
  id: string,
): string {
  return kind === "company"
    ? `/company/${encodeURIComponent(id)}`
    : `/investors/${encodeURIComponent(id)}`;
}
