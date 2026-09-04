import { z } from "zod";

import {
  DecimalStringSchema,
  OnboardingJourneyTypeSchema,
  OnboardingOptionKeySchema,
  OnboardingPhaseKeySchema,
  OnboardingResourceTypeSchema,
  OnboardingStepKeySchema,
  OnboardingSubjectTypeSchema,
  ONBOARDING_TEXT_MAX_LENGTH,
} from "@capital-q/contracts";

/**
 * Declarative onboarding definitions (CQ-ONB-001).
 *
 *   manifest (version-controlled) -> validated -> immutable published
 *   definition version + executable steps
 *
 * A definition describes interaction semantics only: prompts, option keys,
 * bounds, phases, branching over earlier answers and semantic write
 * targets. It never carries styling, code, SQL or table names. Founder and
 * Investor journeys are manifests published on this schema by later
 * packets; the runtime knows nothing about them.
 */

// ---------------------------------------------------------------------------
// Version-level schema (definition_versions.schema)
// ---------------------------------------------------------------------------

/** Format version of the manifest JSON. Separate from the journey definition version. */
export const ONBOARDING_DEFINITION_SCHEMA_VERSION = 1 as const;

export const OnboardingPhaseDefinitionSchema = z
  .object({
    phaseKey: OnboardingPhaseKeySchema,
    label: z.string().min(1).max(80),
  })
  .strict();

/**
 * Runtime settings the server decides for every session of this journey:
 * which canonical subject it binds to and whether it may begin before that
 * subject exists (bootstrap). Clients never choose these.
 */
export const OnboardingRuntimeSettingsSchema = z
  .object({
    subjectType: OnboardingSubjectTypeSchema,
    allowUnboundStart: z.boolean(),
  })
  .strict();

export const OnboardingDefinitionSchemaV1 = z
  .object({
    schemaVersion: z.literal(ONBOARDING_DEFINITION_SCHEMA_VERSION),
    phases: z
      .array(OnboardingPhaseDefinitionSchema)
      .max(20)
      .refine(
        (phases) =>
          new Set(phases.map((p) => p.phaseKey)).size === phases.length,
        { message: "phase keys must be unique" },
      ),
    runtime: OnboardingRuntimeSettingsSchema,
  })
  .strict();
export type OnboardingDefinitionSchemaV1 = z.infer<
  typeof OnboardingDefinitionSchemaV1
>;

// ---------------------------------------------------------------------------
// Step configuration (steps.configuration), discriminated by step type
// ---------------------------------------------------------------------------

const Copy = z.string().min(1).max(500);
const LongCopy = z.string().min(1).max(1000);

const common = {
  prompt: Copy,
  supportingText: LongCopy.optional(),
  whyQAsks: LongCopy.optional(),
  phaseKey: OnboardingPhaseKeySchema.optional(),
};

export const OnboardingOptionDefinitionSchema = z
  .object({
    optionKey: OnboardingOptionKeySchema,
    label: z.string().min(1).max(120),
    description: z.string().min(1).max(300).optional(),
  })
  .strict();

const OptionsSchema = z
  .array(OnboardingOptionDefinitionSchema)
  .min(2)
  .max(50)
  .refine(
    (options) =>
      new Set(options.map((o) => o.optionKey)).size === options.length,
    { message: "option keys must be unique" },
  );

export const OnboardingStepConfigurationSchema = z.discriminatedUnion(
  "stepType",
  [
    z
      .object({
        stepType: z.literal("single_select"),
        ...common,
        options: OptionsSchema,
      })
      .strict(),
    z
      .object({
        stepType: z.literal("multi_select"),
        ...common,
        options: OptionsSchema,
        minSelections: z.number().int().min(0).default(1),
        maxSelections: z.number().int().min(1).max(50),
        /** Selecting one of these excludes every other option (e.g. "none of these"). */
        exclusiveOptionKeys: z
          .array(OnboardingOptionKeySchema)
          .max(10)
          .default([]),
      })
      .strict(),
    z
      .object({
        stepType: z.literal("range"),
        ...common,
        min: DecimalStringSchema,
        max: DecimalStringSchema,
        step: DecimalStringSchema.optional(),
        unit: z.string().min(1).max(16).optional(),
      })
      .strict(),
    z
      .object({
        stepType: z.literal("short_text"),
        ...common,
        minLength: z.number().int().min(0).default(1),
        maxLength: z.number().int().min(1).max(500).default(200),
        placeholder: z.string().max(120).optional(),
      })
      .strict(),
    z
      .object({
        stepType: z.literal("long_text"),
        ...common,
        minLength: z.number().int().min(0).default(1),
        maxLength: z
          .number()
          .int()
          .min(1)
          .max(ONBOARDING_TEXT_MAX_LENGTH)
          .default(2000),
        placeholder: z.string().max(120).optional(),
      })
      .strict(),
    z
      .object({
        stepType: z.literal("voice_text"),
        ...common,
        maxLength: z
          .number()
          .int()
          .min(1)
          .max(ONBOARDING_TEXT_MAX_LENGTH)
          .default(ONBOARDING_TEXT_MAX_LENGTH),
        placeholder: z.string().max(120).optional(),
      })
      .strict(),
    z
      .object({
        stepType: z.literal("document_upload"),
        ...common,
        allowedResourceTypes: z
          .array(OnboardingResourceTypeSchema)
          .min(1)
          .max(4),
        minItems: z.number().int().min(0).default(0),
        maxItems: z.number().int().min(1).max(20).default(10),
      })
      .strict(),
    z
      .object({
        stepType: z.literal("confirmation"),
        ...common,
        confirmLabel: z.string().min(1).max(80),
        declineLabel: z.string().min(1).max(80).optional(),
        /** When true only `confirmed: true` completes the step. */
        requireAffirmative: z.boolean().default(true),
      })
      .strict(),
  ],
);
export type OnboardingStepConfiguration = z.infer<
  typeof OnboardingStepConfigurationSchema
>;

// ---------------------------------------------------------------------------
// Branching DSL (steps.branching_expression) -- data, never code
// ---------------------------------------------------------------------------

export const BRANCH_OPERATORS = [
  "EXISTS",
  "EQUALS",
  "IN",
  "CONTAINS",
  "ALL",
  "ANY",
  "NOT",
] as const;
export const BRANCH_MAX_DEPTH = 8;

const BranchScalarSchema = z.union([
  z.string().max(200),
  z.number().finite(),
  z.boolean(),
]);
export type BranchScalar = z.infer<typeof BranchScalarSchema>;

export type BranchExpression =
  | { readonly op: "EXISTS"; readonly stepKey: string }
  | {
      readonly op: "EQUALS";
      readonly stepKey: string;
      readonly value: BranchScalar;
    }
  | {
      readonly op: "IN";
      readonly stepKey: string;
      readonly values: readonly BranchScalar[];
    }
  | {
      readonly op: "CONTAINS";
      readonly stepKey: string;
      readonly value: BranchScalar;
    }
  | { readonly op: "ALL"; readonly expressions: readonly BranchExpression[] }
  | { readonly op: "ANY"; readonly expressions: readonly BranchExpression[] }
  | { readonly op: "NOT"; readonly expression: BranchExpression };

export const BranchExpressionSchema: z.ZodType<BranchExpression> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z
      .object({ op: z.literal("EXISTS"), stepKey: OnboardingStepKeySchema })
      .strict(),
    z
      .object({
        op: z.literal("EQUALS"),
        stepKey: OnboardingStepKeySchema,
        value: BranchScalarSchema,
      })
      .strict(),
    z
      .object({
        op: z.literal("IN"),
        stepKey: OnboardingStepKeySchema,
        values: z.array(BranchScalarSchema).min(1).max(50),
      })
      .strict(),
    z
      .object({
        op: z.literal("CONTAINS"),
        stepKey: OnboardingStepKeySchema,
        value: BranchScalarSchema,
      })
      .strict(),
    z
      .object({
        op: z.literal("ALL"),
        expressions: z.array(BranchExpressionSchema).min(1).max(20),
      })
      .strict(),
    z
      .object({
        op: z.literal("ANY"),
        expressions: z.array(BranchExpressionSchema).min(1).max(20),
      })
      .strict(),
    z
      .object({ op: z.literal("NOT"), expression: BranchExpressionSchema })
      .strict(),
  ]),
);

// ---------------------------------------------------------------------------
// Write targets (steps.writes_to) -- semantic keys, never SQL
// ---------------------------------------------------------------------------

/** `company.stage`, `capital.objective`, `taxonomy.company` ... registered by the owning domain. */
export const OnboardingWriteTargetKeySchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/,
    "expected a semantic write target key such as company.stage",
  )
  .max(80);
export type OnboardingWriteTargetKey = z.infer<
  typeof OnboardingWriteTargetKeySchema
>;

export const OnboardingWriteTargetSchema = z
  .object({ targetKey: OnboardingWriteTargetKeySchema })
  .strict();
export type OnboardingWriteTarget = z.infer<typeof OnboardingWriteTargetSchema>;

// ---------------------------------------------------------------------------
// The manifest a publisher submits
// ---------------------------------------------------------------------------

export const OnboardingStepManifestSchema = z
  .object({
    stepKey: OnboardingStepKeySchema,
    sequenceOrder: z.number().int().min(0),
    required: z.boolean(),
    configuration: OnboardingStepConfigurationSchema,
    branching: BranchExpressionSchema.nullable().default(null),
    writesTo: z
      .array(OnboardingWriteTargetSchema)
      .max(8)
      .default([])
      .refine(
        (targets) =>
          new Set(targets.map((t) => t.targetKey)).size === targets.length,
        { message: "write targets must be unique" },
      ),
  })
  .strict();
export type OnboardingStepManifest = z.infer<
  typeof OnboardingStepManifestSchema
>;

export const OnboardingDefinitionManifestSchema = z
  .object({
    journeyType: OnboardingJourneyTypeSchema,
    name: z.string().min(1).max(120),
    /** The journey definition version (integer >= 1), not the schema format version. */
    version: z.number().int().min(1),
    schema: OnboardingDefinitionSchemaV1,
    steps: z.array(OnboardingStepManifestSchema).min(1).max(200),
  })
  .strict();
export type OnboardingDefinitionManifest = z.infer<
  typeof OnboardingDefinitionManifestSchema
>;
