import { z } from "zod";

import { BillingFeatureStandingDtoSchema } from "../http/billing.js";
import { UuidSchema } from "../common/ids.js";
import { MODEL_USAGE_PURPOSES } from "../model/index.js";

/**
 * PUBLIC. The person's own usage this month (lead 2026-10-03: "This month:
 * Q used about $X for you"), read-only. Money is decimal USD as a string,
 * never a float; "about" because unpriced calls are counted at no cost and
 * prices are snapshots. Nothing here is a charge: no prices are set for
 * the person (RATE_NOT_SET) and nothing is billed from it.
 */
export const Q_USAGE_PATH = "/v1/q/usage" as const;

const Usd = z.string().regex(/^\d{1,9}(\.\d{1,6})?$/u);

export const QUsageDtoSchema = z
  .object({
    /** The calendar month, UTC, as YYYY-MM. */
    month: z.string().regex(/^\d{4}-\d{2}$/u),
    totalUsd: Usd,
    calls: z.number().int().min(0),
    /** Successful calls whose cost is not known (no price); counted at no cost. */
    unpricedCalls: z.number().int().min(0),
    /** Calls that failed; never charged. Absent from an older server: 0. */
    failedCalls: z.number().int().min(0).default(0),
    byTask: z
      .array(
        z
          .object({
            purpose: z.enum(MODEL_USAGE_PURPOSES),
            usd: Usd,
            calls: z.number().int().min(0),
          })
          .strict(),
      )
      .max(MODEL_USAGE_PURPOSES.length),
    /** Their standing instructions this month, by name, with each budget. */
    instructions: z
      .array(
        z
          .object({
            instructionId: UuidSchema,
            goal: z.string().max(200),
            usd: Usd,
            budgetUsdMonth: z.string().max(16).nullable(),
          })
          .strict(),
      )
      .max(20),
    /** Their plan's Q limits (ADR 0034); null when no plan could be read. */
    plan: z
      .object({
        name: z.string().max(120),
        features: z.array(BillingFeatureStandingDtoSchema).max(50),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type QUsageDto = z.infer<typeof QUsageDtoSchema>;
