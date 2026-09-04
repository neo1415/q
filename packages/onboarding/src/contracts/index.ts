import { z } from "zod";

import {
  createUuidIdSchema,
  type OnboardingJourneyType,
  type OnboardingResponseType,
  type OnboardingResponseValue,
  type OnboardingSessionStatus,
  type OnboardingSourceModality,
  type OnboardingStepStateStatus,
  type OnboardingStepType,
  type OnboardingSubjectType,
  type OnboardingSuggestionStatus,
  type UtcTimestamp,
} from "@capital-q/contracts";
import type {
  ActorContext,
  OrganisationId,
  TenantId,
  UserId,
} from "@capital-q/security";

import type {
  BranchExpression,
  OnboardingDefinitionSchemaV1,
  OnboardingStepConfiguration,
  OnboardingWriteTarget,
} from "../definitions/schema.js";

/**
 * @capital-q/onboarding/contracts -- identifiers and entities of the
 * journey runtime. Journey state only: nothing here is a company, an
 * investor, a mandate or a capital objective.
 */

export const OnboardingDefinitionIdSchema = createUuidIdSchema(
  "OnboardingDefinitionId",
);
export type OnboardingDefinitionId = z.infer<
  typeof OnboardingDefinitionIdSchema
>;

export const OnboardingDefinitionVersionIdSchema = createUuidIdSchema(
  "OnboardingDefinitionVersionId",
);
export type OnboardingDefinitionVersionId = z.infer<
  typeof OnboardingDefinitionVersionIdSchema
>;

export const OnboardingStepIdSchema = createUuidIdSchema("OnboardingStepId");
export type OnboardingStepId = z.infer<typeof OnboardingStepIdSchema>;

export const OnboardingSessionIdSchema = createUuidIdSchema(
  "OnboardingSessionId",
);
export type OnboardingSessionId = z.infer<typeof OnboardingSessionIdSchema>;

export const OnboardingResponseIdSchema = createUuidIdSchema(
  "OnboardingResponseId",
);
export type OnboardingResponseId = z.infer<typeof OnboardingResponseIdSchema>;

export const OnboardingSuggestionIdSchema = createUuidIdSchema(
  "OnboardingSuggestionId",
);
export type OnboardingSuggestionId = z.infer<
  typeof OnboardingSuggestionIdSchema
>;

export const ONBOARDING_DEFINITION_STATUSES = ["ACTIVE", "RETIRED"] as const;
export const OnboardingDefinitionStatusSchema = z.enum(
  ONBOARDING_DEFINITION_STATUSES,
);
export type OnboardingDefinitionStatus = z.infer<
  typeof OnboardingDefinitionStatusSchema
>;

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export type OnboardingDefinition = {
  readonly id: OnboardingDefinitionId;
  readonly journeyType: OnboardingJourneyType;
  readonly name: string;
  readonly status: OnboardingDefinitionStatus;
  /** The published version new sessions receive; never alters existing sessions. */
  readonly currentVersion: number | null;
  readonly createdAt: UtcTimestamp;
};

export type OnboardingDefinitionVersion = {
  readonly id: OnboardingDefinitionVersionId;
  readonly definitionId: OnboardingDefinitionId;
  readonly journeyType: OnboardingJourneyType;
  readonly version: number;
  readonly schema: OnboardingDefinitionSchemaV1;
  /** SHA-256 of the canonical manifest; idempotent republish, conflict on change. */
  readonly manifestHash: string;
  readonly publishedAt: UtcTimestamp | null;
};

export type OnboardingStepDefinition = {
  readonly id: OnboardingStepId;
  readonly definitionVersionId: OnboardingDefinitionVersionId;
  readonly stepKey: string;
  readonly sequenceOrder: number;
  readonly stepType: OnboardingStepType;
  readonly required: boolean;
  readonly configuration: OnboardingStepConfiguration;
  readonly branching: BranchExpression | null;
  readonly writesTo: readonly OnboardingWriteTarget[];
};

/** A published version with its executable steps in sequence order. Immutable. */
export type PublishedOnboardingDefinition = {
  readonly version: OnboardingDefinitionVersion;
  readonly steps: readonly OnboardingStepDefinition[];
};

// ---------------------------------------------------------------------------
// Sessions and journey state
// ---------------------------------------------------------------------------

/**
 * The person driving a session. `context` is the resolved organisation
 * context when one exists; a brand-new user has none and may still start a
 * bootstrap session. Never constructed from client input.
 */
export type OnboardingActor = {
  readonly userId: UserId;
  readonly context: ActorContext | null;
};

export type OnboardingSubject = {
  readonly subjectType: OnboardingSubjectType;
  readonly subjectId: string;
};

export type OnboardingSession = {
  readonly id: OnboardingSessionId;
  /** Null until context is bound: a personal bootstrap session. */
  readonly tenantId: TenantId | null;
  readonly userId: UserId;
  readonly organisationId: OrganisationId | null;
  readonly journeyType: OnboardingJourneyType;
  readonly definitionVersionId: OnboardingDefinitionVersionId;
  readonly subject: OnboardingSubject | null;
  readonly status: OnboardingSessionStatus;
  /** Navigation state, never canonical progress. Null once completed. */
  readonly currentStepKey: string | null;
  readonly startedAt: UtcTimestamp;
  readonly lastActivityAt: UtcTimestamp;
  readonly completedAt: UtcTimestamp | null;
  /** Optimistic concurrency token; increments on every persisted mutation. */
  readonly version: number;
};

export type OnboardingStepState = {
  readonly sessionId: OnboardingSessionId;
  readonly stepKey: string;
  readonly status: OnboardingStepStateStatus;
  readonly enteredAt: UtcTimestamp;
  readonly completedAt: UtcTimestamp | null;
  readonly skippedAt: UtcTimestamp | null;
};

/** History-oriented: content never changes; replacement links forward. */
export type OnboardingResponse = {
  readonly id: OnboardingResponseId;
  readonly sessionId: OnboardingSessionId;
  readonly stepKey: string;
  readonly responseType: OnboardingResponseType;
  readonly value: OnboardingResponseValue;
  /** What the user actually typed or said, for text responses only. */
  readonly rawText: string | null;
  readonly sourceModality: OnboardingSourceModality;
  readonly createdAt: UtcTimestamp;
  readonly supersededByResponseId: OnboardingResponseId | null;
};

/** A validated, step-compatible response ready to persist. */
export type ValidatedOnboardingResponse = {
  readonly stepKey: string;
  readonly responseType: OnboardingResponseType;
  readonly value: OnboardingResponseValue;
  readonly rawText: string | null;
  readonly sourceModality: OnboardingSourceModality;
};

export const OnboardingSourceRefSchema = z
  .object({
    sourceType: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .max(64),
    sourceId: z.string().min(1).max(200),
  })
  .strict();
export type OnboardingSourceRef = z.infer<typeof OnboardingSourceRefSchema>;
export const OnboardingSourceRefsSchema = z
  .array(OnboardingSourceRefSchema)
  .max(20);

/** Exact decimal string in [0, 1]. Not a calibrated probability. */
export const OnboardingSuggestionConfidenceSchema = z
  .string()
  .regex(/^(?:0(?:\.\d{1,4})?|1(?:\.0{1,4})?)$/);

export type OnboardingSuggestion = {
  readonly id: OnboardingSuggestionId;
  readonly sessionId: OnboardingSessionId;
  readonly stepKey: string;
  readonly targetField: string;
  readonly suggestedValue: OnboardingResponseValue;
  readonly sourceRefs: readonly OnboardingSourceRef[];
  readonly confidence: string | null;
  readonly status: OnboardingSuggestionStatus;
  /** Future Q run reference; no FK until the Q runtime tables exist. */
  readonly modelRunId: string | null;
  readonly createdAt: UtcTimestamp;
  readonly resolvedAt: UtcTimestamp | null;
};
