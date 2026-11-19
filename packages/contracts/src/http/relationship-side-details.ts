import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { CurrencyCodeSchema } from "../common/money.js";
import { UtcTimestampSchema } from "../common/time.js";

/**
 * A side's own pipeline fields on one canonical relationship (CRM import
 * gaps 1-5, docs/specs/crm-import/2026-11-18-crm-import-research.md §4):
 * the side's own stage, its deal owner, where the relationship came from
 * and who introduced it, the cheque or ticket it expects, and its priority.
 *
 *   side details ≠ the relationship's state, a deal, a match or a CRM record
 *
 * Each side keeps its own (an investor's on its investor organisation, a
 * founder's on their company); the counterpart never reads them and they
 * never move the shared relationship state, which only the two parties'
 * own actions do. Every value is the side's own claim (USER_CLAIM).
 */

/**
 * The side's own stage, on the pipeline vocabulary the import reads labels
 * onto (`PIPELINE_IMPORT_STAGES` without UNKNOWN: an unclear label is kept
 * as the side's own words with no stage). Reference data, not an enum in
 * the database.
 */
export const RELATIONSHIP_SIDE_STAGES = [
  "RESEARCH",
  "CONTACTED",
  "MEETING",
  "DILIGENCE",
  "TERM_SHEET",
  "COMMITTED",
  "CLOSED",
  "PASSED",
  "PAUSED",
] as const;
export const RelationshipSideStageSchema = z.enum(RELATIONSHIP_SIDE_STAGES);
export type RelationshipSideStage = z.infer<typeof RelationshipSideStageSchema>;

export const RELATIONSHIP_SIDE_PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;
export const RelationshipSidePrioritySchema = z.enum(
  RELATIONSHIP_SIDE_PRIORITIES,
);
export type RelationshipSidePriority = z.infer<
  typeof RelationshipSidePrioritySchema
>;

/** A positive exact amount, at most 15 whole digits and 2 decimals. */
export const SIDE_AMOUNT_PATTERN = /^(0|[1-9]\d{0,14})(\.\d{1,2})?$/;
export const RelationshipSideAmountSchema = z
  .object({
    amount: z
      .string()
      .regex(SIDE_AMOUNT_PATTERN, 'expected an exact amount such as "250000"')
      .refine((value) => /[1-9]/.test(value), "expected more than zero"),
    currency: CurrencyCodeSchema,
  })
  .strict();
export type RelationshipSideAmount = z.infer<
  typeof RelationshipSideAmountSchema
>;

export const RELATIONSHIP_SIDE_TEXT_MAX = 200;
const SideText = z.string().trim().min(1).max(RELATIONSHIP_SIDE_TEXT_MAX);
const SideStageLabel = z.string().trim().min(1).max(80);
const SideEmail = z.string().trim().toLowerCase().email().max(254);

export const RelationshipSideDetailsSchema = z
  .object({
    relationshipId: UuidSchema,
    side: z.enum(["INVESTOR", "COMPANY"]),
    stage: RelationshipSideStageSchema.nullable(),
    /** The side's own words for the stage (an imported label), if any. */
    stageLabel: z.string().max(80).nullable(),
    /** The deal owner: a member of the side's own organisation. */
    owner: z
      .object({
        membershipId: UuidSchema,
        name: z.string().max(200).nullable(),
      })
      .strict()
      .nullable(),
    /** Where it came from, in the side's words ("Warm intro", "Conference"). */
    source: z.string().max(RELATIONSHIP_SIDE_TEXT_MAX).nullable(),
    /** Who introduced it, when known. */
    introducerName: z.string().max(RELATIONSHIP_SIDE_TEXT_MAX).nullable(),
    introducerEmail: z.string().max(254).nullable(),
    /** The cheque (founder side) or ticket (investor side) the side expects. */
    expected: RelationshipSideAmountSchema.nullable(),
    priority: RelationshipSidePrioritySchema.nullable(),
    /** 0 when the side has set nothing yet. */
    revision: z.number().int().min(0),
    updatedAt: UtcTimestampSchema.nullable(),
    visibility: z.literal("organisation_private"),
  })
  .strict();
export type RelationshipSideDetails = z.infer<
  typeof RelationshipSideDetailsSchema
>;

/** A member of the side's organisation who may own the relationship. */
export const RelationshipSideMemberSchema = z
  .object({
    membershipId: UuidSchema,
    name: z.string().min(1).max(200),
  })
  .strict();
export type RelationshipSideMember = z.infer<
  typeof RelationshipSideMemberSchema
>;

export const RelationshipSideDetailsReadSchema = z
  .object({
    details: RelationshipSideDetailsSchema,
    /** The active members of the side's organisation, for the owner choice. */
    members: z.array(RelationshipSideMemberSchema).max(200),
  })
  .strict();
export type RelationshipSideDetailsRead = z.infer<
  typeof RelationshipSideDetailsReadSchema
>;

/**
 * A change to the side's own fields. A field left out is unchanged; null
 * clears it. `revision` is the revision the person saw: a save over a newer
 * one is refused, never silently overwritten.
 */
export const UpdateRelationshipSideDetailsRequestSchema = z
  .object({
    revision: z.number().int().min(0),
    stage: RelationshipSideStageSchema.nullable().optional(),
    stageLabel: SideStageLabel.nullable().optional(),
    ownerMembershipId: UuidSchema.nullable().optional(),
    source: SideText.nullable().optional(),
    introducerName: SideText.nullable().optional(),
    introducerEmail: SideEmail.nullable().optional(),
    expected: RelationshipSideAmountSchema.nullable().optional(),
    priority: RelationshipSidePrioritySchema.nullable().optional(),
  })
  .strict();
export type UpdateRelationshipSideDetailsRequest = z.infer<
  typeof UpdateRelationshipSideDetailsRequestSchema
>;

/** What a pipeline row shows of the reader's own side's fields. */
export const RelationshipMySideSummarySchema = z
  .object({
    stage: RelationshipSideStageSchema.nullable(),
    stageLabel: z.string().max(80).nullable(),
    priority: RelationshipSidePrioritySchema.nullable(),
    ownerName: z.string().max(200).nullable(),
  })
  .strict();
export type RelationshipMySideSummary = z.infer<
  typeof RelationshipMySideSummarySchema
>;

/** An investor's own fields on one of its relationships. */
export const NETWORK_RELATIONSHIP_SIDE_DETAILS_PATH =
  "/v1/network/relationships/:relationshipId/side-details" as const;
/** A founder's, under their company (the id is checked, never proof). */
export const NETWORK_COMPANY_RELATIONSHIP_SIDE_DETAILS_PATH =
  "/v1/network/companies/:companyId/relationships/:relationshipId/side-details" as const;
