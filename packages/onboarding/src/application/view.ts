import type {
  OnboardingInterviewQuestionView,
  OnboardingPathChanges,
  OnboardingResponseView,
  OnboardingSessionView,
  OnboardingStepPresentation,
  OnboardingStepView,
  OnboardingSuggestionView,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

import type {
  OnboardingInterviewQuestion,
  OnboardingResponse,
  OnboardingSession,
  OnboardingStepDefinition,
  OnboardingStepState,
  OnboardingSuggestion,
  PublishedOnboardingDefinition,
} from "../contracts/index.js";
import type { OnboardingStepConfiguration } from "../definitions/schema.js";
import { OnboardingRuntimeConfigurationError } from "../domain/errors.js";
import {
  computeActivePath,
  computeProgress,
  type ActivePath,
} from "../runtime/path.js";
import type {
  OnboardingDefinitionRepository,
  OnboardingInterviewQuestionRepository,
  OnboardingResponseRepository,
  OnboardingStepStateRepository,
  OnboardingSuggestionRepository,
} from "./ports.js";

/**
 * The session aggregate the runtime reasons over and the safe client
 * projection built from it. Loading is bounded: session, pinned definition
 * (immutable, cached per process), step states, current responses and
 * pending suggestions -- never one query per step. The projection carries
 * interaction semantics only; write targets and branching stay server-side.
 */

export type OnboardingSessionAggregate = {
  readonly session: OnboardingSession;
  readonly definition: PublishedOnboardingDefinition;
  readonly stepsByKey: ReadonlyMap<string, OnboardingStepDefinition>;
  readonly states: ReadonlyMap<string, OnboardingStepState>;
  readonly currentResponses: ReadonlyMap<string, OnboardingResponse>;
  readonly pendingSuggestions: readonly OnboardingSuggestion[];
  /** Questions Q still wants answered (CQ-PRE-REC-001). */
  readonly pendingQuestions: readonly OnboardingInterviewQuestion[];
  readonly path: ActivePath;
};

export type AggregateLoaderDependencies = {
  readonly definitions: OnboardingDefinitionRepository;
  readonly stepStates: OnboardingStepStateRepository;
  readonly responses: OnboardingResponseRepository;
  readonly suggestions: OnboardingSuggestionRepository;
  /** Optional so older compositions keep working; absent means no questions. */
  readonly questions?: OnboardingInterviewQuestionRepository | undefined;
};

/** Published versions are immutable, so a process-local cache is always correct. */
export function createDefinitionCache(
  definitions: OnboardingDefinitionRepository,
) {
  const cache = new Map<string, PublishedOnboardingDefinition>();
  return async (
    executor: DatabaseExecutor,
    versionId: OnboardingSession["definitionVersionId"],
  ): Promise<PublishedOnboardingDefinition> => {
    const cached = cache.get(versionId);
    if (cached !== undefined) {
      return cached;
    }
    const loaded = await definitions.findPublishedVersionById(
      executor,
      versionId,
    );
    if (loaded === null) {
      throw new OnboardingRuntimeConfigurationError(
        "DEFINITION_VERSION_MISSING",
        `definition version ${versionId} is not published`,
      );
    }
    cache.set(versionId, loaded);
    return loaded;
  };
}

export async function loadAggregate(
  executor: DatabaseExecutor,
  dependencies: AggregateLoaderDependencies,
  loadDefinition: ReturnType<typeof createDefinitionCache>,
  session: OnboardingSession,
): Promise<OnboardingSessionAggregate> {
  const [
    definition,
    stateRows,
    responseRows,
    pendingSuggestions,
    pendingQuestions,
  ] = await Promise.all([
    loadDefinition(executor, session.definitionVersionId),
    dependencies.stepStates.listBySession(executor, session.id),
    dependencies.responses.listCurrent(executor, session.id),
    dependencies.suggestions.listPending(executor, session.id),
    dependencies.questions === undefined
      ? Promise.resolve([] as readonly OnboardingInterviewQuestion[])
      : dependencies.questions.listPending(executor, session.id),
  ]);
  const stepsByKey = new Map(
    definition.steps.map((step) => [step.stepKey, step]),
  );
  const states = new Map(stateRows.map((state) => [state.stepKey, state]));
  const currentResponses = new Map(
    responseRows.map((response) => [response.stepKey, response]),
  );
  return {
    session,
    definition,
    stepsByKey,
    states,
    currentResponses,
    pendingSuggestions,
    pendingQuestions,
    path: computeActivePath(definition.steps, currentResponses),
  };
}

// ---------------------------------------------------------------------------
// Safe projections
// ---------------------------------------------------------------------------

function presentationOf(
  configuration: OnboardingStepConfiguration,
): OnboardingStepPresentation {
  switch (configuration.stepType) {
    case "single_select":
      return { stepType: "single_select", options: configuration.options };
    case "multi_select":
      return {
        stepType: "multi_select",
        options: configuration.options,
        minSelections: configuration.minSelections,
        maxSelections: configuration.maxSelections,
        exclusiveOptionKeys: configuration.exclusiveOptionKeys,
      };
    case "range":
      return {
        stepType: "range",
        min: configuration.min,
        max: configuration.max,
        ...(configuration.step === undefined
          ? {}
          : { step: configuration.step }),
        ...(configuration.unit === undefined
          ? {}
          : { unit: configuration.unit }),
      };
    case "short_text":
    case "long_text":
      return {
        stepType: configuration.stepType,
        minLength: configuration.minLength,
        maxLength: configuration.maxLength,
        ...(configuration.placeholder === undefined
          ? {}
          : { placeholder: configuration.placeholder }),
      };
    case "voice_text":
      return {
        stepType: "voice_text",
        maxLength: configuration.maxLength,
        ...(configuration.placeholder === undefined
          ? {}
          : { placeholder: configuration.placeholder }),
      };
    case "document_upload":
      return {
        stepType: "document_upload",
        allowedResourceTypes: configuration.allowedResourceTypes,
        minItems: configuration.minItems,
        maxItems: configuration.maxItems,
      };
    case "confirmation":
      return {
        stepType: "confirmation",
        confirmLabel: configuration.confirmLabel,
        ...(configuration.declineLabel === undefined
          ? {}
          : { declineLabel: configuration.declineLabel }),
        requireAffirmative: configuration.requireAffirmative,
        ...(configuration.contextKey === undefined
          ? {}
          : { contextKey: configuration.contextKey }),
      };
    case "reference_select":
      return {
        stepType: "reference_select",
        resourceType: configuration.resourceType,
        vocabularyCodes: configuration.vocabularyCodes,
        minItems: configuration.minItems,
        maxItems: configuration.maxItems,
        ...(configuration.contextKey === undefined
          ? {}
          : { contextKey: configuration.contextKey }),
      };
  }
}

export function toResponseView(
  response: OnboardingResponse,
): OnboardingResponseView {
  return {
    id: response.id,
    stepKey: response.stepKey,
    responseType: response.responseType,
    value: response.value,
    sourceModality: response.sourceModality,
    createdAt: response.createdAt,
  };
}

export function toStepView(
  step: OnboardingStepDefinition,
  currentResponse: OnboardingResponse | undefined,
  context?: Readonly<Record<string, unknown>>,
): OnboardingStepView {
  const { configuration } = step;
  return {
    stepKey: step.stepKey,
    stepType: step.stepType,
    required: step.required,
    prompt: configuration.prompt,
    ...(configuration.supportingText === undefined
      ? {}
      : { supportingText: configuration.supportingText }),
    ...(configuration.whyQAsks === undefined
      ? {}
      : { whyQAsks: configuration.whyQAsks }),
    ...(configuration.phaseKey === undefined
      ? {}
      : { phaseKey: configuration.phaseKey }),
    presentation: presentationOf(configuration),
    ...(currentResponse === undefined
      ? {}
      : { currentResponse: toResponseView(currentResponse) }),
    ...(context === undefined ? {} : { context }),
  };
}

export function toSuggestionView(
  suggestion: OnboardingSuggestion,
): OnboardingSuggestionView {
  return {
    id: suggestion.id,
    stepKey: suggestion.stepKey,
    targetField: suggestion.targetField,
    suggestedValue: suggestion.suggestedValue,
    confidence: suggestion.confidence,
    status: suggestion.status,
    createdAt: suggestion.createdAt,
  };
}

export function toQuestionView(
  question: OnboardingInterviewQuestion,
): OnboardingInterviewQuestionView {
  return {
    id: question.id,
    stepKey: question.stepKey,
    factKey: question.factKey,
    question: question.question,
    why: question.why,
    reason: question.reason,
    readings: [...question.readings],
    options: question.options.map((option) => ({
      label: option.label,
      stepKey: option.stepKey,
      value: option.value,
    })),
    createdAt: question.createdAt,
  };
}

/** Most material first; the reason vocabulary is already in that order. */
const QUESTION_RANK: Readonly<
  Record<OnboardingInterviewQuestion["reason"], number>
> = {
  CONTRADICTION: 0,
  EXCLUSION_CONFIRMATION: 1,
  REQUIRED_AND_UNANSWERED: 2,
  AMBIGUITY: 3,
  MATERIAL_GAP: 4,
};

/**
 * The questions a client should still show: on the eligible path, and not
 * overtaken by an answer given to the mapped step after the question was
 * asked. The second condition is belt and braces for the explicit ANSWERED
 * transition, so a crash between a submit and its mark never re-asks.
 */
export function pendingQuestionViews(
  aggregate: OnboardingSessionAggregate,
): OnboardingInterviewQuestionView[] {
  const { path, currentResponses } = aggregate;
  // Tolerant of an aggregate assembled without questions (older callers,
  // tests): no questions is the same as none pending.
  return [...(aggregate.pendingQuestions ?? [])]
    .filter((question) => {
      if (!path.eligibleKeys.has(question.stepKey)) {
        return false;
      }
      const response = currentResponses.get(question.stepKey);
      return response === undefined || response.createdAt <= question.createdAt;
    })
    .sort(
      (a, b) =>
        QUESTION_RANK[a.reason] - QUESTION_RANK[b.reason] ||
        (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0),
    )
    .map(toQuestionView);
}

export function toSessionView(
  aggregate: OnboardingSessionAggregate,
  pathChanges?: OnboardingPathChanges,
  stepContext?: Readonly<Record<string, unknown>>,
): OnboardingSessionView {
  const { session, definition, path, states, currentResponses } = aggregate;
  const current =
    session.currentStepKey === null
      ? undefined
      : path.eligible.find((step) => step.stepKey === session.currentStepKey);
  return {
    session: {
      id: session.id,
      journeyType: session.journeyType,
      definitionVersionId: session.definitionVersionId,
      definitionVersion: definition.version.version,
      status: session.status,
      subject:
        session.subject === null
          ? null
          : {
              type: session.subject.subjectType,
              id: session.subject.subjectId,
            },
      currentStepKey: session.currentStepKey,
      version: session.version,
      startedAt: session.startedAt,
      lastActivityAt: session.lastActivityAt,
      completedAt: session.completedAt,
    },
    phases: definition.version.schema.phases,
    currentStep:
      current === undefined
        ? null
        : toStepView(
            current,
            currentResponses.get(current.stepKey),
            stepContext,
          ),
    progress: computeProgress(session, path, states),
    pendingSuggestions: aggregate.pendingSuggestions
      .filter((s) => path.eligibleKeys.has(s.stepKey))
      .map(toSuggestionView),
    responses: path.eligible.flatMap((step) => {
      const response = currentResponses.get(step.stepKey);
      return response === undefined ? [] : [toResponseView(response)];
    }),
    pendingQuestions: pendingQuestionViews(aggregate),
    ...(pathChanges === undefined ? {} : { pathChanges }),
  };
}
