import type { OnboardingDefinitionManifest } from "../src/definitions/schema.js";

/**
 * A synthetic, test-only journey exercising every step type, a phase set,
 * a branch, an optional step and a semantic write target. It is not the
 * Founder journey (CQ-ONB-002) and is never published by a migration.
 */

export const TEST_WRITE_TARGET = "test.echo" as const;

export const SYNTHETIC_FOUNDER_MANIFEST: OnboardingDefinitionManifest = {
  journeyType: "founder",
  name: "Synthetic founder journey",
  version: 1,
  schema: {
    schemaVersion: 1,
    phases: [
      { phaseKey: "company", label: "Company" },
      { phaseKey: "raise", label: "Raise" },
      { phaseKey: "review", label: "Review" },
    ],
    runtime: { subjectType: "COMPANY", allowUnboundStart: true },
  },
  steps: [
    {
      stepKey: "intent",
      sequenceOrder: 0,
      required: true,
      branching: null,
      writesTo: [],
      configuration: {
        stepType: "single_select",
        prompt: "Are you raising right now?",
        phaseKey: "company",
        options: [
          { optionKey: "raising_now", label: "I'm raising now" },
          { optionKey: "exploring", label: "Just exploring" },
        ],
      },
    },
    {
      stepKey: "sectors",
      sequenceOrder: 1,
      required: true,
      branching: null,
      writesTo: [],
      configuration: {
        stepType: "multi_select",
        prompt: "Which sectors?",
        phaseKey: "company",
        options: [
          { optionKey: "fintech", label: "Fintech" },
          { optionKey: "health", label: "Health" },
          { optionKey: "energy", label: "Energy" },
          { optionKey: "none", label: "None of these" },
        ],
        minSelections: 1,
        maxSelections: 2,
        exclusiveOptionKeys: ["none"],
      },
    },
    {
      stepKey: "name",
      sequenceOrder: 2,
      required: true,
      branching: null,
      writesTo: [{ targetKey: TEST_WRITE_TARGET }],
      configuration: {
        stepType: "short_text",
        prompt: "What is the company called?",
        phaseKey: "company",
        minLength: 1,
        maxLength: 120,
        placeholder: "Company name",
      },
    },
    {
      stepKey: "raise_amount",
      sequenceOrder: 3,
      required: true,
      branching: { op: "EQUALS", stepKey: "intent", value: "raising_now" },
      writesTo: [],
      configuration: {
        stepType: "range",
        prompt: "How much are you raising?",
        phaseKey: "raise",
        min: "0",
        max: "100000000",
        unit: "USD",
      },
    },
    {
      stepKey: "notes",
      sequenceOrder: 4,
      required: false,
      branching: null,
      writesTo: [],
      configuration: {
        stepType: "long_text",
        prompt: "Anything else?",
        phaseKey: "raise",
        minLength: 1,
        maxLength: 2000,
      },
    },
    {
      stepKey: "docs",
      sequenceOrder: 5,
      required: false,
      branching: null,
      writesTo: [],
      configuration: {
        stepType: "document_upload",
        prompt: "Attach what you already have.",
        phaseKey: "review",
        allowedResourceTypes: ["EVIDENCE_DOCUMENT"],
        minItems: 0,
        maxItems: 5,
      },
    },
    {
      stepKey: "confirm",
      sequenceOrder: 6,
      required: true,
      branching: null,
      writesTo: [],
      configuration: {
        stepType: "confirmation",
        prompt: "Does this look right?",
        phaseKey: "review",
        confirmLabel: "Yes, that's right",
        declineLabel: "Not yet",
        requireAffirmative: true,
      },
    },
  ],
};

/** Version 2: a reworded prompt and an extra optional step. */
export const SYNTHETIC_FOUNDER_MANIFEST_V2: OnboardingDefinitionManifest = {
  ...SYNTHETIC_FOUNDER_MANIFEST,
  version: 2,
  steps: [
    ...SYNTHETIC_FOUNDER_MANIFEST.steps.map((step) =>
      step.stepKey === "intent"
        ? {
            ...step,
            configuration: {
              ...step.configuration,
              prompt: "Are you raising?",
            },
          }
        : step,
    ),
    {
      stepKey: "website",
      sequenceOrder: 7,
      required: false,
      branching: null,
      writesTo: [],
      configuration: {
        stepType: "short_text",
        prompt: "Website?",
        phaseKey: "company",
        minLength: 1,
        maxLength: 200,
      },
    },
  ],
};
