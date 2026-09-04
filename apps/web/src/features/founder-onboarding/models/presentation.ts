import { z } from "zod";

import type { ChoiceOption } from "@capital-q/ui/choice-list";
import type { SnapshotSection } from "@capital-q/ui/intelligence-snapshot";
import type { CurrencyOption } from "@capital-q/ui/money-input";

/**
 * Frontend presentation contract for founder onboarding.
 *
 * What the screens render and what the client port returns. It is a
 * *presentation* model -- sections, composite screens, choices, saved
 * answers -- produced by one mapper from the onboarding runtime's session
 * view (`@capital-q/contracts`). The API client and the development fixture
 * both speak the runtime contract underneath, so every screen sees exactly
 * the same shapes whichever adapter is composed.
 *
 * Responses are Zod schemas because they cross a boundary (the fixture's
 * storage, the server actions). Step views are produced in-process and stay
 * as TypeScript types.
 */

export const SECTION_IDS = ["company", "business", "raise", "review"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const STEP_STATUSES = [
  "pending",
  "current",
  "completed",
  "skipped",
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

// ---------------------------------------------------------------------------
// Responses (what the founder answered), by step kind
// ---------------------------------------------------------------------------

const MoneySchema = z.object({
  /** Exact decimal string, never a float. */
  amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
  currency: z.string().length(3),
});
export type MoneyResponse = z.infer<typeof MoneySchema>;

const Count = z.string().regex(/^\d{1,9}$/);

export const StepResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("choice"), value: z.string().min(1) }),
  z.object({ kind: z.literal("multi_choice"), values: z.array(z.string()) }),
  z.object({ kind: z.literal("narrative"), text: z.string().min(1).max(2000) }),
  z.object({
    kind: z.literal("company_basics"),
    name: z.string().min(1).max(120),
    website: z.string().max(200).optional(),
    countryCode: z.string().min(2).max(8).optional(),
  }),
  z.object({
    kind: z.literal("taxonomy_select"),
    nodeIds: z.array(z.string().uuid()).max(8),
  }),
  z.object({ kind: z.literal("review"), confirmed: z.literal(true) }),
  z.object({
    kind: z.literal("team"),
    founders: Count,
    fullTime: z.string().min(1),
    role: z.string().min(1),
    functions: z.array(z.string()),
    teamSize: Count,
  }),
  z.object({
    kind: z.literal("traction"),
    metrics: z.record(
      z.string(),
      z.union([
        z.object({ value: z.string() }),
        z.object({ unknown: z.literal(true) }),
      ]),
    ),
  }),
  z.object({
    kind: z.literal("capital_objective"),
    raisingStatus: z.string().min(1),
    targetAmount: MoneySchema.optional(),
    instrument: z.string().optional(),
    timeframe: z.string().optional(),
    useOfFunds: z.array(z.string()).optional(),
  }),
  z.object({ kind: z.literal("snapshot"), confirmed: z.literal(true) }),
]);
export type StepResponse = z.infer<typeof StepResponseSchema>;
export type StepKind = StepResponse["kind"];

// ---------------------------------------------------------------------------
// Step views (what a screen renders)
// ---------------------------------------------------------------------------

type StepBase<TKind extends StepKind> = {
  readonly id: string;
  readonly kind: TKind;
  readonly section: SectionId;
  readonly title: string;
  readonly prompt?: string | undefined;
  readonly help?: string | undefined;
  readonly optional: boolean;
  readonly privacyNote?: string | undefined;
  readonly primaryActionLabel?: string | undefined;
  readonly skipped: boolean;
};

export type MetricQuestion = {
  readonly id: string;
  readonly label: string;
  readonly help?: string | undefined;
  readonly kind: "choice" | "number";
  readonly options?: readonly ChoiceOption[] | undefined;
  readonly optional: boolean;
};

/** A canonical taxonomy node offered for confirmation. Never auto-assigned. */
export type TaxonomyCandidateView = {
  readonly nodeId: string;
  readonly label: string;
  readonly vocabularyLabel: string;
  /** Short observable reason from the deterministic classifier. */
  readonly reason?: string | undefined;
};

export type ReviewItem = {
  readonly id: string;
  readonly label: string;
  readonly value: string | undefined;
  /** Where the value came from. Always the founder in V1. */
  readonly source: "founder";
  /** The group to reopen to change it. */
  readonly editStepId: string;
};

export type StepView =
  | (StepBase<"choice"> & {
      readonly options: readonly ChoiceOption[];
      readonly response?: Extract<StepResponse, { kind: "choice" }> | undefined;
    })
  | (StepBase<"multi_choice"> & {
      readonly options: readonly ChoiceOption[];
      readonly exclusiveValues: readonly string[];
      readonly response?:
        Extract<StepResponse, { kind: "multi_choice" }> | undefined;
    })
  | (StepBase<"narrative"> & {
      readonly placeholder?: string | undefined;
      readonly maxLength: number;
      readonly voiceEnabled: boolean;
      readonly response?:
        Extract<StepResponse, { kind: "narrative" }> | undefined;
    })
  | (StepBase<"company_basics"> & {
      readonly countries: readonly ChoiceOption[];
      readonly response?:
        Extract<StepResponse, { kind: "company_basics" }> | undefined;
    })
  | (StepBase<"taxonomy_select"> & {
      /** Text the candidates are derived from (the founder's own description). */
      readonly sourceText: string | undefined;
      readonly maxItems: number;
      readonly response?:
        Extract<StepResponse, { kind: "taxonomy_select" }> | undefined;
      /** Labels for already-selected ids, so a revisit can render them. */
      readonly selected: readonly TaxonomyCandidateView[];
    })
  | (StepBase<"review"> & {
      readonly intro: string;
      readonly items: readonly ReviewItem[];
      readonly categories: readonly string[];
      readonly materials: readonly string[] | undefined;
      readonly response?: Extract<StepResponse, { kind: "review" }> | undefined;
    })
  | (StepBase<"team"> & {
      readonly roleOptions: readonly ChoiceOption[];
      readonly fullTimeOptions: readonly ChoiceOption[];
      readonly functionOptions: readonly ChoiceOption[];
      readonly response?: Extract<StepResponse, { kind: "team" }> | undefined;
    })
  | (StepBase<"traction"> & {
      readonly variant: "pre_revenue" | "revenue";
      readonly intro: string;
      readonly metrics: readonly MetricQuestion[];
      readonly response?:
        Extract<StepResponse, { kind: "traction" }> | undefined;
    })
  | (StepBase<"capital_objective"> & {
      readonly raisingOptions: readonly ChoiceOption[];
      readonly instrumentOptions: readonly ChoiceOption[];
      readonly timeframeOptions: readonly ChoiceOption[];
      readonly useOfFundsOptions: readonly ChoiceOption[];
      readonly currencies: readonly CurrencyOption[];
      /** Present when an objective already exists: saving recalibrates it. */
      readonly existingObjective:
        { readonly amount: string; readonly currency: string } | undefined;
      readonly response?:
        Extract<StepResponse, { kind: "capital_objective" }> | undefined;
    })
  | (StepBase<"snapshot"> & {
      readonly headline: string;
      readonly summary: string;
      readonly sections: readonly SnapshotSection[];
      readonly nextSteps: readonly {
        readonly id: string;
        readonly text: string;
      }[];
      readonly provenanceNote: string;
      readonly response?:
        Extract<StepResponse, { kind: "snapshot" }> | undefined;
    });

export type StepViewOfKind<TKind extends StepKind> = Extract<
  StepView,
  { kind: TKind }
>;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export type StepSummary = {
  readonly id: string;
  readonly section: SectionId;
  readonly title: string;
  readonly status: StepStatus;
};

export type SectionSummary = {
  readonly id: SectionId;
  readonly label: string;
};

export type FounderOnboardingSessionView = {
  readonly sessionId: string;
  readonly definitionVersion: string;
  readonly status: "in_progress" | "complete";
  readonly sections: readonly SectionSummary[];
  readonly steps: readonly StepSummary[];
  readonly currentStepId: string;
  /** Absent only once the session is complete. */
  readonly step: StepView | undefined;
  /** Which adapter produced this view. Synthetic views say so on screen. */
  readonly source: { readonly adapter: string; readonly synthetic: boolean };
};
