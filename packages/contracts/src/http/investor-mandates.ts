import { z } from "zod";

import { DecimalStringSchema } from "../common/decimal.js";
import { UuidSchema } from "../common/ids.js";
import { CurrencyCodeSchema } from "../common/money.js";
import {
  createCursorPageSchema,
  CursorSchema,
  PageSizeSchema,
} from "../common/pagination.js";
import { UtcTimestampSchema } from "../common/time.js";
import { ResourceVersionSchema } from "../common/version.js";
import { StageCodeSchema } from "./companies.js";

/**
 * `/v1/investors/:investorOrganisationId/mandates` -- the declared investor
 * mandate contract.
 *
 * A mandate is what an investor organisation explicitly says it is looking
 * for: cheque range, stages, geographies, sectors, business and founder
 * attributes, green and red flags, hard exclusions, discovery style and
 * private narrative. It is declared policy only:
 *
 *   Declared Mandate ≠ Observed Behaviour ≠ Q Inference ≠ GateQ ≠ Deployment State
 *
 * Constraints are DATA, never rules: closed dimension and operator
 * vocabularies, three typed value shapes, bounded sizes. There is no
 * expression language and nothing here is ever executed.
 *
 * This is the organisation-internal contract. A future founder-facing
 * Investor Profile projection must not reuse these DTOs: they carry raw
 * mandate text and the full declared constraint set.
 */

export const INVESTOR_MANDATE_STATUSES = ["DRAFT", "ACTIVE", "CLOSED"] as const;
export const InvestorMandateStatusSchema = z.enum(INVESTOR_MANDATE_STATUSES);
export type InvestorMandateStatus = z.infer<typeof InvestorMandateStatusSchema>;

/**
 * How far discovery may stray from the explicit mandate. None of these
 * bypasses a hard exclusion, and none is GateQ inbound policy.
 */
export const DISCOVERY_MODES = ["STRICT", "BALANCED", "EXPLORATORY"] as const;
export const DiscoveryModeSchema = z.enum(DISCOVERY_MODES);
export type DiscoveryMode = z.infer<typeof DiscoveryModeSchema>;

/**
 * Declared preference strength. AVOID is a soft negative (the candidate may
 * still appear); HARD_EXCLUSION makes the candidate ineligible in standard
 * discovery. They are never collapsed. Ranking weights are not defined here.
 */
export const MANDATE_PREFERENCE_CLASSES = [
  "MUST",
  "STRONG",
  "NICE",
  "NEUTRAL",
  "AVOID",
  "HARD_EXCLUSION",
] as const;
export const MandatePreferenceClassSchema = z.enum(MANDATE_PREFERENCE_CLASSES);
export type MandatePreferenceClass = z.infer<
  typeof MandatePreferenceClassSchema
>;

export const MANDATE_CONSTRAINT_OPERATORS = [
  "EQ",
  "NEQ",
  "IN",
  "NOT_IN",
  "GTE",
  "LTE",
  "BETWEEN",
] as const;
export const MandateConstraintOperatorSchema = z.enum(
  MANDATE_CONSTRAINT_OPERATORS,
);
export type MandateConstraintOperator = z.infer<
  typeof MandateConstraintOperatorSchema
>;

/**
 * The closed V1 dimension allowlist. Investment-relevant business and
 * founder dimensions only: no protected or sensitive personal
 * characteristic can be expressed, by construction.
 *
 * `cheque.typical` is derived from `chequeRange.typical` and is not
 * accepted as a client-supplied constraint; `custom.text` is stored but is
 * MANUAL_ONLY for automated use.
 */
export const MANDATE_CONSTRAINT_INPUT_DIMENSIONS = [
  "stage",
  "geography.country",
  "sector",
  "business.attribute",
  "founder.business_attribute",
  "green_flag",
  "red_flag",
  "investment_role",
  "custom.text",
] as const;
export const MANDATE_CONSTRAINT_DIMENSIONS = [
  ...MANDATE_CONSTRAINT_INPUT_DIMENSIONS,
  "cheque.typical",
] as const;
export const MandateConstraintInputDimensionSchema = z.enum(
  MANDATE_CONSTRAINT_INPUT_DIMENSIONS,
);
export const MandateConstraintDimensionSchema = z.enum(
  MANDATE_CONSTRAINT_DIMENSIONS,
);
export type MandateConstraintDimension = z.infer<
  typeof MandateConstraintDimensionSchema
>;

export const MANDATE_CONSTRAINTS_MAX = 100;
export const MANDATE_CONSTRAINT_CODES_MAX = 50;
export const MANDATE_CUSTOM_TEXT_MAX_LENGTH = 1000;
export const MANDATE_RAW_TEXT_MAX_LENGTH = 8192;
export const MANDATE_NAME_MAX_LENGTH = 120;

/** A bounded declared code. Not yet canonical taxonomy; CQ-TAX-002 maps it. */
export const DeclaredCodeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "expected a lower_snake_case code")
  .max(64);

/** A non-negative exact amount. Unknown is expressed by omission, never by zero. */
export const ChequeAmountSchema = DecimalStringSchema.refine(
  (value) => !value.startsWith("-"),
  { message: "a cheque amount cannot be negative" },
);

/** The three value shapes. `kind` is the discriminator; nothing else is accepted. */
export const MandateCodesValueSchema = z
  .object({
    kind: z.literal("codes"),
    values: z
      .array(z.string().min(1).max(64))
      .min(1)
      .max(MANDATE_CONSTRAINT_CODES_MAX),
  })
  .strict();
export const MandateAmountValueSchema = z
  .object({
    kind: z.literal("amount"),
    amount: ChequeAmountSchema,
    currency: CurrencyCodeSchema,
  })
  .strict();
export const MandateTextValueSchema = z
  .object({
    kind: z.literal("text"),
    text: z.string().trim().min(1).max(MANDATE_CUSTOM_TEXT_MAX_LENGTH),
  })
  .strict();
export const MandateConstraintValueSchema = z.discriminatedUnion("kind", [
  MandateCodesValueSchema,
  MandateAmountValueSchema,
  MandateTextValueSchema,
]);
export type MandateConstraintValue = z.infer<
  typeof MandateConstraintValueSchema
>;

/** importance = HARD_EXCLUSION ⇔ isHardExclusion. Contradictions fail validation. */
function hardExclusionCoherent(value: {
  importance: MandatePreferenceClass;
  isHardExclusion: boolean;
}): boolean {
  return (value.importance === "HARD_EXCLUSION") === value.isHardExclusion;
}

export const MandateConstraintInputSchema = z
  .object({
    dimension: MandateConstraintInputDimensionSchema,
    operator: MandateConstraintOperatorSchema,
    value: MandateConstraintValueSchema,
    importance: MandatePreferenceClassSchema,
    isHardExclusion: z.boolean(),
  })
  .strict()
  .refine(hardExclusionCoherent, {
    message: "importance HARD_EXCLUSION and isHardExclusion must agree",
    path: ["isHardExclusion"],
  });
export type MandateConstraintInput = z.infer<
  typeof MandateConstraintInputSchema
>;

const ConstraintListSchema = z
  .array(MandateConstraintInputSchema)
  .max(MANDATE_CONSTRAINTS_MAX);

/**
 * The cheque envelope on the wire. Persisted as min / max / currency on the
 * mandate; `typical` becomes a `cheque.typical` constraint. Exact strings
 * only. Ordering (min ≤ typical ≤ max) is checked with exact-decimal
 * comparison in the domain, never with floating point.
 */
export const MandateChequeRangeSchema = z
  .object({
    currency: CurrencyCodeSchema,
    min: ChequeAmountSchema.optional(),
    typical: ChequeAmountSchema.optional(),
    max: ChequeAmountSchema.optional(),
  })
  .strict();
export type MandateChequeRange = z.infer<typeof MandateChequeRangeSchema>;

const NameSchema = z.string().trim().min(1).max(MANDATE_NAME_MAX_LENGTH);
const RawTextSchema = z.string().trim().min(1).max(MANDATE_RAW_TEXT_MAX_LENGTH);

export const CreateInvestorMandateRequestSchema = z
  .object({
    name: NameSchema,
    discoveryMode: DiscoveryModeSchema.optional(),
    chequeRange: MandateChequeRangeSchema.optional(),
    minStageCode: StageCodeSchema.optional(),
    maxStageCode: StageCodeSchema.optional(),
    rawMandateText: RawTextSchema.optional(),
    constraints: ConstraintListSchema.optional(),
  })
  .strict();
export type CreateInvestorMandateRequest = z.infer<
  typeof CreateInvestorMandateRequestSchema
>;

export const INVESTOR_MANDATE_EDITABLE_FIELDS = [
  "name",
  "discoveryMode",
  "chequeRange",
  "minStageCode",
  "maxStageCode",
  "rawMandateText",
  "constraints",
] as const;
export type InvestorMandateEditableField =
  (typeof INVESTOR_MANDATE_EDITABLE_FIELDS)[number];

/**
 * A declared-policy snapshot update. `constraints`, when present, replaces
 * the whole client-editable constraint set atomically; `chequeRange`
 * replaces the whole cheque envelope including the typical cheque. `null`
 * clears an optional field. No status, effective dates, tenant, investor or
 * creator fields exist here.
 */
export const UpdateInvestorMandateRequestSchema = z
  .object({
    expectedVersion: ResourceVersionSchema,
    name: NameSchema.optional(),
    discoveryMode: DiscoveryModeSchema.nullable().optional(),
    chequeRange: MandateChequeRangeSchema.nullable().optional(),
    minStageCode: StageCodeSchema.nullable().optional(),
    maxStageCode: StageCodeSchema.nullable().optional(),
    rawMandateText: RawTextSchema.nullable().optional(),
    constraints: ConstraintListSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      INVESTOR_MANDATE_EDITABLE_FIELDS.some(
        (field) => value[field] !== undefined,
      ),
    { message: "expected at least one field to update" },
  );
export type UpdateInvestorMandateRequest = z.infer<
  typeof UpdateInvestorMandateRequestSchema
>;

/** Activation and closure carry the version the client read, when it has one. */
export const InvestorMandateTransitionRequestSchema = z
  .object({
    expectedVersion: ResourceVersionSchema.optional(),
  })
  .strict();
export type InvestorMandateTransitionRequest = z.infer<
  typeof InvestorMandateTransitionRequestSchema
>;

export const InvestorMandateConstraintDtoSchema = z.object({
  id: UuidSchema,
  dimension: MandateConstraintInputDimensionSchema,
  operator: MandateConstraintOperatorSchema,
  value: MandateConstraintValueSchema,
  importance: MandatePreferenceClassSchema,
  isHardExclusion: z.boolean(),
});
export type InvestorMandateConstraintDto = z.infer<
  typeof InvestorMandateConstraintDtoSchema
>;

/** Organisation-internal. Carries raw text and every declared constraint. */
export const InvestorMandateDtoSchema = z.object({
  id: UuidSchema,
  investorOrganisationId: UuidSchema,
  name: z.string(),
  status: InvestorMandateStatusSchema,
  effectiveFrom: UtcTimestampSchema.nullable(),
  effectiveTo: UtcTimestampSchema.nullable(),
  discoveryMode: DiscoveryModeSchema.nullable(),
  chequeRange: MandateChequeRangeSchema.nullable(),
  minStageCode: z.string().nullable(),
  maxStageCode: z.string().nullable(),
  rawMandateText: z.string().nullable(),
  constraints: z.array(InvestorMandateConstraintDtoSchema),
  version: ResourceVersionSchema,
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
});
export type InvestorMandateDto = z.infer<typeof InvestorMandateDtoSchema>;

export const InvestorMandateSummaryDtoSchema = z.object({
  id: UuidSchema,
  investorOrganisationId: UuidSchema,
  name: z.string(),
  status: InvestorMandateStatusSchema,
  discoveryMode: DiscoveryModeSchema.nullable(),
  effectiveFrom: UtcTimestampSchema.nullable(),
  effectiveTo: UtcTimestampSchema.nullable(),
  version: ResourceVersionSchema,
  createdAt: UtcTimestampSchema,
});
export type InvestorMandateSummaryDto = z.infer<
  typeof InvestorMandateSummaryDtoSchema
>;

export const ListInvestorMandatesResponseSchema = createCursorPageSchema(
  InvestorMandateSummaryDtoSchema,
);
export type ListInvestorMandatesResponse = z.infer<
  typeof ListInvestorMandatesResponseSchema
>;

/** Query-string form: values arrive as strings. Status is the only filter. */
export const ListInvestorMandatesQuerySchema = z
  .object({
    cursor: CursorSchema.optional(),
    limit: z.preprocess(
      (value) =>
        value === undefined || value === "" ? undefined : Number(value),
      PageSizeSchema.optional(),
    ),
    status: InvestorMandateStatusSchema.optional(),
  })
  .strict();
export type ListInvestorMandatesQuery = z.infer<
  typeof ListInvestorMandatesQuerySchema
>;

export const INVESTOR_MANDATES_SUFFIX = "/mandates" as const;
export const INVESTOR_MANDATE_ACTIVATE_SUFFIX = "/activate" as const;
export const INVESTOR_MANDATE_CLOSE_SUFFIX = "/close" as const;
