import { z } from "zod";

import {
  OnboardingResponseValueSchema,
  OnboardingSessionViewSchema,
  type OnboardingJourneyType,
  type OnboardingResponseValue,
  type OnboardingSessionView,
  type OnboardingStepPresentation,
  type OnboardingStepProgressStatus,
} from "@capital-q/contracts";
import type { FOUNDER_DEFINITION_V1 } from "@capital-q/founder-onboarding/definition";

import { OnboardingClientError, type TaxonomyCandidateView } from "./client";
import type { RuntimePort } from "./runtime-port";

/**
 * Development fixture core: an in-memory onboarding runtime over any
 * published definition, speaking the same session-view contract as the API
 * (validated with the contract schema on every read). It evaluates the
 * definition's own branching, keeps state in sessionStorage so refresh and
 * re-entry resume, and never talks to a backend. Journeys supply their
 * seeds, their step contexts and their synthetic taxonomy.
 *
 * Never composed in production: see each journey's compose and the web
 * config guard.
 */

export type DefinitionManifest = typeof FOUNDER_DEFINITION_V1;
export type StepManifest = DefinitionManifest["steps"][number];
type BranchExpression = NonNullable<StepManifest["branching"]>;

const StoredStateSchema = z.object({
  version: z.literal(3),
  sessionVersion: z.number().int().min(1),
  status: z.enum(["ACTIVE", "COMPLETED"]),
  currentStepKey: z.string().nullable(),
  responses: z.record(z.string(), OnboardingResponseValueSchema),
  states: z.record(z.string(), z.enum(["IN_PROGRESS", "COMPLETED", "SKIPPED"])),
  /** Journey-specific synthetic facts (e.g. a created objective). */
  extra: z.record(z.string(), z.unknown()),
  failNextSave: z.boolean(),
});
export type FixtureState = z.infer<typeof StoredStateSchema>;

export type SyntheticNode = TaxonomyCandidateView & {
  readonly vocabularyCode: string;
  readonly keywords: readonly string[];
};

export type FixtureRuntimeOptions = {
  readonly definition: DefinitionManifest;
  readonly journeyType: OnboardingJourneyType;
  readonly sessionId: string;
  readonly versionId: string;
  readonly storageKey: string;
  readonly storage: Storage | null;
  /** When given, replaces stored state (a `?fixture=` seed). */
  readonly seed?: FixtureState | undefined;
  /** Fresh state when nothing is stored. */
  readonly initial: () => FixtureState;
  readonly subjectFor: (state: FixtureState) => {
    readonly type: "COMPANY" | "INVESTOR_ORGANISATION";
    readonly id: string;
  } | null;
  readonly contextFor: (step: StepManifest, state: FixtureState) => unknown;
  /** Journey-specific synthetic side effects of a committed answer. */
  readonly onSubmit?:
    | ((
        state: FixtureState,
        stepKey: string,
        value: OnboardingResponseValue,
      ) => Record<string, unknown>)
    | undefined;
  readonly nodes: readonly SyntheticNode[];
};

const STARTED_AT = "2026-09-05T09:00:00.000Z";

// ---------------------------------------------------------------------------
// State accessors journeys use to build contexts and seeds
// ---------------------------------------------------------------------------

export const single_ = (optionKey: string): OnboardingResponseValue => ({
  type: "SINGLE_SELECT",
  optionKey,
});
export const text_ = (value: string): OnboardingResponseValue => ({
  type: "TEXT",
  text: value,
});
export const range_ = (value: string): OnboardingResponseValue => ({
  type: "RANGE",
  value,
});
export const multi_ = (optionKeys: string[]): OnboardingResponseValue => ({
  type: "MULTI_SELECT",
  optionKeys,
});
export const refs_ = (
  resourceType: "TAXONOMY_NODE" | "INVESTOR_MANDATE" | "EVIDENCE_DOCUMENT",
  resourceIds: string[],
): OnboardingResponseValue => ({
  type: "RESOURCE_REFERENCE",
  resourceType,
  resourceIds,
});
export const confirm_: OnboardingResponseValue = {
  type: "CONFIRMATION",
  confirmed: true,
};

export function single(state: FixtureState, key: string) {
  const v = state.responses[key];
  return v?.type === "SINGLE_SELECT" ? v.optionKey : undefined;
}
export function multi(state: FixtureState, key: string) {
  const v = state.responses[key];
  return v?.type === "MULTI_SELECT" ? v.optionKeys : undefined;
}
export function text(state: FixtureState, key: string) {
  const v = state.responses[key];
  return v?.type === "TEXT" ? v.text : undefined;
}
export function range(state: FixtureState, key: string) {
  const v = state.responses[key];
  return v?.type === "RANGE" ? v.value : undefined;
}
export function refs(state: FixtureState, key: string): readonly string[] {
  const v = state.responses[key];
  return v?.type === "RESOURCE_REFERENCE" ? v.resourceIds : [];
}

export function optionOf(
  definition: DefinitionManifest,
  stepKey: string,
  key: string | undefined,
): { key: string; label: string } | null {
  const step = definition.steps.find((s) => s.stepKey === stepKey);
  if (key === undefined || step === undefined) return null;
  const c = step.configuration;
  if (c.stepType !== "single_select" && c.stepType !== "multi_select")
    return null;
  const found = c.options.find((o) => o.optionKey === key);
  return found === undefined
    ? null
    : { key: found.optionKey, label: found.label };
}

export function optionsOf(
  definition: DefinitionManifest,
  stepKey: string,
  keys: readonly string[] | undefined,
): { key: string; label: string }[] | null {
  if (keys === undefined) return null;
  return keys.flatMap((key) => {
    const item = optionOf(definition, stepKey, key);
    return item === null ? [] : [item];
  });
}

/**
 * Build a seeded state from answers in definition order: every answered
 * step is COMPLETED, every listed skip is SKIPPED, and the pointer lands on
 * the first incomplete eligible step.
 */
export function seededState(
  definition: DefinitionManifest,
  answered: readonly (readonly [string, OnboardingResponseValue])[],
  skipped: readonly string[] = [],
  extra: Record<string, unknown> = {},
  failNextSave = false,
): FixtureState {
  const responses = Object.fromEntries(answered);
  const states: FixtureState["states"] = {};
  for (const [key] of answered) states[key] = "COMPLETED";
  for (const key of skipped) states[key] = "SKIPPED";
  const state: FixtureState = {
    version: 3,
    sessionVersion: 1 + answered.length + skipped.length,
    status: "ACTIVE",
    currentStepKey: definition.steps[0]?.stepKey ?? null,
    responses,
    states,
    extra,
    failNextSave,
  };
  const next = nextIncomplete(definition, state, null);
  state.currentStepKey = next ?? state.currentStepKey;
  if (state.currentStepKey !== null) {
    states[state.currentStepKey] ??= "IN_PROGRESS";
  }
  return state;
}

// ---------------------------------------------------------------------------
// Branching (mirror of the runtime's evaluator, over the same data DSL)
// ---------------------------------------------------------------------------

type Scalar = string | number | boolean;

function scalarOf(value: OnboardingResponseValue): Scalar | null {
  switch (value.type) {
    case "SINGLE_SELECT":
      return value.optionKey;
    case "CONFIRMATION":
      return value.confirmed;
    case "RANGE":
      return value.value;
    case "TEXT":
      return value.text;
    case "MULTI_SELECT":
    case "RESOURCE_REFERENCE":
      return null;
  }
}

function equals(actual: Scalar | null, expected: Scalar): boolean {
  if (actual === null) return false;
  if (typeof actual === "string" && typeof expected === "number") {
    return actual === String(expected);
  }
  return actual === expected;
}

function evaluate(
  expression: BranchExpression,
  snapshot: ReadonlyMap<string, OnboardingResponseValue>,
): boolean {
  switch (expression.op) {
    case "EXISTS":
      return snapshot.has(expression.stepKey);
    case "EQUALS": {
      const value = snapshot.get(expression.stepKey);
      return value === undefined
        ? false
        : equals(scalarOf(value), expression.value);
    }
    case "IN": {
      const value = snapshot.get(expression.stepKey);
      if (value === undefined) return false;
      const scalar = scalarOf(value);
      return expression.values.some((candidate) => equals(scalar, candidate));
    }
    case "CONTAINS": {
      const value = snapshot.get(expression.stepKey);
      if (value === undefined) return false;
      if (value.type === "MULTI_SELECT") {
        return value.optionKeys.some((k) => k === expression.value);
      }
      if (value.type === "RESOURCE_REFERENCE") {
        return value.resourceIds.some((k) => k === expression.value);
      }
      return equals(scalarOf(value), expression.value);
    }
    case "ALL":
      return expression.expressions.every((e) => evaluate(e, snapshot));
    case "ANY":
      return expression.expressions.some((e) => evaluate(e, snapshot));
    case "NOT":
      return !evaluate(expression.expression, snapshot);
  }
}

export function eligibleSteps(
  definition: DefinitionManifest,
  state: FixtureState,
): StepManifest[] {
  const visible = new Map<string, OnboardingResponseValue>();
  const eligible: StepManifest[] = [];
  for (const step of definition.steps) {
    if (step.branching !== null && !evaluate(step.branching, visible)) {
      continue;
    }
    eligible.push(step);
    const response = state.responses[step.stepKey];
    if (response !== undefined) {
      visible.set(step.stepKey, response);
    }
  }
  return eligible;
}

function nextIncomplete(
  definition: DefinitionManifest,
  state: FixtureState,
  afterKey: string | null,
): string | null {
  const eligible = eligibleSteps(definition, state);
  const start =
    afterKey === null
      ? 0
      : eligible.findIndex((s) => s.stepKey === afterKey) + 1;
  for (const step of eligible.slice(start)) {
    const status = state.states[step.stepKey];
    if (status !== "COMPLETED" && status !== "SKIPPED") {
      return step.stepKey;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Presentation of a step (mirror of the runtime's safe projection)
// ---------------------------------------------------------------------------

function presentationOf(step: StepManifest): OnboardingStepPresentation {
  const c = step.configuration;
  switch (c.stepType) {
    case "single_select":
      return { stepType: "single_select", options: c.options };
    case "multi_select":
      return {
        stepType: "multi_select",
        options: c.options,
        minSelections: c.minSelections,
        maxSelections: c.maxSelections,
        exclusiveOptionKeys: c.exclusiveOptionKeys,
      };
    case "range":
      return {
        stepType: "range",
        min: c.min,
        max: c.max,
        ...(c.step === undefined ? {} : { step: c.step }),
        ...(c.unit === undefined ? {} : { unit: c.unit }),
      };
    case "short_text":
    case "long_text":
      return {
        stepType: c.stepType,
        minLength: c.minLength,
        maxLength: c.maxLength,
        ...(c.placeholder === undefined ? {} : { placeholder: c.placeholder }),
      };
    case "voice_text":
      return {
        stepType: "voice_text",
        maxLength: c.maxLength,
        ...(c.placeholder === undefined ? {} : { placeholder: c.placeholder }),
      };
    case "document_upload":
      return {
        stepType: "document_upload",
        allowedResourceTypes: c.allowedResourceTypes,
        minItems: c.minItems,
        maxItems: c.maxItems,
      };
    case "confirmation":
      return {
        stepType: "confirmation",
        confirmLabel: c.confirmLabel,
        ...(c.declineLabel === undefined
          ? {}
          : { declineLabel: c.declineLabel }),
        requireAffirmative: c.requireAffirmative,
        ...(c.contextKey === undefined ? {} : { contextKey: c.contextKey }),
      };
    case "reference_select":
      return {
        stepType: "reference_select",
        resourceType: c.resourceType,
        vocabularyCodes: c.vocabularyCodes,
        minItems: c.minItems,
        maxItems: c.maxItems,
        ...(c.contextKey === undefined ? {} : { contextKey: c.contextKey }),
      };
  }
}

/** A stable, valid UUID per step key for synthetic response rows. */
function syntheticResponseId(stepKey: string): string {
  let hash = 2166136261;
  for (const char of stepKey) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  const hex = hash.toString(16).padStart(8, "0");
  return `${hex}-${hex.slice(0, 4)}-4${hex.slice(1, 4)}-8${hex.slice(4, 7)}-${hex}${hex.slice(0, 4)}`;
}

function expectedType(step: StepManifest): OnboardingResponseValue["type"] {
  switch (step.configuration.stepType) {
    case "single_select":
      return "SINGLE_SELECT";
    case "multi_select":
      return "MULTI_SELECT";
    case "range":
      return "RANGE";
    case "short_text":
    case "long_text":
    case "voice_text":
      return "TEXT";
    case "document_upload":
    case "reference_select":
      return "RESOURCE_REFERENCE";
    case "confirmation":
      return "CONFIRMATION";
  }
}

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

export function createFixtureRuntime(
  options: FixtureRuntimeOptions,
): RuntimePort {
  const { definition } = options;
  let state = load(options);

  function persist(next: FixtureState) {
    state = next;
    try {
      options.storage?.setItem(options.storageKey, JSON.stringify(next));
    } catch {
      // Storage may be unavailable (private mode); the in-memory copy still works.
    }
  }

  // Another tab (or client) may have written since: adopt the stored state
  // when it is newer, so stale versions conflict exactly as they would on
  // the real API.
  function sync() {
    try {
      const raw = options.storage?.getItem(options.storageKey);
      if (raw !== null && raw !== undefined) {
        const parsed = StoredStateSchema.safeParse(JSON.parse(raw));
        if (
          parsed.success &&
          parsed.data.sessionVersion > state.sessionVersion
        ) {
          state = parsed.data;
        }
      }
    } catch {
      // unreadable storage: keep the in-memory state
    }
  }

  function view(): OnboardingSessionView {
    const eligible = eligibleSteps(definition, state);
    const current =
      state.currentStepKey === null
        ? undefined
        : eligible.find((s) => s.stepKey === state.currentStepKey);
    const statusOf = (key: string): OnboardingStepProgressStatus =>
      state.states[key] ?? "PENDING";
    const currentResponse = (key: string) => {
      const value = state.responses[key];
      return value === undefined
        ? undefined
        : ({
            id: syntheticResponseId(key),
            stepKey: key,
            responseType: value.type,
            value,
            sourceModality: value.type === "TEXT" ? "TYPED_TEXT" : "SELECTION",
            createdAt: STARTED_AT,
          } as const);
    };
    const completedCount = eligible.filter((s) => {
      const st = statusOf(s.stepKey);
      return st === "COMPLETED" || st === "SKIPPED";
    }).length;
    const context =
      current === undefined ? undefined : options.contextFor(current, state);
    const raw: OnboardingSessionView = {
      session: {
        id: options.sessionId,
        journeyType: options.journeyType,
        definitionVersionId: options.versionId,
        definitionVersion: definition.version,
        status: state.status,
        subject: options.subjectFor(state),
        currentStepKey: state.currentStepKey,
        version: state.sessionVersion,
        startedAt: STARTED_AT,
        lastActivityAt: STARTED_AT,
        completedAt: state.status === "COMPLETED" ? STARTED_AT : null,
      },
      phases: definition.schema.phases,
      currentStep:
        current === undefined
          ? null
          : {
              stepKey: current.stepKey,
              stepType: current.configuration.stepType,
              required: current.required,
              prompt: current.configuration.prompt,
              ...(current.configuration.supportingText === undefined
                ? {}
                : { supportingText: current.configuration.supportingText }),
              ...(current.configuration.phaseKey === undefined
                ? {}
                : { phaseKey: current.configuration.phaseKey }),
              presentation: presentationOf(current),
              ...(currentResponse(current.stepKey) === undefined
                ? {}
                : { currentResponse: currentResponse(current.stepKey) }),
              ...(context === undefined
                ? {}
                : { context: context as Record<string, unknown> }),
            },
      progress: {
        currentStepKey: state.currentStepKey,
        currentPhaseKey: current?.configuration.phaseKey ?? null,
        eligibleSteps: eligible.map((s) => ({
          stepKey: s.stepKey,
          ...(s.configuration.phaseKey === undefined
            ? {}
            : { phaseKey: s.configuration.phaseKey }),
          required: s.required,
          status: statusOf(s.stepKey),
        })),
        eligibleStepCount: eligible.length,
        completedEligibleStepCount: completedCount,
        canGoBack:
          eligible.findIndex((s) => s.stepKey === state.currentStepKey) > 0,
        canSkipCurrentStep: current !== undefined && !current.required,
        canComplete:
          state.status === "ACTIVE" &&
          eligible.every(
            (s) => !s.required || statusOf(s.stepKey) === "COMPLETED",
          ),
      },
      pendingSuggestions: [],
      responses: eligible.flatMap((s) => {
        const r = currentResponse(s.stepKey);
        return r === undefined ? [] : [r];
      }),
    };
    return OnboardingSessionViewSchema.parse(raw);
  }

  const reject = (message: string) =>
    new OnboardingClientError("REJECTED", message);

  function requireVersion(expected: number) {
    if (expected !== state.sessionVersion) {
      throw new OnboardingClientError(
        "CONFLICT",
        "This step changed in another tab. Showing the latest.",
      );
    }
  }

  function requireActive() {
    if (state.status !== "ACTIVE") {
      throw reject("Setup is already complete.");
    }
  }

  function eligibleStep(stepKey: string): StepManifest {
    const step = eligibleSteps(definition, state).find(
      (s) => s.stepKey === stepKey,
    );
    if (step === undefined) {
      throw reject("That question isn't part of your current path.");
    }
    return step;
  }

  function moveOn(next: FixtureState, afterKey: string): FixtureState {
    const following = nextIncomplete(definition, next, afterKey);
    next.currentStepKey = following ?? afterKey;
    if (following !== null) {
      next.states = {
        ...next.states,
        [following]: next.states[following] ?? "IN_PROGRESS",
      };
    }
    return next;
  }

  const delay = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    sync();
  };

  const strip = ({
    keywords: _keywords,
    vocabularyCode: _v,
    ...candidate
  }: SyntheticNode) => candidate;

  return {
    current: async () => {
      await delay();
      return view();
    },
    start: async () => {
      await delay();
      return view();
    },
    get: async () => {
      await delay();
      return view();
    },
    submit: async ({ stepKey, value, expectedSessionVersion }) => {
      await delay();
      requireActive();
      requireVersion(expectedSessionVersion);
      if (state.failNextSave) {
        persist({ ...state, failNextSave: false });
        throw new OnboardingClientError(
          "NETWORK",
          "Couldn't reach Capital Q. Please try again.",
        );
      }
      const step = eligibleStep(stepKey);
      if (value.type !== expectedType(step)) {
        throw reject("That answer doesn't fit the question.");
      }
      const c = step.configuration;
      if (
        (c.stepType === "single_select" &&
          value.type === "SINGLE_SELECT" &&
          !c.options.some((o) => o.optionKey === value.optionKey)) ||
        (c.stepType === "multi_select" &&
          value.type === "MULTI_SELECT" &&
          !value.optionKeys.every((k) =>
            c.options.some((o) => o.optionKey === k),
          ))
      ) {
        throw reject("Choose one of the offered options.");
      }
      const next: FixtureState = {
        ...state,
        sessionVersion: state.sessionVersion + 1,
        responses: { ...state.responses, [stepKey]: value },
        states: { ...state.states, [stepKey]: "COMPLETED" },
        extra: {
          ...state.extra,
          ...(options.onSubmit?.(state, stepKey, value) ?? {}),
        },
      };
      persist(moveOn(next, stepKey));
      return view();
    },
    skip: async ({ stepKey, expectedSessionVersion }) => {
      await delay();
      requireActive();
      requireVersion(expectedSessionVersion);
      const step = eligibleStep(stepKey);
      if (step.required) {
        throw reject("This question is needed to continue.");
      }
      const next: FixtureState = {
        ...state,
        sessionVersion: state.sessionVersion + 1,
        states: { ...state.states, [stepKey]: "SKIPPED" },
      };
      persist(moveOn(next, stepKey));
      return view();
    },
    navigate: async ({ expectedSessionVersion, targetStepKey }) => {
      await delay();
      requireActive();
      requireVersion(expectedSessionVersion);
      const eligible = eligibleSteps(definition, state);
      const currentIndex = eligible.findIndex(
        (s) => s.stepKey === state.currentStepKey,
      );
      let target: string | undefined;
      if (targetStepKey === undefined) {
        for (let index = currentIndex - 1; index >= 0; index -= 1) {
          const candidate = eligible[index];
          if (
            candidate !== undefined &&
            state.states[candidate.stepKey] !== undefined
          ) {
            target = candidate.stepKey;
            break;
          }
        }
        if (target === undefined) throw reject("This is the first step.");
      } else {
        const index = eligible.findIndex((s) => s.stepKey === targetStepKey);
        if (
          index < 0 ||
          index === currentIndex ||
          state.states[targetStepKey] === undefined
        ) {
          throw reject("That step isn't available yet.");
        }
        target = targetStepKey;
      }
      persist({
        ...state,
        sessionVersion: state.sessionVersion + 1,
        currentStepKey: target,
      });
      return view();
    },
    complete: async ({ expectedSessionVersion }) => {
      await delay();
      requireActive();
      requireVersion(expectedSessionVersion);
      const incomplete = eligibleSteps(definition, state).some(
        (s) => s.required && state.states[s.stepKey] !== "COMPLETED",
      );
      if (incomplete) throw reject("A few required answers are still missing.");
      persist({
        ...state,
        sessionVersion: state.sessionVersion + 1,
        status: "COMPLETED",
        currentStepKey: null,
      });
      return view();
    },
    candidates: async (input) => {
      await delay();
      const haystack = input.toLowerCase();
      return options.nodes
        .filter((node) =>
          node.keywords.some((keyword) => haystack.includes(keyword)),
        )
        .map((node) => ({ ...strip(node), reason: "Matches words you used." }));
    },
    describeNodes: async (ids) => {
      await delay();
      return options.nodes
        .filter((node) => ids.includes(node.nodeId))
        .map(strip);
    },
    listNodes: async (vocabularyCode) => {
      await delay();
      return options.nodes
        .filter((node) => node.vocabularyCode === vocabularyCode)
        .map(strip);
    },
  };
}

function load(options: FixtureRuntimeOptions): FixtureState {
  if (options.seed !== undefined) {
    try {
      options.storage?.setItem(
        options.storageKey,
        JSON.stringify(options.seed),
      );
    } catch {
      // ignore
    }
    return options.seed;
  }
  try {
    const raw = options.storage?.getItem(options.storageKey);
    if (raw !== null && raw !== undefined) {
      const parsed = StoredStateSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        return parsed.data;
      }
    }
  } catch {
    // fall through to a fresh journey
  }
  return options.initial();
}
