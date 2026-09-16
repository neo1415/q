import { z } from "zod";

import { UuidSchema } from "../common/ids.js";

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
]);
export type DiscoveryNoteDto = z.infer<typeof DiscoveryNoteDtoSchema>;

export const DiscoveredCompanyDtoSchema = z
  .object({
    companyId: UuidSchema,
    canonicalName: z.string(),
    websiteUrl: z.string().nullable(),
    headquartersCountry: z.string().nullable(),
    currentStageCode: z.string().nullable(),
    shortDescription: z.string().nullable(),
    reasons: z.array(DiscoveryReasonDtoSchema).max(8),
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
    reasons: z.array(DiscoveryReasonDtoSchema).max(8),
  })
  .strict();
export type DiscoveredInvestorDto = z.infer<typeof DiscoveredInvestorDtoSchema>;

export const DiscoveryCompanySlateDtoSchema = z
  .object({
    /** Which ranking produced this slate, so a result can be reproduced. */
    rankingVersion: z.string().max(64),
    items: z.array(DiscoveredCompanyDtoSchema),
    notes: z.array(DiscoveryNoteDtoSchema).max(4),
    nextCursor: z.string().max(200).nullable(),
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
