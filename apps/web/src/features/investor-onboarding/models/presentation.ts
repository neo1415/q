import { z } from "zod";

import type {
  InvestorHandoffContext,
  InvestorReviewContext,
} from "@capital-q/investor-onboarding/definition";
import type { ChoiceOption } from "@capital-q/ui/choice-list";
import type { CurrencyOption } from "@capital-q/ui/money-input";

import type { TaxonomyCandidateView } from "../../onboarding-kit/client";
import type {
  SessionPresentation,
  StepBase,
} from "../../onboarding-kit/session";

/**
 * Frontend presentation contract for investor onboarding: the screens the
 * investor sees, produced by one mapper from the runtime's session view.
 * Composite screens (one "stage and cheque" screen over six runtime steps)
 * keep the journey at "tap, select, choose, confirm" rather than a form
 * per field. Money is exact strings all the way down.
 */

export const SECTION_IDS = [
  "context",
  "mandate",
  "preferences",
  "review",
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

const Amount = z.string().regex(/^\d+(?:\.\d{1,2})?$/);

export const StepResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("choice"), value: z.string().min(1) }),
  z.object({ kind: z.literal("narrative"), text: z.string().min(1).max(4000) }),
  z.object({
    kind: z.literal("investor_role"),
    investorType: z.string().min(1),
    organisationName: z.string().min(1).max(120),
    businessTitle: z.string().max(120).optional(),
  }),
  z.object({ kind: z.literal("mandate_select"), mandateId: z.string().uuid() }),
  z.object({
    kind: z.literal("stage_cheque"),
    stages: z.array(z.string()).min(1),
    currency: z.string().length(3),
    min: Amount.optional(),
    typical: Amount.optional(),
    max: Amount.optional(),
    roles: z.array(z.string()),
  }),
  z.object({
    kind: z.literal("taxonomy_focus"),
    nodeIds: z.array(z.string().uuid()).max(20),
    strength: z.string().optional(),
    avoidNodeIds: z.array(z.string().uuid()).max(20).optional(),
  }),
  z.object({
    kind: z.literal("attributes"),
    businessModelIds: z.array(z.string().uuid()).max(10),
    customerTypeIds: z.array(z.string().uuid()).max(10),
    capitalIntensity: z.string().optional(),
    regulatoryAppetite: z.string().optional(),
    revenueState: z.string().optional(),
  }),
  z.object({
    kind: z.literal("flags"),
    codes: z.array(z.string()),
    strength: z.string().optional(),
    customText: z.string().max(1000).optional(),
  }),
  z.object({
    kind: z.literal("red_flags"),
    avoid: z.array(z.string()),
    hard: z.array(z.string()),
    sectorExclusionIds: z.array(z.string().uuid()).max(20),
  }),
  z.object({ kind: z.literal("mandate_review"), confirmed: z.literal(true) }),
  z.object({ kind: z.literal("handoff"), confirmed: z.literal(true) }),
]);
export type StepResponse = z.infer<typeof StepResponseSchema>;
export type StepKind = StepResponse["kind"];

type Base<TKind extends StepKind> = StepBase<TKind> & {
  readonly section: SectionId;
};

export type MandateCandidateView = {
  readonly mandateId: string;
  readonly name: string;
  readonly status: "DRAFT" | "ACTIVE";
  readonly version: number;
};

export type StepView =
  | (Base<"choice"> & {
      readonly options: readonly ChoiceOption[];
      readonly response?: Extract<StepResponse, { kind: "choice" }> | undefined;
    })
  | (Base<"narrative"> & {
      readonly placeholder?: string | undefined;
      readonly maxLength: number;
      readonly response?:
        Extract<StepResponse, { kind: "narrative" }> | undefined;
    })
  | (Base<"investor_role"> & {
      readonly typeOptions: readonly ChoiceOption[];
      readonly personalWorkspaceName: string;
      readonly response?:
        Extract<StepResponse, { kind: "investor_role" }> | undefined;
    })
  | (Base<"mandate_select"> & {
      readonly candidates: readonly MandateCandidateView[];
      readonly suggestedMandateId: string | null;
      readonly response?:
        Extract<StepResponse, { kind: "mandate_select" }> | undefined;
    })
  | (Base<"stage_cheque"> & {
      readonly stageOptions: readonly ChoiceOption[];
      readonly currencies: readonly CurrencyOption[];
      readonly roleOptions: readonly ChoiceOption[];
      readonly response?:
        Extract<StepResponse, { kind: "stage_cheque" }> | undefined;
    })
  | (Base<"taxonomy_focus"> & {
      readonly vocabularies: readonly string[];
      readonly strengthOptions: readonly ChoiceOption[];
      readonly allowAvoid: boolean;
      readonly maxItems: number;
      /** Labels for already-selected ids, so a revisit can render them. */
      readonly selected: readonly TaxonomyCandidateView[];
      readonly avoidSelected: readonly TaxonomyCandidateView[];
      readonly response?:
        Extract<StepResponse, { kind: "taxonomy_focus" }> | undefined;
    })
  | (Base<"attributes"> & {
      readonly businessModelOptions: readonly TaxonomyCandidateView[];
      readonly customerTypeOptions: readonly TaxonomyCandidateView[];
      readonly capitalOptions: readonly ChoiceOption[];
      readonly regulatoryOptions: readonly ChoiceOption[];
      readonly revenueOptions: readonly ChoiceOption[];
      readonly response?:
        Extract<StepResponse, { kind: "attributes" }> | undefined;
    })
  | (Base<"flags"> & {
      readonly options: readonly ChoiceOption[];
      readonly strengthOptions: readonly ChoiceOption[];
      readonly defaultStrengthLabel: string;
      readonly allowCustom: boolean;
      readonly response?: Extract<StepResponse, { kind: "flags" }> | undefined;
    })
  | (Base<"red_flags"> & {
      readonly options: readonly ChoiceOption[];
      readonly sectorExclusionSelected: readonly TaxonomyCandidateView[];
      readonly response?:
        Extract<StepResponse, { kind: "red_flags" }> | undefined;
    })
  | (Base<"mandate_review"> & {
      readonly review: InvestorReviewContext | undefined;
      readonly response?: undefined;
    })
  | (Base<"handoff"> & {
      readonly handoff: InvestorHandoffContext | undefined;
      readonly response?: undefined;
    });

export type StepViewOfKind<TKind extends StepKind> = Extract<
  StepView,
  { kind: TKind }
>;

export type InvestorOnboardingSessionView = SessionPresentation<StepView>;
