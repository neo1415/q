import { z } from "zod";

import { DecimalStringSchema } from "../common/decimal.js";
import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";

/**
 * `/v1/onboarding` -- the generic onboarding runtime (CQ-ONB-001).
 *
 * Onboarding owns journey state, never canonical truth. The wire contracts
 * here describe a session pinned to a published definition version, a safe
 * projection of its current step, validated historical responses,
 * non-authoritative suggestions and truthful progress. They carry no
 * server-only internals: no write targets, no branching expressions, no
 * handler keys. Founder and Investor journeys are definitions published on
 * top of this runtime in later packets; nothing here names their steps.
 */

export const ONBOARDING_PATH = "/v1/onboarding";
export const ONBOARDING_SESSIONS_SEGMENT = "/sessions";
export const ONBOARDING_RESPONSES_SEGMENT = "/responses";
export const ONBOARDING_STEPS_SEGMENT = "/steps";
export const ONBOARDING_SKIP_SEGMENT = "/skip";
export const ONBOARDING_BACK_SEGMENT = "/back";
export const ONBOARDING_COMPLETE_SEGMENT = "/complete";
export const ONBOARDING_SUGGESTIONS_SEGMENT = "/suggestions";
export const ONBOARDING_RESOLVE_SEGMENT = "/resolve";

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/** Journey type is onboarding context, never a user identity. */
export const ONBOARDING_JOURNEY_TYPES = [
  "founder",
  "investor",
  "external_investor_conversion",
] as const;
export const OnboardingJourneyTypeSchema = z.enum(ONBOARDING_JOURNEY_TYPES);
export type OnboardingJourneyType = z.infer<typeof OnboardingJourneyTypeSchema>;

/** Canonical subjects a session may bind to. Resolved server-side, never trusted from a client. */
export const ONBOARDING_SUBJECT_TYPES = [
  "COMPANY",
  "INVESTOR_ORGANISATION",
] as const;
export const OnboardingSubjectTypeSchema = z.enum(ONBOARDING_SUBJECT_TYPES);
export type OnboardingSubjectType = z.infer<typeof OnboardingSubjectTypeSchema>;

export const ONBOARDING_SESSION_STATUSES = [
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
] as const;
export const OnboardingSessionStatusSchema = z.enum(
  ONBOARDING_SESSION_STATUSES,
);
export type OnboardingSessionStatus = z.infer<
  typeof OnboardingSessionStatusSchema
>;

/** Interaction semantics only. Never a business concept such as "stage step". */
export const ONBOARDING_STEP_TYPES = [
  "single_select",
  "multi_select",
  "range",
  "short_text",
  "long_text",
  "voice_text",
  "document_upload",
  "confirmation",
] as const;
export const OnboardingStepTypeSchema = z.enum(ONBOARDING_STEP_TYPES);
export type OnboardingStepType = z.infer<typeof OnboardingStepTypeSchema>;

/** Persisted step state. No row = not yet entered. */
export const ONBOARDING_STEP_STATE_STATUSES = [
  "IN_PROGRESS",
  "COMPLETED",
  "SKIPPED",
] as const;
export const OnboardingStepStateStatusSchema = z.enum(
  ONBOARDING_STEP_STATE_STATUSES,
);
export type OnboardingStepStateStatus = z.infer<
  typeof OnboardingStepStateStatusSchema
>;

/** Progress projection of one eligible step for the client. */
export const ONBOARDING_STEP_PROGRESS_STATUSES = [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "SKIPPED",
] as const;
export const OnboardingStepProgressStatusSchema = z.enum(
  ONBOARDING_STEP_PROGRESS_STATUSES,
);

export const ONBOARDING_RESPONSE_TYPES = [
  "SINGLE_SELECT",
  "MULTI_SELECT",
  "RANGE",
  "TEXT",
  "RESOURCE_REFERENCE",
  "CONFIRMATION",
] as const;
export const OnboardingResponseTypeSchema = z.enum(ONBOARDING_RESPONSE_TYPES);
export type OnboardingResponseType = z.infer<
  typeof OnboardingResponseTypeSchema
>;

/** Provenance of a response. Never authority. */
export const ONBOARDING_SOURCE_MODALITIES = [
  "SELECTION",
  "TYPED_TEXT",
  "VOICE_TRANSCRIPT",
  "DOCUMENT_REFERENCE",
  "SUGGESTION_ACCEPT",
  "SUGGESTION_EDIT",
] as const;
export const OnboardingSourceModalitySchema = z.enum(
  ONBOARDING_SOURCE_MODALITIES,
);
export type OnboardingSourceModality = z.infer<
  typeof OnboardingSourceModalitySchema
>;

/** The modalities a client may declare. SUGGESTION_* are set by the runtime only. */
export const ONBOARDING_CLIENT_SOURCE_MODALITIES = [
  "SELECTION",
  "TYPED_TEXT",
  "VOICE_TRANSCRIPT",
  "DOCUMENT_REFERENCE",
] as const;
export const OnboardingClientSourceModalitySchema = z.enum(
  ONBOARDING_CLIENT_SOURCE_MODALITIES,
);

export const ONBOARDING_SUGGESTION_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "EDITED",
  "REJECTED",
  "EXPIRED",
] as const;
export const OnboardingSuggestionStatusSchema = z.enum(
  ONBOARDING_SUGGESTION_STATUSES,
);
export type OnboardingSuggestionStatus = z.infer<
  typeof OnboardingSuggestionStatusSchema
>;

/** Resource kinds a RESOURCE_REFERENCE response may name. Ids only; never files or paths. */
export const ONBOARDING_RESOURCE_TYPES = [
  "EVIDENCE_DOCUMENT",
  "TAXONOMY_NODE",
] as const;
export const OnboardingResourceTypeSchema = z.enum(ONBOARDING_RESOURCE_TYPES);
export type OnboardingResourceType = z.infer<
  typeof OnboardingResourceTypeSchema
>;

/** Stable semantic step key. Never a database id, never display copy. */
export const OnboardingStepKeySchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/, "expected a stable step key");
export type OnboardingStepKey = z.infer<typeof OnboardingStepKeySchema>;

/** Stable option identity, separate from its label. */
export const OnboardingOptionKeySchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/, "expected a stable option key");

export const OnboardingPhaseKeySchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, "expected a phase key");

export const ONBOARDING_TEXT_MAX_LENGTH = 4000;
export const ONBOARDING_MULTI_SELECT_MAX = 50;
export const ONBOARDING_RESOURCE_REFERENCE_MAX = 20;

// ---------------------------------------------------------------------------
// Response values (client input and stored shape)
// ---------------------------------------------------------------------------

export const OnboardingResponseValueSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("SINGLE_SELECT"),
      optionKey: OnboardingOptionKeySchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("MULTI_SELECT"),
      optionKeys: z
        .array(OnboardingOptionKeySchema)
        .max(ONBOARDING_MULTI_SELECT_MAX)
        .refine((keys) => new Set(keys).size === keys.length, {
          message: "optionKeys must be unique",
        }),
    })
    .strict(),
  z.object({ type: z.literal("RANGE"), value: DecimalStringSchema }).strict(),
  z
    .object({
      type: z.literal("TEXT"),
      text: z
        .string()
        .max(ONBOARDING_TEXT_MAX_LENGTH)
        .refine((value) => value.trim().length > 0, {
          message: "text must not be empty",
        }),
    })
    .strict(),
  z
    .object({
      type: z.literal("RESOURCE_REFERENCE"),
      resourceType: OnboardingResourceTypeSchema,
      resourceIds: z
        .array(UuidSchema)
        .min(1)
        .max(ONBOARDING_RESOURCE_REFERENCE_MAX)
        .refine((ids) => new Set(ids).size === ids.length, {
          message: "resourceIds must be unique",
        }),
    })
    .strict(),
  z
    .object({ type: z.literal("CONFIRMATION"), confirmed: z.boolean() })
    .strict(),
]);
export type OnboardingResponseValue = z.infer<
  typeof OnboardingResponseValueSchema
>;

/** What a client submits for a step. Modality is a declaration, not authority. */
export const OnboardingResponseInputSchema = z
  .object({
    value: OnboardingResponseValueSchema,
    sourceModality: OnboardingClientSourceModalitySchema.optional(),
  })
  .strict();
export type OnboardingResponseInput = z.infer<
  typeof OnboardingResponseInputSchema
>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const StartOnboardingSessionRequestSchema = z
  .object({
    journeyType: OnboardingJourneyTypeSchema,
    /** A canonical subject already owned by the caller's active organisation. */
    subject: z
      .object({ type: OnboardingSubjectTypeSchema, id: UuidSchema })
      .strict()
      .optional(),
  })
  .strict();
export type StartOnboardingSessionRequest = z.infer<
  typeof StartOnboardingSessionRequestSchema
>;

const SessionVersionSchema = z.number().int().min(1);

export const SubmitOnboardingResponseRequestSchema = z
  .object({
    stepKey: OnboardingStepKeySchema,
    response: OnboardingResponseInputSchema,
    expectedSessionVersion: SessionVersionSchema,
  })
  .strict();
export type SubmitOnboardingResponseRequest = z.infer<
  typeof SubmitOnboardingResponseRequestSchema
>;

export const SkipOnboardingStepRequestSchema = z
  .object({ expectedSessionVersion: SessionVersionSchema })
  .strict();
export type SkipOnboardingStepRequest = z.infer<
  typeof SkipOnboardingStepRequestSchema
>;

/** Back to the previous visited eligible step, or to a named visited earlier step. */
export const OnboardingBackRequestSchema = z
  .object({
    expectedSessionVersion: SessionVersionSchema,
    targetStepKey: OnboardingStepKeySchema.optional(),
  })
  .strict();
export type OnboardingBackRequest = z.infer<typeof OnboardingBackRequestSchema>;

export const CompleteOnboardingSessionRequestSchema = z
  .object({ expectedSessionVersion: SessionVersionSchema })
  .strict();
export type CompleteOnboardingSessionRequest = z.infer<
  typeof CompleteOnboardingSessionRequestSchema
>;

export const ONBOARDING_SUGGESTION_RESOLUTIONS = [
  "ACCEPT",
  "EDIT",
  "REJECT",
] as const;
export const OnboardingSuggestionResolutionSchema = z.enum(
  ONBOARDING_SUGGESTION_RESOLUTIONS,
);
export type OnboardingSuggestionResolution = z.infer<
  typeof OnboardingSuggestionResolutionSchema
>;

export const ResolveOnboardingSuggestionRequestSchema = z
  .object({
    resolution: OnboardingSuggestionResolutionSchema,
    /** Required for EDIT: the user's own value, validated like any response. */
    response: OnboardingResponseInputSchema.optional(),
    expectedSessionVersion: SessionVersionSchema,
  })
  .strict()
  .refine(
    (value) => (value.resolution === "EDIT") === (value.response !== undefined),
    {
      message: "EDIT requires a response; ACCEPT and REJECT must not carry one",
    },
  );
export type ResolveOnboardingSuggestionRequest = z.infer<
  typeof ResolveOnboardingSuggestionRequestSchema
>;

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export const OnboardingOptionViewSchema = z.object({
  optionKey: OnboardingOptionKeySchema,
  label: z.string(),
  description: z.string().optional(),
});
export type OnboardingOptionView = z.infer<typeof OnboardingOptionViewSchema>;

/** Safe presentation configuration per step type. Interaction semantics only. */
export const OnboardingStepPresentationSchema = z.discriminatedUnion(
  "stepType",
  [
    z.object({
      stepType: z.literal("single_select"),
      options: z.array(OnboardingOptionViewSchema),
    }),
    z.object({
      stepType: z.literal("multi_select"),
      options: z.array(OnboardingOptionViewSchema),
      minSelections: z.number().int().min(0),
      maxSelections: z.number().int().min(1),
      exclusiveOptionKeys: z.array(OnboardingOptionKeySchema),
    }),
    z.object({
      stepType: z.literal("range"),
      min: DecimalStringSchema,
      max: DecimalStringSchema,
      step: DecimalStringSchema.optional(),
      unit: z.string().optional(),
    }),
    z.object({
      stepType: z.literal("short_text"),
      minLength: z.number().int().min(0),
      maxLength: z.number().int().min(1),
      placeholder: z.string().optional(),
    }),
    z.object({
      stepType: z.literal("long_text"),
      minLength: z.number().int().min(0),
      maxLength: z.number().int().min(1),
      placeholder: z.string().optional(),
    }),
    z.object({
      stepType: z.literal("voice_text"),
      maxLength: z.number().int().min(1),
      placeholder: z.string().optional(),
    }),
    z.object({
      stepType: z.literal("document_upload"),
      allowedResourceTypes: z.array(OnboardingResourceTypeSchema),
      minItems: z.number().int().min(0),
      maxItems: z.number().int().min(1),
    }),
    z.object({
      stepType: z.literal("confirmation"),
      confirmLabel: z.string(),
      declineLabel: z.string().optional(),
      requireAffirmative: z.boolean(),
    }),
  ],
);
export type OnboardingStepPresentation = z.infer<
  typeof OnboardingStepPresentationSchema
>;

export const OnboardingResponseViewSchema = z.object({
  id: UuidSchema,
  stepKey: OnboardingStepKeySchema,
  responseType: OnboardingResponseTypeSchema,
  value: OnboardingResponseValueSchema,
  sourceModality: OnboardingSourceModalitySchema,
  createdAt: UtcTimestampSchema,
});
export type OnboardingResponseView = z.infer<
  typeof OnboardingResponseViewSchema
>;

export const OnboardingStepViewSchema = z.object({
  stepKey: OnboardingStepKeySchema,
  stepType: OnboardingStepTypeSchema,
  required: z.boolean(),
  prompt: z.string(),
  supportingText: z.string().optional(),
  whyQAsks: z.string().optional(),
  phaseKey: OnboardingPhaseKeySchema.optional(),
  presentation: OnboardingStepPresentationSchema,
  currentResponse: OnboardingResponseViewSchema.optional(),
});
export type OnboardingStepView = z.infer<typeof OnboardingStepViewSchema>;

/** A pending proposal for the session owner to accept, edit or reject. Never truth. */
export const OnboardingSuggestionViewSchema = z.object({
  id: UuidSchema,
  stepKey: OnboardingStepKeySchema,
  targetField: z.string(),
  suggestedValue: OnboardingResponseValueSchema,
  /** Exact decimal in [0, 1] where supplied; not a calibrated probability. */
  confidence: z.string().nullable(),
  status: OnboardingSuggestionStatusSchema,
  createdAt: UtcTimestampSchema,
});
export type OnboardingSuggestionView = z.infer<
  typeof OnboardingSuggestionViewSchema
>;

export const OnboardingPhaseViewSchema = z.object({
  phaseKey: OnboardingPhaseKeySchema,
  label: z.string(),
});

export const OnboardingStepProgressSchema = z.object({
  stepKey: OnboardingStepKeySchema,
  phaseKey: OnboardingPhaseKeySchema.optional(),
  required: z.boolean(),
  status: OnboardingStepProgressStatusSchema,
});

/** Truthful progress over the currently eligible path only. */
export const OnboardingProgressSchema = z.object({
  currentStepKey: OnboardingStepKeySchema.nullable(),
  currentPhaseKey: OnboardingPhaseKeySchema.nullable(),
  eligibleSteps: z.array(OnboardingStepProgressSchema),
  eligibleStepCount: z.number().int().min(0),
  completedEligibleStepCount: z.number().int().min(0),
  canGoBack: z.boolean(),
  canSkipCurrentStep: z.boolean(),
  canComplete: z.boolean(),
});
export type OnboardingProgress = z.infer<typeof OnboardingProgressSchema>;

export const OnboardingPathChangesSchema = z.object({
  becameEligibleStepKeys: z.array(OnboardingStepKeySchema),
  becameIneligibleStepKeys: z.array(OnboardingStepKeySchema),
});
export type OnboardingPathChanges = z.infer<typeof OnboardingPathChangesSchema>;

export const OnboardingSessionSummarySchema = z.object({
  id: UuidSchema,
  journeyType: OnboardingJourneyTypeSchema,
  definitionVersionId: UuidSchema,
  definitionVersion: z.number().int().min(1),
  status: OnboardingSessionStatusSchema,
  subject: z
    .object({ type: OnboardingSubjectTypeSchema, id: UuidSchema })
    .nullable(),
  currentStepKey: OnboardingStepKeySchema.nullable(),
  version: z.number().int().min(1),
  startedAt: UtcTimestampSchema,
  lastActivityAt: UtcTimestampSchema,
  completedAt: UtcTimestampSchema.nullable(),
});
export type OnboardingSessionSummary = z.infer<
  typeof OnboardingSessionSummarySchema
>;

export const OnboardingSessionViewSchema = z.object({
  session: OnboardingSessionSummarySchema,
  phases: z.array(OnboardingPhaseViewSchema),
  currentStep: OnboardingStepViewSchema.nullable(),
  progress: OnboardingProgressSchema,
  pendingSuggestions: z.array(OnboardingSuggestionViewSchema),
  /** Present after a mutation that changed the eligible path. */
  pathChanges: OnboardingPathChangesSchema.optional(),
});
export type OnboardingSessionView = z.infer<typeof OnboardingSessionViewSchema>;
