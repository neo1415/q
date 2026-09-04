import { z } from "zod";

import {
  OnboardingResponseValueSchema,
  OnboardingSessionViewSchema,
  type OnboardingResponseValue,
  type OnboardingSessionView,
  type OnboardingStepPresentation,
  type OnboardingStepProgressStatus,
} from "@capital-q/contracts";
import {
  FOUNDER_DEFINITION_V1,
  FOUNDER_STEPS,
  INSTRUMENT_CODES,
  type FounderRaiseContext,
  type FounderReviewContext,
  type FounderSnapshotContext,
} from "@capital-q/founder-onboarding/definition";

import type { TaxonomyCandidateView } from "../models/presentation";
import { FounderOnboardingClientError } from "./client";
import type { RuntimePort } from "./runtime-port";

/**
 * Development fixture: an in-memory onboarding runtime for Founder
 * Definition v1, speaking the same session-view contract as the API. It
 * evaluates the definition's own branching, keeps state in sessionStorage
 * so refresh and re-entry resume, and never talks to a backend. Its
 * "canonical" side effects are a handful of synthetic facts derived from
 * the answers -- enough to render review and snapshot deterministically.
 *
 * Never composed in production: see `compose.ts` and the web config guard.
 */

export const FIXTURE_ADAPTER_NAME = "FounderOnboardingFixtureClient";
export const FIXTURE_STORAGE_KEY = "cq:dev:founder-onboarding:runtime:v2";

export const FIXTURE_SEEDS = [
  "reset",
  "review",
  "revenue",
  "raise",
  "snapshot",
  "flaky",
] as const;
export type FixtureSeed = (typeof FIXTURE_SEEDS)[number];

const SESSION_ID = "0f1d5c3e-6b7a-4c8d-9e0f-1a2b3c4d5e6f";
const VERSION_ID = "c781b093-67f4-569b-a38d-5ba88bd26d31";
const STARTED_AT = "2026-09-05T09:00:00.000Z";

const StoredStateSchema = z.object({
  version: z.literal(2),
  sessionVersion: z.number().int().min(1),
  status: z.enum(["ACTIVE", "COMPLETED"]),
  currentStepKey: z.string().nullable(),
  responses: z.record(z.string(), OnboardingResponseValueSchema),
  states: z.record(z.string(), z.enum(["IN_PROGRESS", "COMPLETED", "SKIPPED"])),
  objective: z
    .object({ amount: z.string(), currency: z.string(), version: z.number() })
    .nullable(),
  failNextSave: z.boolean(),
});
type StoredState = z.infer<typeof StoredStateSchema>;

// Derived from the definition data so the browser bundle never imports the server-only onboarding package.
type OnboardingStepManifest = (typeof FOUNDER_DEFINITION_V1)["steps"][number];
type BranchExpression = NonNullable<OnboardingStepManifest["branching"]>;

const STEPS = FOUNDER_DEFINITION_V1.steps;

/** A stable, valid UUID per step key for synthetic response rows. */
function syntheticResponseId(stepKey: string): string {
  let hash = 2166136261;
  for (const char of stepKey) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  const hex = hash.toString(16).padStart(8, "0");
  return `${hex}-${hex.slice(0, 4)}-4${hex.slice(1, 4)}-8${hex.slice(4, 7)}-${hex}${hex.slice(0, 4)}`;
}
const STEP_BY_KEY = new Map(STEPS.map((step) => [step.stepKey, step]));

// ---------------------------------------------------------------------------
// Synthetic taxonomy (ids are stable, labels are real vocabulary names)
// ---------------------------------------------------------------------------

const INSURANCE_NODE_ID = "a1b2c3d4-0001-4000-8000-000000000001";
const B2B_SAAS_NODE_ID = "a1b2c3d4-0004-4000-8000-000000000004";

const SYNTHETIC_NODES: readonly (TaxonomyCandidateView & {
  readonly keywords: readonly string[];
})[] = [
  {
    nodeId: INSURANCE_NODE_ID,
    label: "Insurance Technology",
    vocabularyLabel: "Industry",
    keywords: ["insur", "claims", "underwrit"],
  },
  {
    nodeId: "a1b2c3d4-0002-4000-8000-000000000002",
    label: "Financial Services",
    vocabularyLabel: "Industry",
    keywords: ["financ", "bank", "payment", "lend"],
  },
  {
    nodeId: "a1b2c3d4-0003-4000-8000-000000000003",
    label: "Healthcare",
    vocabularyLabel: "Industry",
    keywords: ["health", "clinic", "patient"],
  },
  {
    nodeId: B2B_SAAS_NODE_ID,
    label: "B2B SaaS",
    vocabularyLabel: "Business model",
    keywords: ["saas", "subscription", "software", "automat", "platform"],
  },
  {
    nodeId: "a1b2c3d4-0005-4000-8000-000000000005",
    label: "Marketplace",
    vocabularyLabel: "Business model",
    keywords: ["marketplace", "buyers", "sellers"],
  },
  {
    nodeId: "a1b2c3d4-0006-4000-8000-000000000006",
    label: "Enterprise",
    vocabularyLabel: "Customer type",
    keywords: ["enterprise", "insurer", "corporat", "mid-sized"],
  },
  {
    nodeId: "a1b2c3d4-0007-4000-8000-000000000007",
    label: "Workflow Automation",
    vocabularyLabel: "Product category",
    keywords: ["automat", "workflow", "process"],
  },
];

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

function eligibleSteps(state: StoredState): OnboardingStepManifest[] {
  const visible = new Map<string, OnboardingResponseValue>();
  const eligible: OnboardingStepManifest[] = [];
  for (const step of STEPS) {
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

// ---------------------------------------------------------------------------
// Presentation of a step (mirror of the runtime's safe projection)
// ---------------------------------------------------------------------------

function presentationOf(
  step: OnboardingStepManifest,
): OnboardingStepPresentation {
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
      };
  }
}

// ---------------------------------------------------------------------------
// Contexts (deterministic projections of the answers)
// ---------------------------------------------------------------------------

function option(stepKey: string, key: string | undefined) {
  const step = STEP_BY_KEY.get(stepKey);
  if (key === undefined || step === undefined) return null;
  const c = step.configuration;
  if (c.stepType !== "single_select" && c.stepType !== "multi_select")
    return null;
  const found = c.options.find((o) => o.optionKey === key);
  return found === undefined
    ? null
    : { key: found.optionKey, label: found.label };
}

function single(state: StoredState, key: string) {
  const v = state.responses[key];
  return v?.type === "SINGLE_SELECT" ? v.optionKey : undefined;
}
function multi(state: StoredState, key: string) {
  const v = state.responses[key];
  return v?.type === "MULTI_SELECT" ? v.optionKeys : undefined;
}
function text(state: StoredState, key: string) {
  const v = state.responses[key];
  return v?.type === "TEXT" ? v.text : undefined;
}
function range(state: StoredState, key: string) {
  const v = state.responses[key];
  return v?.type === "RANGE" ? v.value : undefined;
}
function refs(state: StoredState, key: string) {
  const v = state.responses[key];
  return v?.type === "RESOURCE_REFERENCE" ? v.resourceIds : [];
}

const labelled = (stepKey: string, keys: readonly string[] | undefined) =>
  keys === undefined
    ? null
    : keys.flatMap((key) => {
        const item = option(stepKey, key);
        return item === null ? [] : [item];
      });

function website(state: StoredState) {
  const raw = text(state, FOUNDER_STEPS.website);
  if (raw === undefined) return null;
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function categories(state: StoredState) {
  return refs(state, FOUNDER_STEPS.categories).flatMap((id) => {
    const node = SYNTHETIC_NODES.find((n) => n.nodeId === id);
    return node === undefined
      ? []
      : [
          {
            nodeId: id,
            label: node.label,
            vocabularyCode: node.vocabularyLabel,
          },
        ];
  });
}

function reviewContext(state: StoredState): FounderReviewContext {
  return {
    kind: "founder.review",
    intent: option(FOUNDER_STEPS.intent, single(state, FOUNDER_STEPS.intent)),
    company: {
      name: text(state, FOUNDER_STEPS.companyName) ?? "",
      websiteUrl: website(state),
      country: option(
        FOUNDER_STEPS.country,
        single(state, FOUNDER_STEPS.country),
      ),
      stage: option(FOUNDER_STEPS.stage, single(state, FOUNDER_STEPS.stage)),
      description: text(state, FOUNDER_STEPS.description) ?? null,
    },
    categories: categories(state),
    materials: labelled(
      FOUNDER_STEPS.materials,
      multi(state, FOUNDER_STEPS.materials),
    ),
  };
}

function raiseContext(state: StoredState): FounderRaiseContext {
  return {
    kind: "founder.raise",
    mode: state.objective === null ? "create" : "recalibrate",
    currency: (single(state, FOUNDER_STEPS.currency) ?? "usd").toUpperCase(),
    amount: range(state, FOUNDER_STEPS.targetAmount) ?? "0",
    instrument: option(
      FOUNDER_STEPS.instrument,
      single(state, FOUNDER_STEPS.instrument),
    ),
    timeframe: option(
      FOUNDER_STEPS.timeframe,
      single(state, FOUNDER_STEPS.timeframe),
    ),
    useOfFunds:
      labelled(
        FOUNDER_STEPS.useOfFunds,
        multi(state, FOUNDER_STEPS.useOfFunds),
      ) ?? [],
    existing: state.objective,
  };
}

function snapshotContext(state: StoredState): FounderSnapshotContext {
  const review = reviewContext(state);
  const founders = range(state, FOUNDER_STEPS.founderCount);
  const founderCount =
    founders === undefined ? null : Number.parseInt(founders, 10);
  const fullTime = single(state, FOUNDER_STEPS.fullTime);
  const teamSize = range(state, FOUNDER_STEPS.teamSize);
  const instrument = single(state, FOUNDER_STEPS.instrument);
  const useOfFunds = labelled(
    FOUNDER_STEPS.useOfFunds,
    multi(state, FOUNDER_STEPS.useOfFunds),
  );
  const missing: string[] = [];
  if (review.company.description === null) missing.push("description");
  if (review.categories.length === 0) missing.push("categories");
  if (review.company.stage === null) missing.push("stage");
  if (review.materials === null || review.materials.length === 0)
    missing.push("materials");
  if (founderCount === null) missing.push("founder_count");
  if (teamSize === undefined) missing.push("team_size");
  if (state.objective === null) missing.push("capital_objective");
  return {
    kind: "founder.snapshot",
    company: { ...review.company, categories: review.categories },
    team: {
      role: option(
        FOUNDER_STEPS.founderRole,
        single(state, FOUNDER_STEPS.founderRole),
      ),
      founderCount,
      fullTimeFounderCount:
        fullTime === "none" ? 0 : fullTime === "all" ? founderCount : null,
      teamSize: teamSize === undefined ? null : Number.parseInt(teamSize, 10),
      functions:
        labelled(
          FOUNDER_STEPS.functions,
          multi(state, FOUNDER_STEPS.functions),
        ) ?? [],
    },
    traction: {
      signal: option(FOUNDER_STEPS.signal, single(state, FOUNDER_STEPS.signal)),
      pilots: range(state, FOUNDER_STEPS.pilots) ?? null,
      revenueStatus: option(
        FOUNDER_STEPS.revenueStatus,
        single(state, FOUNDER_STEPS.revenueStatus),
      ),
      customers: range(state, FOUNDER_STEPS.customers) ?? null,
      growth: option(FOUNDER_STEPS.growth, single(state, FOUNDER_STEPS.growth)),
    },
    raise:
      state.objective === null
        ? {
            status: "none",
            raising: option(
              FOUNDER_STEPS.raising,
              single(state, FOUNDER_STEPS.raising),
            ),
          }
        : {
            status: "active",
            amount: state.objective.amount,
            currency: state.objective.currency,
            instrumentCode:
              instrument === undefined
                ? null
                : (INSTRUMENT_CODES[instrument] ?? null),
            useOfFundsSummary:
              useOfFunds === null || useOfFunds.length === 0
                ? null
                : useOfFunds.map((u) => u.label).join("; "),
            targetStage: single(state, FOUNDER_STEPS.stage) ?? null,
          },
    materials: review.materials,
    followUpRecorded: text(state, FOUNDER_STEPS.followUp) !== undefined,
    missing,
  };
}

function contextFor(step: OnboardingStepManifest, state: StoredState) {
  const c = step.configuration;
  if (c.stepType !== "confirmation" || c.contextKey === undefined)
    return undefined;
  switch (c.contextKey) {
    case "founder.review":
      return reviewContext(state);
    case "founder.raise":
      return raiseContext(state);
    case "founder.snapshot":
      return snapshotContext(state);
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

const S = FOUNDER_STEPS;
const single_ = (optionKey: string): OnboardingResponseValue => ({
  type: "SINGLE_SELECT",
  optionKey,
});
const text_ = (value: string): OnboardingResponseValue => ({
  type: "TEXT",
  text: value,
});
const range_ = (value: string): OnboardingResponseValue => ({
  type: "RANGE",
  value,
});
const multi_ = (optionKeys: string[]): OnboardingResponseValue => ({
  type: "MULTI_SELECT",
  optionKeys,
});
const confirm_: OnboardingResponseValue = {
  type: "CONFIRMATION",
  confirmed: true,
};

function seedState(seed: FixtureSeed): StoredState {
  const answered: [string, OnboardingResponseValue][] = [];
  const skipped: string[] = [];
  const upTo = (stage: string, through: "F2" | "F4" | "F5" | "F7") => {
    answered.push(
      [S.intent, single_("raising_now")],
      [S.companyName, text_("NexaRail Technologies")],
      [S.website, text_("nexarail.example")],
      [S.country, single_("ng")],
      [S.stage, single_(stage)],
      [
        S.description,
        text_("We automate claims handling for mid-sized insurers."),
      ],
      [
        S.categories,
        {
          type: "RESOURCE_REFERENCE",
          resourceType: "TAXONOMY_NODE",
          resourceIds: [INSURANCE_NODE_ID, B2B_SAAS_NODE_ID],
        },
      ],
      [S.materials, multi_(["pitch_deck"])],
    );
    if (through === "F2") return;
    answered.push(
      [S.review, confirm_],
      [S.founderRole, single_("ceo")],
      [S.founderCount, range_("2")],
      [S.fullTime, single_("all")],
      [S.teamSize, range_("8")],
      [S.functions, multi_(["product", "engineering"])],
    );
    if (through === "F4") return;
    if (stage === "seed") {
      answered.push([S.signal, single_("pilots")], [S.pilots, range_("4")]);
    } else {
      answered.push(
        [S.revenueStatus, single_("recurring")],
        [S.customers, range_("31")],
      );
      skipped.push(S.growth);
    }
    if (through === "F5") return;
    answered.push(
      [S.raising, single_("active")],
      [S.currency, single_("usd")],
      [S.targetAmount, range_("2500000")],
      [S.instrument, single_("safe")],
      [S.useOfFunds, multi_(["product"])],
      [S.raiseConfirm, confirm_],
    );
    skipped.push(S.timeframe, S.followUp);
  };
  switch (seed) {
    case "reset":
    case "flaky":
      break;
    case "review":
      upTo("seed", "F2");
      break;
    case "revenue":
      upTo("series_a", "F4");
      break;
    case "raise":
      upTo("seed", "F5");
      break;
    case "snapshot":
      upTo("seed", "F7");
      break;
  }
  const responses = Object.fromEntries(answered);
  const states: StoredState["states"] = {};
  for (const [key] of answered) states[key] = "COMPLETED";
  for (const key of skipped) states[key] = "SKIPPED";
  const state: StoredState = {
    version: 2,
    sessionVersion: 1 + answered.length + skipped.length,
    status: "ACTIVE",
    currentStepKey: S.intent,
    responses,
    states,
    objective:
      responses[S.raiseConfirm] === undefined
        ? null
        : { amount: "2500000", currency: "USD", version: 1 },
    failNextSave: seed === "flaky",
  };
  const next = nextIncomplete(state, null);
  state.currentStepKey = next ?? S.intent;
  states[state.currentStepKey] ??= "IN_PROGRESS";
  return state;
}

function nextIncomplete(
  state: StoredState,
  afterKey: string | null,
): string | null {
  const eligible = eligibleSteps(state);
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
// The port
// ---------------------------------------------------------------------------

export function createFixtureRuntimePort(options: {
  readonly storage: Storage | null;
  readonly seed?: FixtureSeed | undefined;
}): RuntimePort {
  let state = load(options.storage, options.seed);

  // Another tab (or client) may have written since: adopt the stored state
  // when it is newer, so stale versions conflict exactly as they would on
  // the real API.
  function sync() {
    try {
      const raw = options.storage?.getItem(FIXTURE_STORAGE_KEY);
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

  function persist(next: StoredState) {
    state = next;
    try {
      options.storage?.setItem(FIXTURE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage may be unavailable (private mode); the in-memory copy still works.
    }
  }

  function view(): OnboardingSessionView {
    const eligible = eligibleSteps(state);
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
    const raw: OnboardingSessionView = {
      session: {
        id: SESSION_ID,
        journeyType: "founder",
        definitionVersionId: VERSION_ID,
        definitionVersion: 1,
        status: state.status,
        subject:
          state.responses[S.companyName] === undefined
            ? null
            : { type: "COMPANY", id: "b2c3d4e5-0000-4000-8000-000000000010" },
        currentStepKey: state.currentStepKey,
        version: state.sessionVersion,
        startedAt: STARTED_AT,
        lastActivityAt: STARTED_AT,
        completedAt: state.status === "COMPLETED" ? STARTED_AT : null,
      },
      phases: FOUNDER_DEFINITION_V1.schema.phases,
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
              ...(contextFor(current, state) === undefined
                ? {}
                : { context: contextFor(current, state) }),
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
    new FounderOnboardingClientError("REJECTED", message);

  function requireVersion(expected: number) {
    if (expected !== state.sessionVersion) {
      throw new FounderOnboardingClientError(
        "CONFLICT",
        "This step changed in another tab. Showing the latest.",
      );
    }
  }

  function requireActive() {
    if (state.status !== "ACTIVE") {
      throw reject("Founder setup is already complete.");
    }
  }

  function eligibleStep(stepKey: string): OnboardingStepManifest {
    const step = eligibleSteps(state).find((s) => s.stepKey === stepKey);
    if (step === undefined) {
      throw reject("That question isn't part of your current path.");
    }
    return step;
  }

  function expectedType(
    step: OnboardingStepManifest,
  ): OnboardingResponseValue["type"] {
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

  const delay = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    sync();
  };

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
        throw new FounderOnboardingClientError(
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
      const next: StoredState = {
        ...state,
        sessionVersion: state.sessionVersion + 1,
        responses: { ...state.responses, [stepKey]: value },
        states: { ...state.states, [stepKey]: "COMPLETED" },
        objective:
          stepKey === S.raiseConfirm &&
          value.type === "CONFIRMATION" &&
          value.confirmed
            ? {
                amount: range(state, S.targetAmount) ?? "0",
                currency: (single(state, S.currency) ?? "usd").toUpperCase(),
                version: (state.objective?.version ?? 0) + 1,
              }
            : state.objective,
      };
      const following = nextIncomplete(next, stepKey);
      next.currentStepKey = following ?? stepKey;
      if (following !== null) {
        next.states = {
          ...next.states,
          [following]: next.states[following] ?? "IN_PROGRESS",
        };
      }
      persist(next);
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
      const next: StoredState = {
        ...state,
        sessionVersion: state.sessionVersion + 1,
        states: { ...state.states, [stepKey]: "SKIPPED" },
      };
      const following = nextIncomplete(next, stepKey);
      next.currentStepKey = following ?? stepKey;
      if (following !== null) {
        next.states = {
          ...next.states,
          [following]: next.states[following] ?? "IN_PROGRESS",
        };
      }
      persist(next);
      return view();
    },
    navigate: async ({ expectedSessionVersion, targetStepKey }) => {
      await delay();
      requireActive();
      requireVersion(expectedSessionVersion);
      const eligible = eligibleSteps(state);
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
      const incomplete = eligibleSteps(state).some(
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
      return SYNTHETIC_NODES.filter((node) =>
        node.keywords.some((keyword) => haystack.includes(keyword)),
      ).map(({ keywords: _keywords, ...candidate }) => ({
        ...candidate,
        reason: "Matches words in your description.",
      }));
    },
    describeNodes: async (ids) => {
      await delay();
      return SYNTHETIC_NODES.filter((node) => ids.includes(node.nodeId)).map(
        ({ keywords: _keywords, ...node }) => node,
      );
    },
  };
}

function load(
  storage: Storage | null,
  seed: FixtureSeed | undefined,
): StoredState {
  if (seed !== undefined) {
    const seeded = seedState(seed);
    try {
      storage?.setItem(FIXTURE_STORAGE_KEY, JSON.stringify(seeded));
    } catch {
      // ignore
    }
    return seeded;
  }
  try {
    const raw = storage?.getItem(FIXTURE_STORAGE_KEY);
    if (raw !== null && raw !== undefined) {
      const parsed = StoredStateSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        return parsed.data;
      }
    }
  } catch {
    // fall through to a fresh journey
  }
  return seedState("reset");
}
