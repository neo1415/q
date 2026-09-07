import type {
  OnboardingDefinitionManifest,
  OnboardingStepManifest,
} from "@capital-q/onboarding";

import {
  FOUNDER_DEFINITION_NAME,
  FOUNDER_DEFINITION_V1,
  FOUNDER_JOURNEY_TYPE,
  FOUNDER_PHASES,
  FOUNDER_STEP_CONTEXTS,
  FOUNDER_STEPS,
} from "./founder-v1.js";

/**
 * Founder Definition v2 — the same F0–F8 journey, with F2, F3, F7 and F8
 * doing what they were always meant to do (CQ-Q-021 §2, §3, §18, §28, §32).
 *
 * v1 declared what a founder had and then asked them to type it all anyway:
 * F2 collected checkboxes and said "uploading arrives in a later release",
 * F3 read back what the founder had typed, F7 was a free-text box, and F8
 * said plainly that Q had not analysed anything. Every one of those was
 * honest about being a placeholder. This version replaces them:
 *
 *   F2  a real document upload, against the Evidence upload API
 *   F3  what Q actually understood from those documents, to confirm or fix
 *   F7  the few questions Q still genuinely needs answered
 *   F8  a first Company Intelligence reading of the company
 *
 * Everything else — F0, F1, F4, F5, F6 — is v1's, reused rather than
 * restated, so the two versions cannot drift on the steps they share.
 *
 * v1 remains published and immutable. Sessions pinned to it keep running
 * their own journey; nothing here reaches back into them (§82).
 */

export const FOUNDER_DEFINITION_V2_VERSION = 2 as const;

/** Steps v2 replaces. Everything else is inherited from v1 unchanged. */
const REPLACED_STEP_KEYS: ReadonlySet<string> = new Set([
  FOUNDER_STEPS.materials,
  FOUNDER_STEPS.review,
  FOUNDER_STEPS.followUp,
  FOUNDER_STEPS.snapshot,
]);

/**
 * Server-side step contexts v2 adds (deterministic projections assembled by
 * the integration layer, never analysis performed in the browser).
 */
export const FOUNDER_V2_STEP_CONTEXTS = {
  /** Uploaded documents and their real processing state. */
  materials: "founder.materials",
  /** What Q extracted, as suggestions to confirm, edit or reject. */
  extractionReview: "founder.extraction_review",
  /** The few questions the planner decided are worth asking. */
  followUp: "founder.follow_up",
  /** The Company Intelligence reading. */
  intelligence: "founder.intelligence",
} as const;

/**
 * The document types F2 accepts, as canonical Evidence types. The UI shows
 * friendly labels for these; the enum values never reach a person (§8).
 *
 * Deliberately the four Capital Q can actually do something with, plus
 * OTHER. Offering a type the extraction pipeline cannot read would be a
 * promise the product does not keep.
 */
export const FOUNDER_MATERIAL_DOCUMENT_TYPES = [
  "PITCH_DECK",
  "FINANCIAL_MODEL",
  "MANAGEMENT_ACCOUNTS",
  "COMPANY_PROFILE",
  "OTHER",
] as const;
export type FounderMaterialDocumentType =
  (typeof FOUNDER_MATERIAL_DOCUMENT_TYPES)[number];

function step(
  input: Omit<OnboardingStepManifest, "sequenceOrder" | "branching"> & {
    readonly branching?: OnboardingStepManifest["branching"];
  },
): Omit<OnboardingStepManifest, "sequenceOrder"> {
  return { ...input, branching: input.branching ?? null };
}

const F2_MATERIALS = step({
  stepKey: FOUNDER_STEPS.materials,
  // Optional, and it must stay optional. A founder without documents is a
  // founder Capital Q knows less about — never a founder it turns away.
  required: false,
  configuration: {
    stepType: "document_upload",
    phaseKey: FOUNDER_PHASES.F2,
    prompt: "What do you already have?",
    supportingText:
      "Give Q anything that already explains the business — a deck, a financial model, management accounts. Private to your company unless you choose to share it. You can skip this.",
    allowedResourceTypes: ["EVIDENCE_DOCUMENT"],
    minItems: 0,
    maxItems: 6,
  },
  // Uploads are Evidence, written by the Evidence context through its own
  // API. The onboarding response records which documents this step gathered,
  // never their contents (§10, §34).
  writesTo: [],
});

const F3_REVIEW = step({
  stepKey: FOUNDER_STEPS.review,
  required: true,
  configuration: {
    stepType: "confirmation",
    phaseKey: FOUNDER_PHASES.F3,
    prompt: "Here's what I understood",
    supportingText:
      "From what you gave me. Confirm what's right, fix what isn't, and tell me what I missed.",
    confirmLabel: "That's right",
    requireAffirmative: true,
    // The deterministic projection of what the founder entered, which is
    // what a confirmation step must show. What Q read from the documents
    // arrives beside it as onboarding SUGGESTIONS — the sanctioned channel
    // for a proposal — rather than as a second context that could quietly
    // become the thing being confirmed (§19, §20).
    contextKey: FOUNDER_STEP_CONTEXTS.review,
  },
  writesTo: [],
});

const F7_FOLLOW_UP = step({
  stepKey: FOUNDER_STEPS.followUp,
  required: false,
  configuration: {
    stepType: "long_text",
    phaseKey: FOUNDER_PHASES.F7,
    prompt: "A few things I still need",
    supportingText:
      'Only what materially changes what I understand. Answer what you can; "I don\'t know" is a real answer.',
    minLength: 1,
    maxLength: 2000,
  },
  writesTo: [],
});

const F8_SNAPSHOT = step({
  stepKey: FOUNDER_STEPS.snapshot,
  required: true,
  configuration: {
    stepType: "confirmation",
    phaseKey: FOUNDER_PHASES.F8,
    prompt: "Here's how I currently understand your company",
    supportingText:
      "Built from what you told me and the material you shared. It will get sharper as more evidence arrives.",
    confirmLabel: "Go to Home",
    requireAffirmative: true,
    contextKey: FOUNDER_STEP_CONTEXTS.snapshot,
  },
  writesTo: [],
});

const REPLACEMENTS: ReadonlyMap<
  string,
  Omit<OnboardingStepManifest, "sequenceOrder">
> = new Map([
  [FOUNDER_STEPS.materials, F2_MATERIALS],
  [FOUNDER_STEPS.review, F3_REVIEW],
  [FOUNDER_STEPS.followUp, F7_FOLLOW_UP],
  [FOUNDER_STEPS.snapshot, F8_SNAPSHOT],
]);

/**
 * v1's steps in v1's order, with the four replaced in place.
 *
 * Order is preserved deliberately: F2 stays immediately after company
 * basics, because asking for documents before forty manual questions is the
 * whole point (§4). A founder with a deck should type materially less than
 * one without.
 */
const STEPS: readonly Omit<OnboardingStepManifest, "sequenceOrder">[] =
  FOUNDER_DEFINITION_V1.steps.map((existing) => {
    const replacement = REPLACEMENTS.get(existing.stepKey);
    if (replacement !== undefined) {
      return replacement;
    }
    const { sequenceOrder: _order, ...rest } = existing;
    return rest;
  });

export const FOUNDER_DEFINITION_V2: OnboardingDefinitionManifest = {
  journeyType: FOUNDER_JOURNEY_TYPE,
  name: FOUNDER_DEFINITION_NAME,
  version: FOUNDER_DEFINITION_V2_VERSION,
  schema: {
    ...FOUNDER_DEFINITION_V1.schema,
    phases: [
      { phaseKey: FOUNDER_PHASES.F0, label: "Welcome" },
      { phaseKey: FOUNDER_PHASES.F1, label: "Company" },
      { phaseKey: FOUNDER_PHASES.F2, label: "Materials" },
      { phaseKey: FOUNDER_PHASES.F3, label: "Review" },
      { phaseKey: FOUNDER_PHASES.F4, label: "Team" },
      { phaseKey: FOUNDER_PHASES.F5, label: "Traction" },
      { phaseKey: FOUNDER_PHASES.F6, label: "Raise" },
      { phaseKey: FOUNDER_PHASES.F7, label: "A few questions" },
      { phaseKey: FOUNDER_PHASES.F8, label: "Snapshot" },
    ],
  },
  steps: STEPS.map((definition, sequenceOrder) => ({
    ...definition,
    sequenceOrder,
  })),
};

/** Every step key v2 changed, for the drift-guard test and the ledger. */
export const FOUNDER_V2_REPLACED_STEPS: readonly string[] = [
  ...REPLACED_STEP_KEYS,
];
