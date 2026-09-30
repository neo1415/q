import { z } from "zod";

import { UuidSchema } from "../common/ids.js";

/**
 * Capital Q's admin console (founder direction 2026-09-29/30): the
 * attribution and fee ledger, disputes and usage. Platform admins only;
 * for anyone else every path is the same 404.
 */

export const ADMIN_OVERVIEW_PATH = "/v1/admin/overview" as const;
export const ADMIN_ATTRIBUTION_PATH = "/v1/admin/attribution" as const;
export const ADMIN_DISPUTES_PATH = "/v1/admin/disputes" as const;

const MoneyRow = z
  .object({ currencyCode: z.string(), amount: z.string() })
  .strict();

export const AdminOverviewDtoSchema = z
  .object({
    people: z.number().int(),
    companies: z.number().int(),
    investorOrganisations: z.number().int(),
    relationships: z.number().int(),
    connected: z.number().int(),
    meetingsHeld: z.number().int(),
    recordingsDeclined: z.number().int(),
    confirmed: z.array(MoneyRow),
    applications: z.number().int(),
    modelSpendUsd30d: z.string(),
  })
  .strict();
export type AdminOverviewDto = z.infer<typeof AdminOverviewDtoSchema>;

export const AttributionRowDtoSchema = z
  .object({
    relationshipId: UuidSchema,
    companyName: z.string(),
    investorName: z.string(),
    origin: z.string(),
    startedAt: z.string(),
    connectedAt: z.string().nullable(),
    meetingsHeld: z.number().int(),
    recordingsDeclined: z.number().int(),
    detected: z.number().int(),
    disputed: z.number().int(),
    confirmed: z.array(MoneyRow),
    lastActivityAt: z.string(),
  })
  .strict();
export type AttributionRowDto = z.infer<typeof AttributionRowDtoSchema>;

export const AttributionListDtoSchema = z
  .object({ rows: z.array(AttributionRowDtoSchema).max(500) })
  .strict();

export const DisputeRowDtoSchema = z
  .object({
    commitmentId: UuidSchema,
    relationshipId: UuidSchema,
    companyName: z.string(),
    investorName: z.string(),
    amount: z.string(),
    currencyCode: z.string(),
    quote: z.string().nullable(),
    disputedAt: z.string(),
  })
  .strict();
export type DisputeRowDto = z.infer<typeof DisputeRowDtoSchema>;

export const DisputeListDtoSchema = z
  .object({ rows: z.array(DisputeRowDtoSchema).max(100) })
  .strict();

/** Accounts Q paused (founder direction 2026-09-30), for an operator. */
export const ADMIN_PAUSED_PATH = "/v1/admin/paused" as const;
/** An operator reinstates one paused account. */
export const ADMIN_REINSTATE_PATH =
  "/v1/admin/paused/:userId/reinstate" as const;
export const adminReinstatePath = (userId: string) =>
  ADMIN_REINSTATE_PATH.replace(":userId", encodeURIComponent(userId));

export const PausedRowDtoSchema = z
  .object({
    userId: UuidSchema,
    name: z.string().nullable(),
    email: z.string().nullable(),
    strikes: z.number().int().min(0),
    pausedAt: z.string(),
    reason: z.string().nullable(),
  })
  .strict();
export type PausedRowDto = z.infer<typeof PausedRowDtoSchema>;

export const PausedListDtoSchema = z
  .object({ rows: z.array(PausedRowDtoSchema).max(100) })
  .strict();

export const ReinstatedDtoSchema = z
  .object({ reinstated: z.literal(true) })
  .strict();
