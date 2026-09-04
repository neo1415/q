import type {
  OnboardingResponseValue,
  OnboardingSessionView,
  OnboardingStepProgressStatus,
} from "@capital-q/contracts";
import {
  BUSINESS_MODEL_VOCABULARIES,
  CURRENCY_OPTIONS,
  CUSTOMER_TYPE_VOCABULARIES,
  GEOGRAPHY_VOCABULARIES,
  INVESTOR_DEFINITION_V1,
  INVESTOR_DEFINITION_VERSION,
  INVESTOR_STEPS,
  InvestorHandoffContextSchema,
  InvestorMandatesContextSchema,
  InvestorReviewContextSchema,
  PERSONAL_INVESTING_WORKSPACE,
  SECTOR_VOCABULARIES,
} from "@capital-q/investor-onboarding/definition";
import type { ChoiceOption } from "@capital-q/ui/choice-list";

import type { TaxonomyCandidateView } from "../../onboarding-kit/client";
import {
  SubmissionPlanError,
  type JourneyGroup,
  type RuntimePort,
  type Submission,
} from "../../onboarding-kit/runtime-port";
import type { StepStatus, StepSummary } from "../../onboarding-kit/session";
import type {
  InvestorOnboardingSessionView,
  SectionId,
  StepKind,
  StepResponse,
  StepView,
} from "./presentation";

/**
 * The Investor journey as the web presents it: runtime steps I0–I12
 * grouped into the screens the investor sees, under four semantic
 * sections. Copy and options come from Investor Definition v1; state,
 * eligibility and answers from the runtime's session view. Pure; shared by
 * the API adapter and the development fixture.
 *
 * This build presents definition version 1 only.
 */

export type GroupId =
  | "role"
  | "deployment"
  | "mandate"
  | "stage_cheque"
  | "geography"
  | "sectors"
  | "attributes"
  | "founder"
  | "green_flags"
  | "red_flags"
  | "portfolio"
  | "discovery"
  | "inbound"
  | "context"
  | "review"
  | "handoff";

export type Group = JourneyGroup & {
  readonly id: GroupId;
  readonly kind: StepKind;
  readonly section: SectionId;
};

const S = INVESTOR_STEPS;

const HANDOFF_GROUP: Group = {
  id: "handoff",
  kind: "handoff",
  section: "review",
  title: "Your mandate is ready",
  stepKeys: [S.handoff],
};

export const GROUPS: readonly Group[] = [
  {
    id: "role",
    kind: "investor_role",
    section: "context",
    title: "How you invest",
    stepKeys: [S.investorType, S.organisationName, S.businessTitle],
  },
  {
    id: "deployment",
    kind: "choice",
    section: "context",
    title: "Are you deploying capital right now?",
    stepKeys: [S.deploymentStatus],
  },
  {
    id: "mandate",
    kind: "mandate_select",
    section: "context",
    title: "Which mandate are we defining?",
    stepKeys: [S.mandateContext],
  },
  {
    id: "stage_cheque",
    kind: "stage_cheque",
    section: "mandate",
    title: "Stage and cheque",
    stepKeys: [
      S.stages,
      S.currency,
      S.chequeMin,
      S.chequeTypical,
      S.chequeMax,
      S.investmentRole,
    ],
  },
  {
    id: "geography",
    kind: "taxonomy_focus",
    section: "mandate",
    title: "Where do you invest?",
    stepKeys: [S.geography, S.geographyStrength],
  },
  {
    id: "sectors",
    kind: "taxonomy_focus",
    section: "mandate",
    title: "Which sectors and product areas?",
    stepKeys: [S.sectors, S.sectorStrength, S.sectorsAvoid],
  },
  {
    id: "attributes",
    kind: "attributes",
    section: "mandate",
    title: "Business attributes",
    stepKeys: [
      S.businessModels,
      S.customerTypes,
      S.capitalIntensity,
      S.regulatoryAppetite,
      S.revenueState,
    ],
  },
  {
    id: "founder",
    kind: "flags",
    section: "preferences",
    title: "Founding team",
    stepKeys: [S.founderPreferences, S.founderStrength],
  },
  {
    id: "green_flags",
    kind: "flags",
    section: "preferences",
    title: "Green flags",
    stepKeys: [S.greenFlags, S.greenFlagStrength, S.customCriteria],
  },
  {
    id: "red_flags",
    kind: "red_flags",
    section: "preferences",
    title: "Red flags",
    stepKeys: [S.avoid, S.hardExclusions, S.sectorExclusions],
  },
  {
    id: "portfolio",
    kind: "narrative",
    section: "preferences",
    title: "Portfolio",
    stepKeys: [S.portfolio],
  },
  {
    id: "discovery",
    kind: "choice",
    section: "preferences",
    title: "Discovery style",
    stepKeys: [S.discoveryMode],
  },
  {
    id: "inbound",
    kind: "choice",
    section: "preferences",
    title: "Inbound",
    stepKeys: [S.inboundPreference],
  },
  {
    id: "context",
    kind: "narrative",
    section: "review",
    title: "Add something we missed",
    stepKeys: [S.additionalContext],
  },
  {
    id: "review",
    kind: "mandate_review",
    section: "review",
    title: "Here's the mandate you've defined",
    stepKeys: [S.review],
  },
  HANDOFF_GROUP,
];

export const SECTIONS = [
  { id: "context", label: "Context" },
  { id: "mandate", label: "Mandate" },
  { id: "preferences", label: "Preferences" },
  { id: "review", label: "Review" },
] as const;

const GROUP_BY_STEP = new Map<string, Group>(
  GROUPS.flatMap((group) => group.stepKeys.map((key) => [key, group])),
);
const GROUP_BY_ID = new Map(GROUPS.map((group) => [group.id, group]));
const STEP_CONFIG = new Map(
  INVESTOR_DEFINITION_V1.steps.map((step) => [step.stepKey, step]),
);

export function groupById(id: string): Group | undefined {
  return GROUP_BY_ID.get(id as GroupId);
}

function config(stepKey: string) {
  const step = STEP_CONFIG.get(stepKey);
  if (step === undefined) {
    throw new Error(`unknown investor step ${stepKey}`);
  }
  return step;
}

export function optionsOf(stepKey: string): readonly ChoiceOption[] {
  const { configuration } = config(stepKey);
  if (
    configuration.stepType !== "single_select" &&
    configuration.stepType !== "multi_select"
  ) {
    return [];
  }
  return configuration.options.map((option) => ({
    value: option.optionKey,
    label: option.label,
    ...(option.description === undefined
      ? {}
      : { description: option.description }),
  }));
}

// ---------------------------------------------------------------------------
// Runtime state helpers
// ---------------------------------------------------------------------------

type RuntimeState = {
  readonly view: OnboardingSessionView;
  readonly eligible: ReadonlyMap<string, OnboardingStepProgressStatus>;
  readonly responses: ReadonlyMap<string, OnboardingResponseValue>;
};

function runtimeState(view: OnboardingSessionView): RuntimeState {
  return {
    view,
    eligible: new Map(
      view.progress.eligibleSteps.map((step) => [step.stepKey, step.status]),
    ),
    responses: new Map(view.responses.map((r) => [r.stepKey, r.value])),
  };
}

export function isSupportedVersion(view: OnboardingSessionView): boolean {
  return view.session.definitionVersion === INVESTOR_DEFINITION_VERSION;
}

const single = (s: RuntimeState, key: string) => {
  const v = s.responses.get(key);
  return v?.type === "SINGLE_SELECT" ? v.optionKey : undefined;
};
const multi = (s: RuntimeState, key: string) => {
  const v = s.responses.get(key);
  return v?.type === "MULTI_SELECT" ? [...v.optionKeys] : undefined;
};
const text = (s: RuntimeState, key: string) => {
  const v = s.responses.get(key);
  return v?.type === "TEXT" ? v.text : undefined;
};
const range = (s: RuntimeState, key: string) => {
  const v = s.responses.get(key);
  return v?.type === "RANGE" ? v.value : undefined;
};
const refs = (s: RuntimeState, key: string) => {
  const v = s.responses.get(key);
  return v?.type === "RESOURCE_REFERENCE" ? [...v.resourceIds] : undefined;
};

export function currentGroup(view: OnboardingSessionView): Group {
  const key = view.session.currentStepKey;
  const group = key === null ? undefined : GROUP_BY_STEP.get(key);
  return group ?? HANDOFF_GROUP;
}

function groupStatus(
  group: Group,
  state: RuntimeState,
  current: Group,
): StepStatus | null {
  const statuses = group.stepKeys.flatMap((key) => {
    const status = state.eligible.get(key);
    return status === undefined ? [] : [status];
  });
  if (statuses.length === 0) return null;
  if (group.id === current.id) return "current";
  if (statuses.every((status) => status === "SKIPPED")) return "skipped";
  if (
    statuses.every((status) => status === "COMPLETED" || status === "SKIPPED")
  ) {
    return "completed";
  }
  return "pending";
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

export type PresentationExtras = {
  /** Labels for taxonomy node ids already selected, by step key. */
  readonly selectedTaxonomy?:
    Readonly<Record<string, readonly TaxonomyCandidateView[]>> | undefined;
  /** Small vocabularies listed for pick-lists, by vocabulary code. */
  readonly nodeLists?:
    Readonly<Record<string, readonly TaxonomyCandidateView[]>> | undefined;
};

/** What the runtime client fetches for the current screen before presenting it. */
export async function enrich(
  view: OnboardingSessionView,
  group: JourneyGroup,
  port: RuntimePort,
): Promise<PresentationExtras> {
  const state = runtimeState(view);
  const selectedTaxonomy: Record<string, readonly TaxonomyCandidateView[]> = {};
  const describe = async (stepKey: string) => {
    const ids = refs(state, stepKey) ?? [];
    selectedTaxonomy[stepKey] =
      ids.length === 0 ? [] : await port.describeNodes(ids);
  };
  switch (group.id) {
    case "geography":
      await describe(S.geography);
      return { selectedTaxonomy };
    case "sectors":
      await describe(S.sectors);
      await describe(S.sectorsAvoid);
      return { selectedTaxonomy };
    case "red_flags":
      await describe(S.sectorExclusions);
      return { selectedTaxonomy };
    case "attributes": {
      const [businessModels, customerTypes] = await Promise.all([
        port.listNodes(BUSINESS_MODEL_VOCABULARIES[0]),
        port.listNodes(CUSTOMER_TYPE_VOCABULARIES[0]),
      ]);
      return {
        nodeLists: {
          [BUSINESS_MODEL_VOCABULARIES[0]]: businessModels,
          [CUSTOMER_TYPE_VOCABULARIES[0]]: customerTypes,
        },
      };
    }
    default:
      return {};
  }
}

export function toPresentation(
  view: OnboardingSessionView,
  source: { readonly adapter: string; readonly synthetic: boolean },
  extras: PresentationExtras = {},
): InvestorOnboardingSessionView {
  const state = runtimeState(view);
  const current = currentGroup(view);
  const complete = view.session.status !== "ACTIVE";
  const steps: StepSummary[] = GROUPS.flatMap((group) => {
    const status = groupStatus(group, state, current);
    return status === null
      ? []
      : [
          {
            id: group.id,
            section: group.section,
            title: group.title,
            status: complete && status === "current" ? "completed" : status,
          },
        ];
  });
  return {
    sessionId: view.session.id,
    definitionVersion: `investor-v${String(view.session.definitionVersion)}`,
    status: complete ? "complete" : "in_progress",
    sections: [...SECTIONS],
    steps,
    currentStepId: current.id,
    step: complete ? undefined : buildStep(current, state, extras),
    source,
  };
}

function base<TKind extends StepKind>(
  group: Group,
  kind: TKind,
  state: RuntimeState,
  firstStepKey: string = group.stepKeys[0],
) {
  const { configuration, required } = config(firstStepKey);
  const statuses = group.stepKeys.flatMap((key) => {
    const status = state.eligible.get(key);
    return status === undefined ? [] : [status];
  });
  return {
    id: group.id,
    kind,
    section: group.section,
    title: group.title,
    prompt: configuration.prompt,
    help: configuration.supportingText,
    optional: !required,
    skipped: statuses.length > 0 && statuses.every((s) => s === "SKIPPED"),
  };
}

const STRENGTH_OPTIONS = () => optionsOf(S.geographyStrength);

function buildStep(
  group: Group,
  state: RuntimeState,
  extras: PresentationExtras,
): StepView {
  const context = state.view.currentStep?.context;
  const selected = (key: string) => extras.selectedTaxonomy?.[key] ?? [];
  switch (group.id) {
    case "deployment":
    case "discovery":
    case "inbound": {
      const key = group.stepKeys[0];
      const value = single(state, key);
      return {
        ...base(group, "choice", state),
        options: optionsOf(key),
        response: value === undefined ? undefined : { kind: "choice", value },
      };
    }
    case "portfolio":
    case "context": {
      const key = group.stepKeys[0];
      const { configuration } = config(key);
      const value = text(state, key);
      return {
        ...base(group, "narrative", state),
        maxLength:
          configuration.stepType === "long_text"
            ? configuration.maxLength
            : 4000,
        ...(group.id === "portfolio"
          ? { placeholder: "One company per line" }
          : {}),
        response:
          value === undefined ? undefined : { kind: "narrative", text: value },
      };
    }
    case "role": {
      const investorType = single(state, S.investorType);
      const organisationName = text(state, S.organisationName);
      const businessTitle = text(state, S.businessTitle);
      return {
        ...base(group, "investor_role", state),
        typeOptions: optionsOf(S.investorType),
        personalWorkspaceName: PERSONAL_INVESTING_WORKSPACE,
        response:
          investorType === undefined
            ? undefined
            : {
                kind: "investor_role",
                investorType,
                organisationName: organisationName ?? "",
                ...(businessTitle === undefined ? {} : { businessTitle }),
              },
      };
    }
    case "mandate": {
      const parsed = InvestorMandatesContextSchema.safeParse(context);
      const chosen = refs(state, S.mandateContext)?.[0];
      return {
        ...base(group, "mandate_select", state),
        candidates: parsed.success ? parsed.data.candidates : [],
        suggestedMandateId: parsed.success
          ? parsed.data.suggestedMandateId
          : null,
        response:
          chosen === undefined
            ? undefined
            : { kind: "mandate_select", mandateId: chosen },
      };
    }
    case "stage_cheque": {
      const stages = multi(state, S.stages);
      const currency = single(state, S.currency);
      const min = range(state, S.chequeMin);
      const typical = range(state, S.chequeTypical);
      const max = range(state, S.chequeMax);
      return {
        ...base(group, "stage_cheque", state),
        prompt: "Stage and cheque",
        help: "Which stages, and how much per investment. Unknown is fine; leave it blank.",
        stageOptions: optionsOf(S.stages),
        currencies: CURRENCY_OPTIONS.map((o) => ({
          code: o.optionKey.toUpperCase(),
          label: o.label,
        })),
        roleOptions: optionsOf(S.investmentRole),
        response:
          stages === undefined || currency === undefined
            ? undefined
            : {
                kind: "stage_cheque",
                stages,
                currency: currency.toUpperCase(),
                ...(min === undefined ? {} : { min }),
                ...(typical === undefined ? {} : { typical }),
                ...(max === undefined ? {} : { max }),
                roles: multi(state, S.investmentRole) ?? [],
              },
      };
    }
    case "geography": {
      const nodeIds = refs(state, S.geography);
      const strength = single(state, S.geographyStrength);
      return {
        ...base(group, "taxonomy_focus", state),
        vocabularies: [...GEOGRAPHY_VOCABULARIES],
        strengthOptions: STRENGTH_OPTIONS(),
        allowAvoid: false,
        maxItems: 20,
        selected: selected(S.geography),
        avoidSelected: [],
        response:
          nodeIds === undefined
            ? undefined
            : {
                kind: "taxonomy_focus",
                nodeIds,
                ...(strength === undefined ? {} : { strength }),
              },
      };
    }
    case "sectors": {
      const nodeIds = refs(state, S.sectors);
      const avoidNodeIds = refs(state, S.sectorsAvoid);
      const strength = single(state, S.sectorStrength);
      return {
        ...base(group, "taxonomy_focus", state),
        vocabularies: [...SECTOR_VOCABULARIES],
        strengthOptions: STRENGTH_OPTIONS(),
        allowAvoid: true,
        maxItems: 20,
        selected: selected(S.sectors),
        avoidSelected: selected(S.sectorsAvoid),
        response:
          nodeIds === undefined && avoidNodeIds === undefined
            ? undefined
            : {
                kind: "taxonomy_focus",
                nodeIds: nodeIds ?? [],
                ...(strength === undefined ? {} : { strength }),
                avoidNodeIds: avoidNodeIds ?? [],
              },
      };
    }
    case "attributes": {
      const businessModelIds = refs(state, S.businessModels);
      const customerTypeIds = refs(state, S.customerTypes);
      const capitalIntensity = single(state, S.capitalIntensity);
      const regulatoryAppetite = single(state, S.regulatoryAppetite);
      const revenueState = single(state, S.revenueState);
      const answered = [
        businessModelIds,
        customerTypeIds,
        capitalIntensity,
        regulatoryAppetite,
        revenueState,
      ].some((v) => v !== undefined);
      return {
        ...base(group, "attributes", state),
        prompt: "Business attributes",
        help: "Each dimension is recorded separately; nothing is collapsed into one category.",
        businessModelOptions:
          extras.nodeLists?.[BUSINESS_MODEL_VOCABULARIES[0]] ?? [],
        customerTypeOptions:
          extras.nodeLists?.[CUSTOMER_TYPE_VOCABULARIES[0]] ?? [],
        capitalOptions: optionsOf(S.capitalIntensity),
        regulatoryOptions: optionsOf(S.regulatoryAppetite),
        revenueOptions: optionsOf(S.revenueState),
        response: !answered
          ? undefined
          : {
              kind: "attributes",
              businessModelIds: businessModelIds ?? [],
              customerTypeIds: customerTypeIds ?? [],
              ...(capitalIntensity === undefined ? {} : { capitalIntensity }),
              ...(regulatoryAppetite === undefined
                ? {}
                : { regulatoryAppetite }),
              ...(revenueState === undefined ? {} : { revenueState }),
            },
      };
    }
    case "founder": {
      const codes = multi(state, S.founderPreferences);
      const strength = single(state, S.founderStrength);
      return {
        ...base(group, "flags", state),
        options: optionsOf(S.founderPreferences),
        strengthOptions: STRENGTH_OPTIONS(),
        defaultStrengthLabel: "Nice to have",
        allowCustom: false,
        response:
          codes === undefined
            ? undefined
            : {
                kind: "flags",
                codes,
                ...(strength === undefined ? {} : { strength }),
              },
      };
    }
    case "green_flags": {
      const codes = multi(state, S.greenFlags);
      const strength = single(state, S.greenFlagStrength);
      const customText = text(state, S.customCriteria);
      return {
        ...base(group, "flags", state),
        options: optionsOf(S.greenFlags),
        strengthOptions: STRENGTH_OPTIONS(),
        defaultStrengthLabel: "Strong preference",
        allowCustom: true,
        response:
          codes === undefined && customText === undefined
            ? undefined
            : {
                kind: "flags",
                codes: codes ?? [],
                ...(strength === undefined ? {} : { strength }),
                ...(customText === undefined ? {} : { customText }),
              },
      };
    }
    case "red_flags": {
      const avoid = multi(state, S.avoid);
      const hard = multi(state, S.hardExclusions);
      const sectorExclusionIds = refs(state, S.sectorExclusions);
      return {
        ...base(group, "red_flags", state),
        prompt: "Red flags",
        help: "Two different things: what you'd rather not see, and what must never be shown.",
        options: optionsOf(S.avoid),
        sectorExclusionSelected: selected(S.sectorExclusions),
        response:
          avoid === undefined &&
          hard === undefined &&
          sectorExclusionIds === undefined
            ? undefined
            : {
                kind: "red_flags",
                avoid: avoid ?? [],
                hard: hard ?? [],
                sectorExclusionIds: sectorExclusionIds ?? [],
              },
      };
    }
    case "review": {
      const parsed = InvestorReviewContextSchema.safeParse(context);
      return {
        ...base(group, "mandate_review", state),
        primaryActionLabel: "Looks right",
        review: parsed.success ? parsed.data : undefined,
        response: undefined,
      };
    }
    case "handoff": {
      const parsed = InvestorHandoffContextSchema.safeParse(context);
      return {
        ...base(group, "handoff", state),
        primaryActionLabel: "Go to Discover",
        handoff: parsed.success ? parsed.data : undefined,
        response: undefined,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Composite responses → runtime submissions
// ---------------------------------------------------------------------------

const submit = (
  stepKey: string,
  value: OnboardingResponseValue,
): Submission => ({ stepKey, action: "submit", value });
const skip = (stepKey: string): Submission => ({ stepKey, action: "skip" });
const leave = (stepKey: string): Submission => ({ stepKey, action: "leave" });
const selectOrSkip = (stepKey: string, optionKey: string | undefined) =>
  optionKey === undefined
    ? skip(stepKey)
    : submit(stepKey, { type: "SINGLE_SELECT", optionKey });
const multiOrSkip = (stepKey: string, keys: readonly string[] | undefined) =>
  keys === undefined || keys.length === 0
    ? skip(stepKey)
    : submit(stepKey, { type: "MULTI_SELECT", optionKeys: [...keys] });
const textOrSkip = (stepKey: string, value: string | undefined) =>
  value === undefined || value.trim().length === 0
    ? skip(stepKey)
    : submit(stepKey, { type: "TEXT", text: value.trim() });
const rangeOrSkip = (stepKey: string, value: string | undefined) =>
  value === undefined || value.length === 0
    ? skip(stepKey)
    : submit(stepKey, { type: "RANGE", value });
const nodesOrSkip = (stepKey: string, ids: readonly string[] | undefined) =>
  ids === undefined || ids.length === 0
    ? skip(stepKey)
    : submit(stepKey, {
        type: "RESOURCE_REFERENCE",
        resourceType: "TAXONOMY_NODE",
        resourceIds: [...ids],
      });
/** A strength step exists only once its list has entries; leave it alone otherwise. */
const strengthFor = (
  stepKey: string,
  hasItems: boolean,
  strength: string | undefined,
) => (!hasItems ? leave(stepKey) : selectOrSkip(stepKey, strength));

export function planSubmissions(
  group: JourneyGroup,
  response: StepResponse,
): readonly Submission[] {
  if (response.kind !== group.kind) {
    throw new SubmissionPlanError(
      `response kind ${response.kind} does not match screen ${group.id}`,
    );
  }
  switch (response.kind) {
    case "choice":
      return [
        submit(group.stepKeys[0], {
          type: "SINGLE_SELECT",
          optionKey: response.value,
        }),
      ];
    case "narrative":
      return [textOrSkip(group.stepKeys[0], response.text)];
    case "investor_role":
      return [
        submit(S.investorType, {
          type: "SINGLE_SELECT",
          optionKey: response.investorType,
        }),
        submit(S.organisationName, {
          type: "TEXT",
          text: response.organisationName.trim(),
        }),
        textOrSkip(S.businessTitle, response.businessTitle),
      ];
    case "mandate_select":
      return [
        submit(S.mandateContext, {
          type: "RESOURCE_REFERENCE",
          resourceType: "INVESTOR_MANDATE",
          resourceIds: [response.mandateId],
        }),
      ];
    case "stage_cheque":
      return [
        submit(S.stages, {
          type: "MULTI_SELECT",
          optionKeys: [...response.stages],
        }),
        submit(S.currency, {
          type: "SINGLE_SELECT",
          optionKey: response.currency.toLowerCase(),
        }),
        rangeOrSkip(S.chequeMin, response.min),
        rangeOrSkip(S.chequeTypical, response.typical),
        rangeOrSkip(S.chequeMax, response.max),
        multiOrSkip(S.investmentRole, response.roles),
      ];
    case "taxonomy_focus":
      return group.id === "geography"
        ? [
            nodesOrSkip(S.geography, response.nodeIds),
            strengthFor(
              S.geographyStrength,
              response.nodeIds.length > 0,
              response.strength,
            ),
          ]
        : [
            nodesOrSkip(S.sectors, response.nodeIds),
            strengthFor(
              S.sectorStrength,
              response.nodeIds.length > 0,
              response.strength,
            ),
            nodesOrSkip(S.sectorsAvoid, response.avoidNodeIds),
          ];
    case "attributes":
      return [
        nodesOrSkip(S.businessModels, response.businessModelIds),
        nodesOrSkip(S.customerTypes, response.customerTypeIds),
        selectOrSkip(S.capitalIntensity, response.capitalIntensity),
        selectOrSkip(S.regulatoryAppetite, response.regulatoryAppetite),
        selectOrSkip(S.revenueState, response.revenueState),
      ];
    case "flags":
      return group.id === "founder"
        ? [
            multiOrSkip(S.founderPreferences, response.codes),
            strengthFor(
              S.founderStrength,
              response.codes.length > 0,
              response.strength,
            ),
          ]
        : [
            multiOrSkip(S.greenFlags, response.codes),
            strengthFor(
              S.greenFlagStrength,
              response.codes.length > 0,
              response.strength,
            ),
            textOrSkip(S.customCriteria, response.customText),
          ];
    case "red_flags": {
      const overlap = response.avoid.filter((code) =>
        response.hard.includes(code),
      );
      if (overlap.length > 0) {
        throw new SubmissionPlanError(
          "A red flag is either something to avoid or something never to show, not both.",
        );
      }
      return [
        multiOrSkip(S.avoid, response.avoid),
        multiOrSkip(S.hardExclusions, response.hard),
        nodesOrSkip(S.sectorExclusions, response.sectorExclusionIds),
      ];
    }
    case "mandate_review":
      return [submit(S.review, { type: "CONFIRMATION", confirmed: true })];
    case "handoff":
      return [submit(S.handoff, { type: "CONFIRMATION", confirmed: true })];
  }
}
