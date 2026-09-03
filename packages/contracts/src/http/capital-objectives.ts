import { z } from "zod";

import { DecimalStringSchema } from "../common/decimal.js";
import { UuidSchema } from "../common/ids.js";
import { CurrencyCodeSchema } from "../common/money.js";
import {
  createCursorPageSchema,
  CursorSchema,
  PageSizeSchema,
} from "../common/pagination.js";
import { LocalDateSchema, UtcTimestampSchema } from "../common/time.js";
import { ResourceVersionSchema } from "../common/version.js";
import { StageCodeSchema } from "./companies.js";

/**
 * `/v1/companies/:companyId/capital-objectives` -- the canonical Capital
 * Objective contract.
 *
 * A Capital Objective is the company's authoritative answer to "what are we
 * raising, how much, in what currency, at what stage, with which instrument,
 * by when, for what, and is it still active". It is structured state, not a
 * Q conversation, not an onboarding draft and not a document.
 *
 *   Company ≠ Capital Objective ≠ Readiness ≠ Progress ≠ Investment Outcome
 *
 * Strict request schemas: identity, lifecycle, authority, progress,
 * readiness and disclosure fields fail validation. Money is exact.
 */

/** V1 supports the company raise only; the column exists so the objective can evolve. */
export const CAPITAL_OBJECTIVE_TYPES = ["RAISE"] as const;
export const CapitalObjectiveTypeSchema = z.enum(CAPITAL_OBJECTIVE_TYPES);
export type CapitalObjectiveType = z.infer<typeof CapitalObjectiveTypeSchema>;

/**
 * The lifecycle preserves why an objective ended. There is deliberately no
 * FAILED or COMPLETED: closing below target is a commercial decision, not a
 * failure, and Capital Q never labels it as one.
 */
export const CAPITAL_OBJECTIVE_STATUSES = [
  "ACTIVE",
  "ACHIEVED",
  "CLOSED_BY_FOUNDER",
  "DISCONTINUED",
  "REPLACED",
] as const;
export const CapitalObjectiveStatusSchema = z.enum(CAPITAL_OBJECTIVE_STATUSES);
export type CapitalObjectiveStatus = z.infer<
  typeof CapitalObjectiveStatusSchema
>;

/** Closure reasons a person may state. REPLACED is produced only by the replace workflow. */
export const CAPITAL_OBJECTIVE_CLOSURE_REASONS = [
  "ACHIEVED",
  "CLOSED_BY_FOUNDER",
  "DISCONTINUED",
] as const;
export const CapitalObjectiveClosureReasonSchema = z.enum(
  CAPITAL_OBJECTIVE_CLOSURE_REASONS,
);
export type CapitalObjectiveClosureReason = z.infer<
  typeof CapitalObjectiveClosureReasonSchema
>;

export const USE_OF_FUNDS_MAX_LENGTH = 2000;

/**
 * Financing instrument, distinct from the funding stage and from the
 * objective type. Bounded code until CQ-TAX-001/002 supply a vocabulary
 * (ADR 0002). Examples: `safe`, `priced_equity`, `convertible_note`.
 */
export const InstrumentCodeSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9._-]{0,63}$/,
    "expected a bounded lowercase instrument code",
  );

/** A strictly positive exact amount. Unknown targets are not promoted, never written as zero. */
export const PositiveDecimalStringSchema = DecimalStringSchema.refine(
  (value) => !value.startsWith("-") && /[1-9]/.test(value),
  { message: "expected an amount greater than zero" },
);

/** Exact money with an explicit currency. A currency symbol is not a code. */
export const CapitalTargetSchema = z
  .object({
    amount: PositiveDecimalStringSchema,
    currency: CurrencyCodeSchema,
  })
  .strict();
export type CapitalTarget = z.infer<typeof CapitalTargetSchema>;

const UseOfFundsSchema = z.string().trim().min(1).max(USE_OF_FUNDS_MAX_LENGTH);

export const CreateCapitalObjectiveRequestSchema = z
  .object({
    objectiveType: CapitalObjectiveTypeSchema.optional(),
    target: CapitalTargetSchema,
    targetStage: StageCodeSchema.optional(),
    instrumentCode: InstrumentCodeSchema.optional(),
    targetCloseDate: LocalDateSchema.optional(),
    useOfFundsSummary: UseOfFundsSchema.optional(),
  })
  .strict();
export type CreateCapitalObjectiveRequest = z.infer<
  typeof CreateCapitalObjectiveRequestSchema
>;

/** Recalibration fields. Status, dates of record and objective type are not among them. */
export const CAPITAL_OBJECTIVE_EDITABLE_FIELDS = [
  "target",
  "targetStage",
  "instrumentCode",
  "targetCloseDate",
  "useOfFundsSummary",
] as const;
export type CapitalObjectiveEditableField =
  (typeof CAPITAL_OBJECTIVE_EDITABLE_FIELDS)[number];

export const UpdateCapitalObjectiveRequestSchema = z
  .object({
    expectedVersion: ResourceVersionSchema,
    target: CapitalTargetSchema.optional(),
    targetStage: StageCodeSchema.nullable().optional(),
    instrumentCode: InstrumentCodeSchema.nullable().optional(),
    targetCloseDate: LocalDateSchema.nullable().optional(),
    useOfFundsSummary: UseOfFundsSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      CAPITAL_OBJECTIVE_EDITABLE_FIELDS.some(
        (field) => value[field] !== undefined,
      ),
    { message: "expected at least one field to update" },
  );
export type UpdateCapitalObjectiveRequest = z.infer<
  typeof UpdateCapitalObjectiveRequestSchema
>;

export const CloseCapitalObjectiveRequestSchema = z
  .object({
    reason: CapitalObjectiveClosureReasonSchema,
    expectedVersion: ResourceVersionSchema,
  })
  .strict();
export type CloseCapitalObjectiveRequest = z.infer<
  typeof CloseCapitalObjectiveRequestSchema
>;

/** A deliberate new objective: the old one becomes REPLACED, the new one gets a new id. */
export const ReplaceCapitalObjectiveRequestSchema = z
  .object({
    expectedVersion: ResourceVersionSchema,
    replacement: CreateCapitalObjectiveRequestSchema,
  })
  .strict();
export type ReplaceCapitalObjectiveRequest = z.infer<
  typeof ReplaceCapitalObjectiveRequestSchema
>;

/**
 * Organisation-internal shape. Carries the target and the use-of-funds
 * summary because authorised company users edit them. Discover, the Q Card
 * and investor-facing profiles must use a disclosure-safe projection, never
 * this DTO.
 */
export const CapitalObjectiveDtoSchema = z.object({
  id: UuidSchema,
  companyId: UuidSchema,
  objectiveType: CapitalObjectiveTypeSchema,
  status: CapitalObjectiveStatusSchema,
  target: CapitalTargetSchema,
  targetStage: z.string().nullable(),
  instrumentCode: z.string().nullable(),
  targetCloseDate: LocalDateSchema.nullable(),
  useOfFundsSummary: z.string().nullable(),
  startedAt: UtcTimestampSchema,
  closedAt: UtcTimestampSchema.nullable(),
  version: ResourceVersionSchema,
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
});
export type CapitalObjectiveDto = z.infer<typeof CapitalObjectiveDtoSchema>;

export const ListCapitalObjectivesResponseSchema = createCursorPageSchema(
  CapitalObjectiveDtoSchema,
);
export type ListCapitalObjectivesResponse = z.infer<
  typeof ListCapitalObjectivesResponseSchema
>;

/** Query-string form: values arrive as strings. No other filters. */
export const ListCapitalObjectivesQuerySchema = z
  .object({
    cursor: CursorSchema.optional(),
    limit: z.preprocess(
      (value) =>
        value === undefined || value === "" ? undefined : Number(value),
      PageSizeSchema.optional(),
    ),
  })
  .strict();
export type ListCapitalObjectivesQuery = z.infer<
  typeof ListCapitalObjectivesQuerySchema
>;

export const CAPITAL_OBJECTIVES_SUFFIX = "/capital-objectives" as const;
export const CAPITAL_OBJECTIVE_CURRENT_SEGMENT = "/current" as const;
export const CAPITAL_OBJECTIVE_CLOSE_SUFFIX = "/close" as const;
export const CAPITAL_OBJECTIVE_REPLACE_SUFFIX = "/replace" as const;
