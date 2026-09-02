import { z } from "zod";

import type { ChoiceOption } from "@capital-q/ui/choice-list";
import type { EvidenceKind } from "@capital-q/ui/evidence-status";
import type { FactVerdict } from "@capital-q/ui/editable-fact";
import type { FileSelection } from "@capital-q/ui/file-selection-list";
import type { SnapshotSection } from "@capital-q/ui/intelligence-snapshot";
import type { CurrencyOption } from "@capital-q/ui/money-input";

/**
 * Frontend presentation contract for founder onboarding.
 *
 * This is what the screens render and what the client port returns. It is
 * deliberately a *presentation* model -- sections, steps, choices, saved
 * responses -- not a copy of the future onboarding domain. When CQ-ONB-001/002
 * land, their session/definition responses are mapped onto these views in
 * the API adapter and every screen keeps working.
 *
 * Responses are Zod schemas because they cross a boundary (the fixture's
 * storage today, the API tomorrow). Step views are produced in-process by
 * the adapter and stay as TypeScript types.
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

export const StepResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("choice"), value: z.string().min(1) }),
  z.object({ kind: z.literal("multi_choice"), values: z.array(z.string()) }),
  z.object({ kind: z.literal("narrative"), text: z.string().min(1).max(2000) }),
  z.object({
    kind: z.literal("company_basics"),
    name: z.string().min(1).max(120),
    website: z.string().max(200).optional(),
    countryCode: z.string().length(2).optional(),
  }),
  z.object({
    kind: z.literal("asset_selection"),
    assetTypes: z.array(z.string()),
  }),
  z.object({
    kind: z.literal("understanding_review"),
    facts: z.array(
      z.object({
        id: z.string(),
        value: z.string(),
        verdict: z.enum(["suggested", "confirmed", "edited", "missing"]),
      }),
    ),
    taxonomy: z.array(z.string()),
    missingNote: z.string().max(600).optional(),
  }),
  z.object({
    kind: z.literal("team"),
    founders: z.string(),
    fullTime: z.string(),
    role: z.string(),
    functions: z.array(z.string()),
    teamSize: z.string(),
  }),
  z.object({
    kind: z.literal("traction"),
    metrics: z.record(
      z.string(),
      z.union([
        z.object({ value: z.string() }),
        z.object({ money: MoneySchema }),
        z.object({ unknown: z.literal(true) }),
      ]),
    ),
  }),
  z.object({
    kind: z.literal("capital_objective"),
    raisingStatus: z.string(),
    targetAmount: MoneySchema.optional(),
    instrument: z.string().optional(),
    timeframe: z.string().optional(),
    useOfFunds: z.array(z.string()).optional(),
    note: z.string().max(600).optional(),
  }),
  z.object({
    kind: z.literal("clarification"),
    choice: z.string().optional(),
    text: z.string().max(600).optional(),
  }),
]);
export type StepResponse = z.infer<typeof StepResponseSchema>;
export type StepKind = StepResponse["kind"] | "intelligence_snapshot";

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
  readonly kind: "choice" | "number" | "money";
  readonly options?: readonly ChoiceOption[] | undefined;
  readonly optional: boolean;
};

export type FactView = {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly evidence: EvidenceKind;
  readonly evidenceDetail?: string | undefined;
  readonly verdict: FactVerdict;
};

export type AssetTypeOption = ChoiceOption & { readonly uploadable: boolean };

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
  | (StepBase<"asset_selection"> & {
      readonly assetTypes: readonly AssetTypeOption[];
      readonly exclusiveValues: readonly string[];
      readonly acceptedExtensions: readonly string[];
      readonly files: readonly FileSelection[];
      readonly response?:
        Extract<StepResponse, { kind: "asset_selection" }> | undefined;
    })
  | (StepBase<"understanding_review"> & {
      readonly intro: string;
      readonly facts: readonly FactView[];
      readonly taxonomyOptions: readonly string[];
      readonly taxonomySelected: readonly string[];
      readonly response?:
        Extract<StepResponse, { kind: "understanding_review" }> | undefined;
    })
  | (StepBase<"team"> & {
      readonly founderOptions: readonly ChoiceOption[];
      readonly fullTimeOptions: readonly ChoiceOption[];
      readonly roleOptions: readonly ChoiceOption[];
      readonly functionOptions: readonly ChoiceOption[];
      readonly teamSizeOptions: readonly ChoiceOption[];
      readonly response?: Extract<StepResponse, { kind: "team" }> | undefined;
    })
  | (StepBase<"traction"> & {
      readonly variant: string;
      readonly intro: string;
      readonly metrics: readonly MetricQuestion[];
      readonly currencies: readonly CurrencyOption[];
      readonly response?:
        Extract<StepResponse, { kind: "traction" }> | undefined;
    })
  | (StepBase<"capital_objective"> & {
      readonly raisingOptions: readonly ChoiceOption[];
      readonly instrumentOptions: readonly ChoiceOption[];
      readonly timeframeOptions: readonly ChoiceOption[];
      readonly useOfFundsOptions: readonly ChoiceOption[];
      readonly currencies: readonly CurrencyOption[];
      readonly response?:
        Extract<StepResponse, { kind: "capital_objective" }> | undefined;
    })
  | (StepBase<"clarification"> & {
      readonly observation: string;
      readonly question: string;
      readonly why?: string | undefined;
      readonly options: readonly ChoiceOption[];
      readonly allowText: boolean;
      readonly response?:
        Extract<StepResponse, { kind: "clarification" }> | undefined;
    })
  | (StepBase<"intelligence_snapshot"> & {
      readonly headline: string;
      readonly summary: string;
      readonly sections: readonly SnapshotSection[];
      readonly nextSteps: readonly {
        readonly id: string;
        readonly text: string;
      }[];
      readonly provenanceNote?: string | undefined;
      readonly response?: undefined;
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
  readonly step: StepView;
  /** Which adapter produced this view. Synthetic views say so on screen. */
  readonly source: { readonly adapter: string; readonly synthetic: boolean };
};
