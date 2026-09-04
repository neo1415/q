import { describe, expect, it } from "vitest";

import {
  ContractValidationError,
  createEventRegistry,
  OnboardingSessionViewSchema,
  StartOnboardingSessionRequestSchema,
  SubmitOnboardingResponseRequestSchema,
} from "@capital-q/contracts";

import {
  computeActivePath,
  computeProgress,
  nextIncompleteStep,
  pathChanges,
  previousVisitedStep,
} from "../src/runtime/path.js";
import {
  evaluateBranch,
  referencedStepKeys,
  scalarOf,
} from "../src/runtime/branch.js";
import {
  compareDecimal,
  validateOnboardingResponse,
} from "../src/runtime/validate-response.js";
import { validateOnboardingManifest } from "../src/definitions/validate.js";
import { OnboardingDefinitionInvalidError } from "../src/domain/errors.js";
import {
  hashOnboardingIdempotencyKey,
  hashOnboardingRequest,
} from "../src/domain/idempotency.js";
import {
  ONBOARDING_EVENTS,
  responseCommittedEvent,
  sessionStartedEvent,
} from "../src/events/index.js";
import { toSessionView } from "../src/application/view.js";
import type {
  OnboardingResponse,
  OnboardingSession,
  OnboardingStepDefinition,
  OnboardingStepState,
  PublishedOnboardingDefinition,
} from "../src/contracts/index.js";
import { SYNTHETIC_FOUNDER_MANIFEST } from "./synthetic-manifest.js";

/**
 * Deterministic runtime behaviour without a database: manifest validation,
 * the branch DSL, path/progress computation, per-type response validation,
 * idempotency hashing, event privacy and the safe session projection.
 */

const manifest = validateOnboardingManifest(SYNTHETIC_FOUNDER_MANIFEST);

function withSteps(steps: readonly unknown[]): unknown {
  return { ...SYNTHETIC_FOUNDER_MANIFEST, steps };
}

const step = (key: string) => {
  const found = manifest.steps.find((s) => s.stepKey === key);
  if (found === undefined) {
    throw new Error(`missing step ${key}`);
  }
  return found;
};

const VERSION_ID = "00000000-0000-4000-8000-0000000000d1";

function published(): PublishedOnboardingDefinition {
  return {
    version: {
      id: VERSION_ID as never,
      definitionId: "00000000-0000-4000-8000-0000000000d0" as never,
      journeyType: "founder",
      version: 1,
      schema: manifest.schema,
      manifestHash: "a".repeat(64),
      publishedAt: "2026-09-04T00:00:00.000Z",
    },
    steps: manifest.steps.map((s, i) => ({
      id: `00000000-0000-4000-8000-0000000000a${i}` as never,
      definitionVersionId: VERSION_ID as never,
      stepKey: s.stepKey,
      sequenceOrder: s.sequenceOrder,
      stepType: s.configuration.stepType,
      required: s.required,
      configuration: s.configuration,
      branching: s.branching,
      writesTo: s.writesTo,
    })),
  };
}

const definition = published();
const defStep = (key: string): OnboardingStepDefinition => {
  const found = definition.steps.find((s) => s.stepKey === key);
  if (found === undefined) {
    throw new Error(`missing step ${key}`);
  }
  return found;
};

function response(
  stepKey: string,
  value: OnboardingResponse["value"],
): OnboardingResponse {
  return {
    id: `00000000-0000-4000-8000-00000000f${String(stepKey.length).padStart(2, "0")}${stepKey.charCodeAt(0) % 10}` as never,
    sessionId: "00000000-0000-4000-8000-0000000000e1" as never,
    stepKey,
    responseType: value.type,
    value,
    rawText: value.type === "TEXT" ? value.text : null,
    sourceModality: value.type === "TEXT" ? "TYPED_TEXT" : "SELECTION",
    createdAt: "2026-09-04T00:00:00.000Z",
    supersededByResponseId: null,
  };
}

function state(
  stepKey: string,
  status: OnboardingStepState["status"],
): OnboardingStepState {
  return {
    sessionId: "00000000-0000-4000-8000-0000000000e1" as never,
    stepKey,
    status,
    enteredAt: "2026-09-04T00:00:00.000Z",
    completedAt: status === "COMPLETED" ? "2026-09-04T00:00:00.000Z" : null,
    skippedAt: status === "SKIPPED" ? "2026-09-04T00:00:00.000Z" : null,
  };
}

const session = (
  currentStepKey: string | null,
  status: OnboardingSession["status"] = "ACTIVE",
): OnboardingSession => ({
  id: "00000000-0000-4000-8000-0000000000e1" as never,
  tenantId: null,
  userId: "b0000000-0000-4000-8000-000000000001" as never,
  organisationId: null,
  journeyType: "founder",
  definitionVersionId: VERSION_ID as never,
  subject: null,
  status,
  currentStepKey,
  startedAt: "2026-09-04T00:00:00.000Z",
  lastActivityAt: "2026-09-04T00:00:00.000Z",
  completedAt: null,
  version: 1,
});

describe("manifest validation (§203, §48-49)", () => {
  it("accepts the synthetic journey and orders its steps", () => {
    expect(manifest.steps.map((s) => s.stepKey)).toEqual([
      "intent",
      "sectors",
      "name",
      "raise_amount",
      "notes",
      "docs",
      "confirm",
    ]);
    expect(manifest.schema.runtime).toEqual({
      subjectType: "COMPANY",
      allowUnboundStart: true,
    });
  });

  const expectInvalid = (input: unknown, pattern: RegExp) => {
    let caught: unknown;
    try {
      validateOnboardingManifest(input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OnboardingDefinitionInvalidError);
    expect(
      (caught as OnboardingDefinitionInvalidError).reasons.join(" | "),
    ).toMatch(pattern);
  };

  it("rejects duplicate keys, duplicate sequence, unknown phases and empty journeys", () => {
    expectInvalid(
      withSteps([step("intent"), { ...step("sectors"), stepKey: "intent" }]),
      /duplicate step key/,
    );
    expectInvalid(
      withSteps([step("intent"), { ...step("sectors"), sequenceOrder: 0 }]),
      /duplicate sequence/,
    );
    expectInvalid(
      withSteps([
        {
          ...step("intent"),
          configuration: { ...step("intent").configuration, phaseKey: "nope" },
        },
      ]),
      /unknown phase/,
    );
    expectInvalid(withSteps([]), /steps/);
  });

  it("rejects branch references to unknown, same or later steps and non-option values", () => {
    expectInvalid(
      withSteps([
        step("intent"),
        { ...step("sectors"), branching: { op: "EXISTS", stepKey: "ghost" } },
      ]),
      /unknown step ghost/,
    );
    expectInvalid(
      withSteps([
        step("intent"),
        { ...step("sectors"), branching: { op: "EXISTS", stepKey: "name" } },
        step("name"),
      ]),
      /not an earlier step/,
    );
    expectInvalid(
      withSteps([
        step("intent"),
        {
          ...step("sectors"),
          branching: { op: "EQUALS", stepKey: "intent", value: "maybe" },
        },
      ]),
      /not one of its options/,
    );
    expectInvalid(
      withSteps([
        { ...step("intent"), branching: { op: "EXISTS", stepKey: "intent" } },
      ]),
      /must not branch/,
    );
  });

  it("rejects incoherent configuration and malformed write targets", () => {
    expectInvalid(
      withSteps([
        step("intent"),
        {
          ...step("sectors"),
          configuration: {
            ...step("sectors").configuration,
            minSelections: 5,
            maxSelections: 2,
          },
        },
      ]),
      /minSelections exceeds maxSelections/,
    );
    expectInvalid(
      withSteps([
        step("intent"),
        {
          ...step("raise_amount"),
          branching: null,
          configuration: {
            ...step("raise_amount").configuration,
            min: "10",
            max: "5",
          },
        },
      ]),
      /range min must be below max/,
    );
    expectInvalid(
      withSteps([
        { ...step("intent"), writesTo: [{ table: "core.companies" }] },
      ]),
      /writesTo/,
    );
    expectInvalid(
      withSteps([
        {
          ...step("intent"),
          configuration: {
            ...step("intent").configuration,
            className: "text-lg",
          },
        },
      ]),
      /configuration/,
    );
    expectInvalid(
      withSteps([
        { ...step("intent"), branching: { op: "EVAL", code: "true" } },
      ]),
      /branching/,
    );
  });
});

describe("branch DSL (§42-47, §255)", () => {
  const snapshot = new Map<string, OnboardingResponse["value"]>([
    ["intent", { type: "SINGLE_SELECT", optionKey: "raising_now" }],
    ["sectors", { type: "MULTI_SELECT", optionKeys: ["fintech", "health"] }],
    ["raise_amount", { type: "RANGE", value: "5000000" }],
    ["confirm", { type: "CONFIRMATION", confirmed: true }],
  ]);

  it("evaluates the closed operator set deterministically over prior responses only", () => {
    expect(evaluateBranch({ op: "EXISTS", stepKey: "intent" }, snapshot)).toBe(
      true,
    );
    expect(evaluateBranch({ op: "EXISTS", stepKey: "notes" }, snapshot)).toBe(
      false,
    );
    expect(
      evaluateBranch(
        { op: "EQUALS", stepKey: "intent", value: "raising_now" },
        snapshot,
      ),
    ).toBe(true);
    expect(
      evaluateBranch(
        { op: "EQUALS", stepKey: "raise_amount", value: 5000000 },
        snapshot,
      ),
    ).toBe(true);
    expect(
      evaluateBranch(
        { op: "EQUALS", stepKey: "confirm", value: true },
        snapshot,
      ),
    ).toBe(true);
    expect(
      evaluateBranch(
        { op: "IN", stepKey: "intent", values: ["exploring", "raising_now"] },
        snapshot,
      ),
    ).toBe(true);
    expect(
      evaluateBranch(
        { op: "CONTAINS", stepKey: "sectors", value: "health" },
        snapshot,
      ),
    ).toBe(true);
    expect(
      evaluateBranch(
        { op: "CONTAINS", stepKey: "sectors", value: "energy" },
        snapshot,
      ),
    ).toBe(false);
    expect(
      evaluateBranch(
        {
          op: "ALL",
          expressions: [
            { op: "EXISTS", stepKey: "intent" },
            { op: "NOT", expression: { op: "EXISTS", stepKey: "notes" } },
          ],
        },
        snapshot,
      ),
    ).toBe(true);
    expect(
      evaluateBranch(
        {
          op: "ANY",
          expressions: [
            { op: "EXISTS", stepKey: "notes" },
            { op: "EXISTS", stepKey: "docs" },
          ],
        },
        snapshot,
      ),
    ).toBe(false);
    expect(
      referencedStepKeys({
        op: "ALL",
        expressions: [
          { op: "EXISTS", stepKey: "a" },
          { op: "NOT", expression: { op: "IN", stepKey: "b", values: [1] } },
        ],
      }),
    ).toEqual(["a", "b"]);
    expect(scalarOf({ type: "MULTI_SELECT", optionKeys: [] })).toBeNull();
  });
});

describe("path and progress (§46-47, §86-90)", () => {
  it("omits ineligible steps, finds the next incomplete step and reports truthful progress", () => {
    const responses = new Map([
      [
        "intent",
        response("intent", { type: "SINGLE_SELECT", optionKey: "exploring" }),
      ],
    ]);
    const path = computeActivePath(definition.steps, responses);
    expect(path.eligibleKeys.has("raise_amount")).toBe(false);
    expect(path.eligible.map((s) => s.stepKey)).toEqual([
      "intent",
      "sectors",
      "name",
      "notes",
      "docs",
      "confirm",
    ]);
    const states = new Map([
      ["intent", state("intent", "COMPLETED")],
      ["sectors", state("sectors", "IN_PROGRESS")],
    ]);
    expect(nextIncompleteStep(path, states)?.stepKey).toBe("sectors");
    const progress = computeProgress(session("sectors"), path, states);
    expect(progress).toMatchObject({
      currentStepKey: "sectors",
      currentPhaseKey: "company",
      eligibleStepCount: 6,
      completedEligibleStepCount: 1,
      canGoBack: true,
      canSkipCurrentStep: false,
      canComplete: false,
    });
    expect(progress.eligibleSteps.map((s) => s.status)).toEqual([
      "COMPLETED",
      "IN_PROGRESS",
      "PENDING",
      "PENDING",
      "PENDING",
      "PENDING",
    ]);
  });

  it("a revised answer moves a step off the path and the delta names it; history is untouched", () => {
    const before = computeActivePath(
      definition.steps,
      new Map([
        [
          "intent",
          response("intent", {
            type: "SINGLE_SELECT",
            optionKey: "raising_now",
          }),
        ],
      ]),
    );
    const after = computeActivePath(
      definition.steps,
      new Map([
        [
          "intent",
          response("intent", { type: "SINGLE_SELECT", optionKey: "exploring" }),
        ],
      ]),
    );
    expect(pathChanges(before.eligibleKeys, after.eligibleKeys)).toEqual({
      becameEligibleStepKeys: [],
      becameIneligibleStepKeys: ["raise_amount"],
    });
  });

  it("back targets only earlier visited eligible steps", () => {
    const path = computeActivePath(definition.steps, new Map());
    const states = new Map([
      ["intent", state("intent", "COMPLETED")],
      ["sectors", state("sectors", "COMPLETED")],
      ["name", state("name", "IN_PROGRESS")],
    ]);
    expect(previousVisitedStep(path, states, "name")?.stepKey).toBe("sectors");
    expect(previousVisitedStep(path, states, "intent")).toBeNull();
    expect(previousVisitedStep(path, states, null)).toBeNull();
  });
});

describe("response validation per step type (§40, §96-99, §210)", () => {
  const invalid = (key: string, input: unknown) =>
    expect(() => validateOnboardingResponse(defStep(key), input)).toThrow(
      ContractValidationError,
    );

  it("single select", () => {
    expect(
      validateOnboardingResponse(defStep("intent"), {
        value: { type: "SINGLE_SELECT", optionKey: "raising_now" },
      }),
    ).toMatchObject({
      responseType: "SINGLE_SELECT",
      rawText: null,
      sourceModality: "SELECTION",
    });
    invalid("intent", { value: { type: "SINGLE_SELECT", optionKey: "nope" } });
    invalid("intent", { value: { type: "TEXT", text: "raising" } });
    invalid("intent", {
      value: { type: "SINGLE_SELECT", optionKey: "raising_now", extra: 1 },
    });
    invalid("intent", {
      value: { type: "SINGLE_SELECT", optionKey: "raising_now" },
      sourceModality: "VOICE_TRANSCRIPT",
    });
  });

  it("multi select", () => {
    expect(
      validateOnboardingResponse(defStep("sectors"), {
        value: { type: "MULTI_SELECT", optionKeys: ["fintech", "health"] },
      }).responseType,
    ).toBe("MULTI_SELECT");
    invalid("sectors", { value: { type: "MULTI_SELECT", optionKeys: [] } });
    invalid("sectors", {
      value: {
        type: "MULTI_SELECT",
        optionKeys: ["fintech", "health", "energy"],
      },
    });
    invalid("sectors", {
      value: { type: "MULTI_SELECT", optionKeys: ["fintech", "fintech"] },
    });
    invalid("sectors", {
      value: { type: "MULTI_SELECT", optionKeys: ["fintech", "none"] },
    });
    invalid("sectors", {
      value: { type: "MULTI_SELECT", optionKeys: ["space"] },
    });
  });

  it("range uses exact decimals", () => {
    expect(
      validateOnboardingResponse(defStep("raise_amount"), {
        value: { type: "RANGE", value: "250000.50" },
      }).value,
    ).toEqual({ type: "RANGE", value: "250000.50" });
    invalid("raise_amount", { value: { type: "RANGE", value: "-1" } });
    invalid("raise_amount", { value: { type: "RANGE", value: "100000001" } });
    invalid("raise_amount", { value: { type: "RANGE", value: "1e6" } });
    expect(compareDecimal("10.50", "10.5")).toBe(0);
    expect(compareDecimal("0.1", "0.10000001")).toBe(-1);
    expect(compareDecimal("-5", "-4.9")).toBe(-1);
  });

  it("text keeps the raw text and the declared modality", () => {
    const validated = validateOnboardingResponse(defStep("name"), {
      value: { type: "TEXT", text: "  Alpha Rails " },
      sourceModality: "TYPED_TEXT",
    });
    expect(validated).toMatchObject({
      responseType: "TEXT",
      rawText: "  Alpha Rails ",
      sourceModality: "TYPED_TEXT",
    });
    invalid("name", { value: { type: "TEXT", text: "x".repeat(121) } });
    invalid("name", { value: { type: "TEXT", text: "   " } });
    invalid("name", {
      value: { type: "TEXT", text: "Alpha" },
      sourceModality: "DOCUMENT_REFERENCE",
    });
    expect(
      validateOnboardingResponse(defStep("notes"), {
        value: { type: "TEXT", text: "voice" },
        sourceModality: "VOICE_TRANSCRIPT",
      }).sourceModality,
    ).toBe("VOICE_TRANSCRIPT");
  });

  it("document references and confirmations", () => {
    expect(
      validateOnboardingResponse(defStep("docs"), {
        value: {
          type: "RESOURCE_REFERENCE",
          resourceType: "EVIDENCE_DOCUMENT",
          resourceIds: ["00000000-0000-4000-8000-000000000001"],
        },
      }).sourceModality,
    ).toBe("DOCUMENT_REFERENCE");
    invalid("docs", {
      value: {
        type: "RESOURCE_REFERENCE",
        resourceType: "TAXONOMY_NODE",
        resourceIds: ["00000000-0000-4000-8000-000000000001"],
      },
    });
    invalid("docs", {
      value: {
        type: "RESOURCE_REFERENCE",
        resourceType: "EVIDENCE_DOCUMENT",
        resourceIds: ["/tmp/deck.pdf"],
      },
    });
    expect(
      validateOnboardingResponse(defStep("confirm"), {
        value: { type: "CONFIRMATION", confirmed: true },
      }).responseType,
    ).toBe("CONFIRMATION");
    invalid("confirm", { value: { type: "CONFIRMATION", confirmed: false } });
    invalid("confirm", { value: { type: "CONFIRMATION", confirmed: "yes" } });
  });

  it("the runtime overrides the modality for suggestion resolution", () => {
    expect(
      validateOnboardingResponse(
        defStep("intent"),
        { value: { type: "SINGLE_SELECT", optionKey: "exploring" } },
        { sourceModality: "SUGGESTION_ACCEPT" },
      ).sourceModality,
    ).toBe("SUGGESTION_ACCEPT");
  });
});

describe("contracts, idempotency, events and projection (§123, §125, §128, §148-155)", () => {
  it("clients cannot name tenant, organisation, user or definition version", () => {
    for (const bad of [
      { journeyType: "founder", tenantId: "x" },
      { journeyType: "founder", definitionVersionId: VERSION_ID },
      { journeyType: "founder", userId: "x" },
      { journeyType: "admin" },
      {
        journeyType: "founder",
        subject: { type: "COMPANY", id: "not-a-uuid" },
      },
    ]) {
      expect(
        StartOnboardingSessionRequestSchema.safeParse(bad).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
    expect(
      SubmitOnboardingResponseRequestSchema.safeParse({
        stepKey: "intent",
        response: { value: { type: "SINGLE_SELECT", optionKey: "x" } },
        expectedSessionVersion: 0,
      }).success,
    ).toBe(false);
    expect(
      SubmitOnboardingResponseRequestSchema.safeParse({
        stepKey: "intent",
        response: {
          value: { type: "SINGLE_SELECT", optionKey: "x" },
          sourceModality: "SUGGESTION_ACCEPT",
        },
        expectedSessionVersion: 1,
      }).success,
    ).toBe(false);
  });

  it("hashes keys per operation and requests canonically", () => {
    expect(hashOnboardingIdempotencyKey("submit", "k")).not.toBe(
      hashOnboardingIdempotencyKey("skip", "k"),
    );
    expect(
      hashOnboardingRequest({ b: 1, a: [2, { d: 1, c: undefined }] }),
    ).toBe(hashOnboardingRequest({ a: [2, { d: 1 }], b: 1 }));
  });

  it("registers five runtime events whose payloads carry identifiers only", () => {
    const registry = createEventRegistry([...ONBOARDING_EVENTS]);
    expect(
      ONBOARDING_EVENTS.map((e) => `${e.name}@${e.version}:${e.sensitivity}`),
    ).toEqual([
      "onboarding.session.started@1:CONFIDENTIAL",
      "onboarding.response.committed@1:CONFIDENTIAL",
      "onboarding.step.skipped@1:CONFIDENTIAL",
      "onboarding.session.completed@1:CONFIDENTIAL",
      "onboarding.suggestion.resolved@1:CONFIDENTIAL",
    ]);
    const started = sessionStartedEvent({
      session: session("intent"),
      correlationId: "cor_123e4567-e89b-12d3-a456-426614174000",
    });
    expect(registry.parse(started).ok).toBe(true);
    expect(started.tenantId).toBeUndefined();
    const committed = responseCommittedEvent({
      session: session("intent"),
      correlationId: "cor_123e4567-e89b-12d3-a456-426614174000",
      stepKey: "intent",
      responseId: "00000000-0000-4000-8000-0000000000f1",
    });
    expect(registry.parse(committed).ok).toBe(true);
    expect(
      registry.parse({
        ...committed,
        data: { ...committed.data, value: "PRIVATE" },
      }).ok,
    ).toBe(false);
  });

  it("the session view carries no write targets, branching or handler keys", () => {
    const responses = new Map([
      [
        "intent",
        response("intent", { type: "SINGLE_SELECT", optionKey: "raising_now" }),
      ],
    ]);
    const view = toSessionView({
      session: session("sectors"),
      definition,
      stepsByKey: new Map(definition.steps.map((s) => [s.stepKey, s])),
      states: new Map([
        ["intent", state("intent", "COMPLETED")],
        ["sectors", state("sectors", "IN_PROGRESS")],
      ]),
      currentResponses: responses,
      pendingSuggestions: [],
      path: computeActivePath(definition.steps, responses),
    });
    expect(OnboardingSessionViewSchema.safeParse(view).success).toBe(true);
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain("writesTo");
    expect(serialised).not.toContain("targetKey");
    expect(serialised).not.toContain("branching");
    expect(view.currentStep).toMatchObject({
      stepKey: "sectors",
      stepType: "multi_select",
      required: true,
      phaseKey: "company",
    });
    expect(view.progress.eligibleSteps.map((s) => s.stepKey)).toContain(
      "raise_amount",
    );
  });
});
