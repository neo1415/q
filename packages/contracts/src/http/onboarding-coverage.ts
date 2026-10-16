import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import {
  OnboardingJourneyTypeSchema,
  OnboardingPhaseKeySchema,
  OnboardingStepKeySchema,
} from "./onboarding.js";

/**
 * Onboarding coverage (lane ob1, directive 2026-10-16 "Intelligent
 * onboarding").
 *
 * One canonical picture of what a journey knows, per field, for both the
 * conversation (Q) and the form. It is a deterministic PROJECTION over the
 * published definition (its steps and branching), the session's own
 * responses, pending suggestions and questions, registration facts and the
 * canonical records the person already has. It is never stored as truth and
 * never a second questionnaire: the field list is the definition's step
 * list, and the extra metadata (priority, deferrable, evidence wanted) is a
 * journey-owned annex keyed by step key.
 *
 * Field states are distinct on purpose and must not be collapsed:
 *
 *   KNOWN                 held already (registration, the journey the person
 *                         chose, a canonical record); never asked again
 *   SUPPLIED_UNCONFIRMED  a value is on offer (a document, public research,
 *                         Q's reading of a long answer) and waits for the
 *                         person's confirmation; never presented as saved
 *   CONFIRMED_SAVED       the person's answer is on the record, written
 *                         through the owning canonical service
 *   MISSING               applicable, nothing held, needed
 *   CONTRADICTORY         two readings disagree, or a record looks outdated;
 *                         the person, never Q, decides
 *   INAPPLICABLE          the definition's branching excludes it on this path
 *   EVIDENCE_NEEDED       answered, but the claim wants a supporting document
 *                         the session does not yet have
 *   DEFERRABLE            optional and open, or set aside by the person: may
 *                         wait; never blocks completion; a set-aside field
 *                         is never asked again
 *
 * Unknown stays unknown: MISSING and DEFERRABLE are never zero or negative
 * evidence.
 */

export const ONBOARDING_COVERAGE_SEGMENT = "/coverage";

export const ONBOARDING_COVERAGE_STATES = [
  "KNOWN",
  "SUPPLIED_UNCONFIRMED",
  "CONFIRMED_SAVED",
  "MISSING",
  "CONTRADICTORY",
  "INAPPLICABLE",
  "EVIDENCE_NEEDED",
  "DEFERRABLE",
] as const;
export const OnboardingCoverageStateSchema = z.enum(ONBOARDING_COVERAGE_STATES);
export type OnboardingCoverageState = z.infer<
  typeof OnboardingCoverageStateSchema
>;

/** How much a field matters to a useful first profile. Reference data, not an enum in the DB. */
export const ONBOARDING_COVERAGE_PRIORITIES = [
  /** Needed before the journey is useful at all; asked first. */
  "ESSENTIAL",
  /** Materially improves matching or the profile; asked after essentials. */
  "IMPORTANT",
  /** Nice to have; offered, never pressed; deferrable. */
  "OPTIONAL",
] as const;
export const OnboardingCoveragePrioritySchema = z.enum(
  ONBOARDING_COVERAGE_PRIORITIES,
);
export type OnboardingCoveragePriority = z.infer<
  typeof OnboardingCoveragePrioritySchema
>;

/** Where a field's value (held or offered) came from. Provenance, never authority. */
export const ONBOARDING_COVERAGE_SOURCES = [
  "REGISTRATION",
  "JOURNEY_CHOICE",
  "CANONICAL_RECORD",
  "FORM",
  "CONVERSATION",
  "DOCUMENT",
  "PUBLIC_RESEARCH",
  "Q_RECOMMENDATION",
] as const;
export const OnboardingCoverageSourceSchema = z.enum(
  ONBOARDING_COVERAGE_SOURCES,
);
export type OnboardingCoverageSource = z.infer<
  typeof OnboardingCoverageSourceSchema
>;

const SourceRefSchema = z
  .object({
    sourceType: z.string().min(1).max(64),
    sourceId: z.string().min(1).max(200),
  })
  .strict();

/** A value offered for confirmation. Inert until the person accepts it. */
export const OnboardingCoverageProposalSchema = z
  .object({
    suggestionId: UuidSchema,
    display: z.string().max(600),
    source: OnboardingCoverageSourceSchema,
    sourceRefs: z.array(SourceRefSchema).max(20),
    /** The proposal's rationale, e.g. names not matched (ob2). */
    note: z.string().max(300).nullable().default(null),
  })
  .strict();
export type OnboardingCoverageProposal = z.infer<
  typeof OnboardingCoverageProposalSchema
>;

export const OnboardingCoverageFieldSchema = z
  .object({
    /** The definition's step key: the one field identity, shared by form and Q. */
    fieldKey: OnboardingStepKeySchema,
    /** A stable concept name ("company.name"), for joining across journeys. */
    concept: z.string().min(1).max(80),
    label: z.string().min(1).max(160),
    phaseKey: OnboardingPhaseKeySchema.nullable(),
    state: OnboardingCoverageStateSchema,
    priority: OnboardingCoveragePrioritySchema,
    /** The definition marks the step required. */
    required: z.boolean(),
    /** The definition's branching includes it on the current path. */
    applicable: z.boolean(),
    /** It may wait without blocking completion. */
    deferrable: z.boolean(),
    /** The person set it aside: never asked again unless they reopen it. */
    declined: z.boolean(),
    /** What is held or on the record, as a person would read it. */
    display: z.string().max(600).nullable(),
    source: OnboardingCoverageSourceSchema.nullable(),
    proposals: z.array(OnboardingCoverageProposalSchema).max(8),
    /** CONTRADICTORY: the competing readings, for the person to choose between. */
    readings: z.array(z.string().max(400)).max(6),
    /** EVIDENCE_NEEDED: the kinds of document that would support it. */
    evidenceWanted: z.array(z.string().min(1).max(64)).max(8),
    /** A confirmed change is held for retry and is NOT yet saved. */
    savePending: z.boolean(),
    /**
     * The journey's own sense of what is most valuable to ask first within
     * a priority (lower first); absent: the definition's order.
     */
    rank: z.number().int().min(0).max(999).optional(),
    /** False: filled from documents or the pitch only, never asked as a gap. */
    askable: z.boolean().optional(),
    /** Steps whose answers decide whether this one applies. */
    dependsOn: z.array(OnboardingStepKeySchema).max(8),
  })
  .strict();
export type OnboardingCoverageField = z.infer<
  typeof OnboardingCoverageFieldSchema
>;

/** Why a field is next. Deterministic, from coverage alone. */
export const ONBOARDING_NEXT_REASONS = [
  "CONTRADICTION",
  "ESSENTIAL_MISSING",
  "CONFIRM_PROPOSAL",
  "IMPORTANT_MISSING",
  "EVIDENCE_NEEDED",
  "OPTIONAL_OFFER",
] as const;
export const OnboardingNextReasonSchema = z.enum(ONBOARDING_NEXT_REASONS);
export type OnboardingNextReason = z.infer<typeof OnboardingNextReasonSchema>;

export const OnboardingNextFieldSchema = z
  .object({
    fieldKey: OnboardingStepKeySchema,
    reason: OnboardingNextReasonSchema,
  })
  .strict();
export type OnboardingNextField = z.infer<typeof OnboardingNextFieldSchema>;

export const OnboardingCoverageSummarySchema = z
  .object({
    /** Applicable fields only. */
    applicable: z.number().int().min(0),
    /** KNOWN or CONFIRMED_SAVED or EVIDENCE_NEEDED (saved, evidence outstanding). */
    settled: z.number().int().min(0),
    essentialTotal: z.number().int().min(0),
    essentialSettled: z.number().int().min(0),
    unconfirmed: z.number().int().min(0),
    contradictory: z.number().int().min(0),
    missing: z.number().int().min(0),
    deferrable: z.number().int().min(0),
    evidenceNeeded: z.number().int().min(0),
    pendingSaves: z.number().int().min(0),
    /** Required fields are all settled and nothing is contradictory or unsaved. */
    canComplete: z.boolean(),
    /** A rough remaining-time estimate from open essentials and important fields. */
    minutesLeft: z.number().int().min(0),
  })
  .strict();
export type OnboardingCoverageSummary = z.infer<
  typeof OnboardingCoverageSummarySchema
>;

/** BCP 47 language tag ("en", "ar", "en-GB"). Copy is chosen by it; data is not. */
export const OnboardingLocaleSchema = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
  .max(35);
export type OnboardingLocale = z.infer<typeof OnboardingLocaleSchema>;

export const OnboardingCoverageSchema = z
  .object({
    sessionId: UuidSchema,
    journeyType: OnboardingJourneyTypeSchema,
    definitionVersion: z.number().int().min(1),
    /** The coverage annex version the priorities came from. */
    profileVersion: z.string().min(1).max(40),
    locale: OnboardingLocaleSchema,
    fields: z.array(OnboardingCoverageFieldSchema).max(80),
    summary: OnboardingCoverageSummarySchema,
    /** What to ask next, most material first; a hint for Q and the form, not a route. */
    next: z.array(OnboardingNextFieldSchema).max(12),
    computedAt: UtcTimestampSchema,
  })
  .strict();
export type OnboardingCoverage = z.infer<typeof OnboardingCoverageSchema>;

/** `GET /v1/onboarding/sessions/:id/coverage` -- the caller's own session only. */
export const GetOnboardingCoverageResponseSchema = z
  .object({ coverage: OnboardingCoverageSchema })
  .strict();
export type GetOnboardingCoverageResponse = z.infer<
  typeof GetOnboardingCoverageResponseSchema
>;

// ---------------------------------------------------------------------------
// Grouped confirmation and the pending-save queue
// ---------------------------------------------------------------------------

/**
 * One confirmation covering several facts ("I have these from your deck:
 * ... Shall I save them?"). Each item is a pending suggestion; accepting the
 * group resolves each through the ordinary suggestion resolution, under the
 * person's own credentials, each with its own idempotency key derived from
 * the group, so a retried group writes nothing twice.
 */
export const OnboardingConfirmationItemSchema = z
  .object({
    fieldKey: OnboardingStepKeySchema,
    suggestionId: UuidSchema,
    label: z.string().max(160),
    display: z.string().max(600),
    source: OnboardingCoverageSourceSchema,
  })
  .strict();
export type OnboardingConfirmationItem = z.infer<
  typeof OnboardingConfirmationItemSchema
>;

export const OnboardingConfirmationGroupSchema = z
  .object({
    groupId: z.string().min(8).max(80),
    locale: OnboardingLocaleSchema,
    items: z.array(OnboardingConfirmationItemSchema).min(1).max(12),
    /** The sentence put to the person, in `locale`. */
    prompt: z.string().min(1).max(2000),
  })
  .strict();
export type OnboardingConfirmationGroup = z.infer<
  typeof OnboardingConfirmationGroupSchema
>;

/** Lifecycle of a confirmed change held because a dependency was down. */
export const ONBOARDING_PENDING_WRITE_STATUSES = [
  "PENDING",
  "APPLIED",
  "REFUSED",
  "DISCARDED",
] as const;
export const OnboardingPendingWriteStatusSchema = z.enum(
  ONBOARDING_PENDING_WRITE_STATUSES,
);
export type OnboardingPendingWriteStatus = z.infer<
  typeof OnboardingPendingWriteStatusSchema
>;

export const OnboardingPendingWriteViewSchema = z
  .object({
    id: UuidSchema,
    fieldKey: OnboardingStepKeySchema,
    status: OnboardingPendingWriteStatusSchema,
    attempts: z.number().int().min(0),
    createdAt: UtcTimestampSchema,
  })
  .strict();
export type OnboardingPendingWriteView = z.infer<
  typeof OnboardingPendingWriteViewSchema
>;
