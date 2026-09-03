import { z, type ZodType } from "zod";

import {
  ContractValidationError,
  CountryCodeSchema,
  DeclaredCodeSchema,
  MandateAmountValueSchema,
  MandateCodesValueSchema,
  MandateTextValueSchema,
  StageCodeSchema,
  type MandateChequeRange,
  type MandateConstraintDimension,
  type MandateConstraintInput,
  type MandateConstraintOperator,
  type MandateConstraintValue,
  type MandatePreferenceClass,
} from "@capital-q/contracts";

import type { MandateAutomatedUse } from "../contracts/mandate.js";
import { compareDecimalStrings } from "./decimal.js";

/**
 * The Investor-owned constraint registry: for each allowlisted dimension,
 * which operators, which value shape, which importance classes, and whether
 * automated discovery may use it. The registry is data about data -- it
 * never compiles to SQL, never evaluates anything, and there is no
 * expression language anywhere near it.
 *
 * Allowlist, not denylist: a dimension that is not here cannot be
 * expressed. That is how protected or sensitive personal characteristics
 * stay out of automated screening by construction.
 *
 * Preference classes (ranking effects are the Recommendation domain's):
 *   MUST            strong positive requirement/preference
 *   STRONG          substantial positive influence
 *   NICE            moderate positive preference
 *   NEUTRAL         stored explicit indifference
 *   AVOID           negative preference; the candidate may still appear
 *   HARD_EXCLUSION  ineligible under this mandate in standard discovery
 *
 * `MUST` is not `HARD_EXCLUSION`, and no discovery mode softens a hard
 * exclusion.
 */

const POSITIVE: readonly MandatePreferenceClass[] = ["MUST", "STRONG", "NICE"];
const NEGATIVE: readonly MandatePreferenceClass[] = ["AVOID", "HARD_EXCLUSION"];
const ANY: readonly MandatePreferenceClass[] = [
  "MUST",
  "STRONG",
  "NICE",
  "NEUTRAL",
  "AVOID",
  "HARD_EXCLUSION",
];

/** Set operators over a code list; single-valued operators require exactly one code. */
const CODE_SET_OPERATORS: readonly MandateConstraintOperator[] = [
  "EQ",
  "NEQ",
  "IN",
  "NOT_IN",
];

function codes(item: ZodType<string>) {
  return MandateCodesValueSchema.extend({
    values: z.array(item).min(1).max(50),
  });
}

/** Approved V1 business-attribute codes. Extended by product decision, not by clients. */
export const BUSINESS_ATTRIBUTE_CODES = [
  "b2b",
  "b2c",
  "marketplace",
  "infrastructure",
  "saas",
  "api",
  "hardware",
  "capital_light",
  "regulated",
] as const;

/** Investment-relevant founder/business capabilities only. */
export const FOUNDER_BUSINESS_ATTRIBUTE_CODES = [
  "technical_founding_capability",
  "repeat_founder_experience",
  "deep_domain_expertise",
  "enterprise_sales_experience",
] as const;

export const GREEN_FLAG_CODES = [
  "strong_revenue_growth",
  "capital_efficiency",
  "enterprise_customers",
  "regulatory_moat",
  "repeat_founder",
  "deep_domain_expertise",
  "high_retention",
  "distribution_advantage",
] as const;

export const INVESTMENT_ROLE_CODES = ["lead", "co_invest", "follow"] as const;

export type MandateConstraintDefinition = {
  readonly dimension: MandateConstraintDimension;
  readonly allowedOperators: readonly MandateConstraintOperator[];
  readonly valueSchema: ZodType<MandateConstraintValue>;
  readonly allowedImportance: readonly MandatePreferenceClass[];
  readonly automatedUse: MandateAutomatedUse;
  /** False for dimensions the domain derives itself (never accepted from a client). */
  readonly clientSupplied: boolean;
  readonly note: string;
};

export const MANDATE_CONSTRAINT_REGISTRY: Readonly<
  Record<MandateConstraintDimension, MandateConstraintDefinition>
> = {
  stage: {
    dimension: "stage",
    allowedOperators: CODE_SET_OPERATORS,
    valueSchema: codes(StageCodeSchema),
    allowedImportance: ANY,
    automatedUse: "ELIGIBLE",
    clientSupplied: true,
    note: "Bounded stage codes; CQ-TAX-001 supplies the canonical vocabulary.",
  },
  "geography.country": {
    dimension: "geography.country",
    allowedOperators: CODE_SET_OPERATORS,
    valueSchema: codes(CountryCodeSchema),
    allowedImportance: ANY,
    automatedUse: "ELIGIBLE",
    clientSupplied: true,
    note: "ISO 3166-1 alpha-2 only. Regions arrive with taxonomy/region mapping.",
  },
  sector: {
    dimension: "sector",
    allowedOperators: CODE_SET_OPERATORS,
    valueSchema: codes(DeclaredCodeSchema),
    allowedImportance: ANY,
    automatedUse: "ELIGIBLE",
    clientSupplied: true,
    note: "Declared sector codes, not yet canonical taxonomy; CQ-TAX-002 promotes them to TaxonomyNodeIds.",
  },
  "business.attribute": {
    dimension: "business.attribute",
    allowedOperators: CODE_SET_OPERATORS,
    valueSchema: codes(z.enum(BUSINESS_ATTRIBUTE_CODES)),
    allowedImportance: ANY,
    automatedUse: "ELIGIBLE",
    clientSupplied: true,
    note: "Approved V1 business attributes, one dimension each.",
  },
  "founder.business_attribute": {
    dimension: "founder.business_attribute",
    allowedOperators: CODE_SET_OPERATORS,
    valueSchema: codes(z.enum(FOUNDER_BUSINESS_ATTRIBUTE_CODES)),
    allowedImportance: ANY,
    automatedUse: "ELIGIBLE",
    clientSupplied: true,
    note: "Investment-relevant founder capabilities only.",
  },
  green_flag: {
    dimension: "green_flag",
    allowedOperators: ["EQ", "IN"],
    valueSchema: codes(z.enum(GREEN_FLAG_CODES)),
    allowedImportance: POSITIVE,
    automatedUse: "ELIGIBLE",
    clientSupplied: true,
    note: "Declared positive factors; investor preferences, not verified company facts.",
  },
  red_flag: {
    dimension: "red_flag",
    allowedOperators: ["EQ", "IN"],
    valueSchema: codes(DeclaredCodeSchema),
    allowedImportance: NEGATIVE,
    automatedUse: "ELIGIBLE",
    clientSupplied: true,
    note: "Declared negative factors. AVOID is soft; only HARD_EXCLUSION excludes.",
  },
  investment_role: {
    dimension: "investment_role",
    allowedOperators: ["EQ", "IN"],
    valueSchema: codes(z.enum(INVESTMENT_ROLE_CODES)),
    allowedImportance: ANY,
    automatedUse: "ELIGIBLE",
    clientSupplied: true,
    note: "Lead / co-invest / follow preference.",
  },
  "cheque.typical": {
    dimension: "cheque.typical",
    allowedOperators: ["EQ"],
    valueSchema: MandateAmountValueSchema,
    allowedImportance: ["NEUTRAL"],
    automatedUse: "ELIGIBLE",
    clientSupplied: false,
    note: "Derived from chequeRange.typical; doc 13 defines no typical column.",
  },
  "custom.text": {
    dimension: "custom.text",
    allowedOperators: ["EQ"],
    valueSchema: MandateTextValueSchema,
    allowedImportance: ANY,
    automatedUse: "MANUAL_ONLY",
    clientSupplied: true,
    note: "Bounded investor prose. Stored for humans; never an automated rule until classified and confirmed.",
  },
};

export function automatedUseOf(
  dimension: MandateConstraintDimension,
): MandateAutomatedUse {
  return MANDATE_CONSTRAINT_REGISTRY[dimension].automatedUse;
}

type Issue = { path: string; code: string; message: string };

/**
 * Validate a client-supplied constraint set against the registry. Throws
 * ContractValidationError (VALIDATION_FAILED) with every issue found; on
 * success returns the inputs unchanged -- validation never rewrites policy.
 */
export function validateMandateConstraints(
  inputs: readonly MandateConstraintInput[],
): readonly MandateConstraintInput[] {
  const issues: Issue[] = [];
  inputs.forEach((input, index) => {
    const path = `constraints.${String(index)}`;
    const definition = MANDATE_CONSTRAINT_REGISTRY[input.dimension];
    if (!definition.clientSupplied) {
      issues.push({
        path: `${path}.dimension`,
        code: "custom",
        message: `${input.dimension} is derived by the server and cannot be supplied`,
      });
      return;
    }
    if (!definition.allowedOperators.includes(input.operator)) {
      issues.push({
        path: `${path}.operator`,
        code: "custom",
        message: `${input.operator} is not allowed for ${input.dimension}`,
      });
    }
    const value = definition.valueSchema.safeParse(input.value);
    if (!value.success) {
      issues.push({
        path: `${path}.value`,
        code: "custom",
        message: `value is not valid for ${input.dimension}`,
      });
    } else if (
      (input.operator === "EQ" || input.operator === "NEQ") &&
      value.data.kind === "codes" &&
      value.data.values.length !== 1
    ) {
      issues.push({
        path: `${path}.value`,
        code: "custom",
        message: `${input.operator} takes exactly one value`,
      });
    }
    if (!definition.allowedImportance.includes(input.importance)) {
      issues.push({
        path: `${path}.importance`,
        code: "custom",
        message: `${input.importance} is not a valid importance for ${input.dimension}`,
      });
    }
    if ((input.importance === "HARD_EXCLUSION") !== input.isHardExclusion) {
      issues.push({
        path: `${path}.isHardExclusion`,
        code: "custom",
        message: "importance HARD_EXCLUSION and isHardExclusion must agree",
      });
    }
  });
  if (issues.length > 0) {
    throw new ContractValidationError(
      "The mandate constraints are not valid.",
      issues,
    );
  }
  return inputs;
}

/** min ≤ typical ≤ max, compared exactly. Unknown parts impose nothing. */
export function validateChequeRange(range: MandateChequeRange): void {
  const issues: Issue[] = [];
  if (
    range.min !== undefined &&
    range.max !== undefined &&
    compareDecimalStrings(range.min, range.max) > 0
  ) {
    issues.push({
      path: "chequeRange.max",
      code: "custom",
      message: "the maximum cheque cannot be below the minimum",
    });
  }
  if (range.typical !== undefined) {
    if (
      range.min !== undefined &&
      compareDecimalStrings(range.typical, range.min) < 0
    ) {
      issues.push({
        path: "chequeRange.typical",
        code: "custom",
        message: "the typical cheque cannot be below the minimum",
      });
    }
    if (
      range.max !== undefined &&
      compareDecimalStrings(range.typical, range.max) > 0
    ) {
      issues.push({
        path: "chequeRange.typical",
        code: "custom",
        message: "the typical cheque cannot exceed the maximum",
      });
    }
  }
  if (issues.length > 0) {
    throw new ContractValidationError("The cheque range is not valid.", issues);
  }
}
