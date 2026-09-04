import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  defineEvent,
  EventIdSchema,
  OnboardingJourneyTypeSchema,
  OnboardingStepKeySchema,
  OnboardingSubjectTypeSchema,
  OnboardingSuggestionStatusSchema,
  UtcTimestampSchema,
  UuidSchema,
  type CapitalQEvent,
  type CorrelationId,
  type EventDefinition,
} from "@capital-q/contracts";

import type { OnboardingSession } from "../contracts/index.js";

/**
 * Onboarding runtime events. Identifiers, step keys, versions and statuses
 * only: never a response value, raw text, suggested value or transcript.
 * CONFIDENTIAL because journey activity itself reveals private business
 * context. PLATFORM tenancy because a bootstrap session has no tenant yet;
 * a bound session still carries its tenant and organisation on the
 * envelope. Consumers re-read authorised state.
 */

export const ONBOARDING_EVENT_OWNER = "@capital-q/onboarding" as const;
export const ONBOARDING_EVENT_PRODUCER = "capitalq://api/onboarding" as const;

const CONSUMERS = ["@capital-q/intelligence", "@capital-q/q"];
const sessionVersion = z.number().int().min(1);

const SessionIdentity = {
  sessionId: UuidSchema,
  journeyType: OnboardingJourneyTypeSchema,
  definitionVersionId: UuidSchema,
  subjectType: OnboardingSubjectTypeSchema.optional(),
  subjectId: UuidSchema.optional(),
};

export const OnboardingSessionStartedEvent = defineEvent({
  name: "onboarding.session.started",
  version: 1,
  owner: ONBOARDING_EVENT_OWNER,
  producer: ONBOARDING_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  tenancy: "PLATFORM",
  dataSchema: z.object(SessionIdentity).strict(),
  description:
    "An onboarding session began on a pinned definition version. Carries identifiers only.",
});

export const OnboardingResponseCommittedEvent = defineEvent({
  name: "onboarding.response.committed",
  version: 1,
  owner: ONBOARDING_EVENT_OWNER,
  producer: ONBOARDING_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  tenancy: "PLATFORM",
  dataSchema: z
    .object({
      sessionId: UuidSchema,
      stepKey: OnboardingStepKeySchema,
      responseId: UuidSchema,
      sessionVersion,
    })
    .strict(),
  description:
    "A validated response was committed for a step. Carries no response body.",
});

export const OnboardingStepSkippedEvent = defineEvent({
  name: "onboarding.step.skipped",
  version: 1,
  owner: ONBOARDING_EVENT_OWNER,
  producer: ONBOARDING_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  tenancy: "PLATFORM",
  dataSchema: z
    .object({
      sessionId: UuidSchema,
      stepKey: OnboardingStepKeySchema,
      sessionVersion,
    })
    .strict(),
  description: "An optional step was skipped. Unknown stays unknown.",
});

export const OnboardingSessionCompletedEvent = defineEvent({
  name: "onboarding.session.completed",
  version: 1,
  owner: ONBOARDING_EVENT_OWNER,
  producer: ONBOARDING_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  tenancy: "PLATFORM",
  dataSchema: z.object(SessionIdentity).strict(),
  description:
    "An onboarding session completed. Not readiness, visibility or verification.",
});

export const OnboardingSuggestionResolvedEvent = defineEvent({
  name: "onboarding.suggestion.resolved",
  version: 1,
  owner: ONBOARDING_EVENT_OWNER,
  producer: ONBOARDING_EVENT_PRODUCER,
  consumers: CONSUMERS,
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  tenancy: "PLATFORM",
  dataSchema: z
    .object({
      sessionId: UuidSchema,
      suggestionId: UuidSchema,
      stepKey: OnboardingStepKeySchema,
      resolution: OnboardingSuggestionStatusSchema.exclude(["PENDING"]),
    })
    .strict(),
  description:
    "A suggestion was accepted, edited, rejected or expired. Carries no suggested or edited content.",
});

export const ONBOARDING_EVENTS: readonly EventDefinition[] = [
  OnboardingSessionStartedEvent,
  OnboardingResponseCommittedEvent,
  OnboardingStepSkippedEvent,
  OnboardingSessionCompletedEvent,
  OnboardingSuggestionResolvedEvent,
];

type Envelope = {
  readonly session: OnboardingSession;
  readonly correlationId: CorrelationId;
};

function envelope<TData>(
  definition: EventDefinition,
  input: Envelope,
  data: TData,
): CapitalQEvent<TData> {
  const { session } = input;
  return {
    specVersion: "1.0",
    id: EventIdSchema.parse(randomUUID()),
    type: definition.name,
    source: definition.producer,
    time: UtcTimestampSchema.parse(new Date().toISOString()),
    subject: `onboarding_session/${session.id}`,
    dataContentType: "application/json",
    eventVersion: definition.version,
    ...(session.tenantId === null ? {} : { tenantId: session.tenantId }),
    ...(session.organisationId === null
      ? {}
      : { organisationId: session.organisationId }),
    actor: { type: "HUMAN", id: session.userId },
    correlationId: input.correlationId,
    aggregate: { type: "onboarding_session", id: session.id },
    data,
  };
}

function identity(session: OnboardingSession) {
  return {
    sessionId: session.id,
    journeyType: session.journeyType,
    definitionVersionId: session.definitionVersionId,
    ...(session.subject === null
      ? {}
      : {
          subjectType: session.subject.subjectType,
          subjectId: session.subject.subjectId,
        }),
  };
}

export const sessionStartedEvent = (input: Envelope) =>
  envelope(OnboardingSessionStartedEvent, input, identity(input.session));

export const responseCommittedEvent = (
  input: Envelope & { readonly stepKey: string; readonly responseId: string },
) =>
  envelope(OnboardingResponseCommittedEvent, input, {
    sessionId: input.session.id,
    stepKey: input.stepKey,
    responseId: input.responseId,
    sessionVersion: input.session.version,
  });

export const stepSkippedEvent = (
  input: Envelope & { readonly stepKey: string },
) =>
  envelope(OnboardingStepSkippedEvent, input, {
    sessionId: input.session.id,
    stepKey: input.stepKey,
    sessionVersion: input.session.version,
  });

export const sessionCompletedEvent = (input: Envelope) =>
  envelope(OnboardingSessionCompletedEvent, input, identity(input.session));

export const suggestionResolvedEvent = (
  input: Envelope & {
    readonly suggestionId: string;
    readonly stepKey: string;
    readonly resolution: "ACCEPTED" | "EDITED" | "REJECTED" | "EXPIRED";
  },
) =>
  envelope(OnboardingSuggestionResolvedEvent, input, {
    sessionId: input.session.id,
    suggestionId: input.suggestionId,
    stepKey: input.stepKey,
    resolution: input.resolution,
  });
