import type {
  OnboardingResponseValue,
  OnboardingSessionView,
  OnboardingStepProgressStatus,
} from "@capital-q/contracts";
import {
  COUNTRY_OTHER_OPTION,
  CURRENCY_OPTIONS,
  FOUNDER_DEFINITION_V1,
  FOUNDER_DEFINITION_VERSION,
  FOUNDER_STEPS,
  FounderRaiseContextSchema,
  FounderReviewContextSchema,
  FounderSnapshotContextSchema,
  RAISING_ACTIVE_OPTIONS,
  type FounderSnapshotContext,
} from "@capital-q/founder-onboarding/definition";
import type { ChoiceOption } from "@capital-q/ui/choice-list";
import type { SnapshotSection } from "@capital-q/ui/intelligence-snapshot";

import type {
  FounderOnboardingSessionView,
  MetricQuestion,
  ReviewItem,
  SectionId,
  StepKind,
  StepResponse,
  StepStatus,
  StepSummary,
  StepView,
  TaxonomyCandidateView,
} from "./presentation";

/**
 * The Founder journey as the web presents it: runtime steps grouped into
 * the screens the founder actually sees (one composite "team" screen over
 * five runtime steps, and so on). Copy and options come from the same
 * Founder Definition v1 data the API published; state, eligibility and
 * saved answers come from the runtime's session view. The mapper is pure
 * and shared by the API adapter and the development fixture.
 *
 * Version discipline: this build presents definition version 1 only. A
 * session pinned to another version is reported as unavailable rather than
 * rendered with the wrong copy.
 */

export type GroupId =
  | "intent"
  | "company_basics"
  | "stage"
  | "description"
  | "categories"
  | "materials"
  | "review"
  | "team"
  | "traction"
  | "capital_objective"
  | "follow_up"
  | "snapshot";

export type Group = {
  readonly id: GroupId;
  readonly kind: StepKind;
  readonly section: SectionId;
  readonly title: string;
  /** Runtime step keys in definition order; never empty. */
  readonly stepKeys: readonly [string, ...string[]];
};

const S = FOUNDER_STEPS;

const SNAPSHOT_GROUP: Group = {
  id: "snapshot",
  kind: "snapshot",
  section: "review",
  title: "Here's what we have so far",
  stepKeys: [S.snapshot],
};

export const GROUPS: readonly Group[] = [
  {
    id: "intent",
    kind: "choice",
    section: "company",
    title: "What brings you to Capital Q?",
    stepKeys: [S.intent],
  },
  {
    id: "company_basics",
    kind: "company_basics",
    section: "company",
    title: "Your company",
    stepKeys: [S.companyName, S.website, S.country],
  },
  {
    id: "stage",
    kind: "choice",
    section: "company",
    title: "What stage is the company at?",
    stepKeys: [S.stage],
  },
  {
    id: "description",
    kind: "narrative",
    section: "company",
    title: "What does the company do?",
    stepKeys: [S.description],
  },
  {
    id: "categories",
    kind: "taxonomy_select",
    section: "company",
    title: "How would you categorise the company?",
    stepKeys: [S.categories],
  },
  {
    id: "materials",
    kind: "multi_choice",
    section: "company",
    title: "What do you already have?",
    stepKeys: [S.materials],
  },
  {
    id: "review",
    kind: "review",
    section: "company",
    title: "Here's what we have so far",
    stepKeys: [S.review],
  },
  {
    id: "team",
    kind: "team",
    section: "business",
    title: "Your founding team",
    stepKeys: [
      S.founderRole,
      S.founderCount,
      S.fullTime,
      S.teamSize,
      S.functions,
    ],
  },
  {
    id: "traction",
    kind: "traction",
    section: "business",
    title: "Business and traction",
    stepKeys: [S.signal, S.pilots, S.revenueStatus, S.customers, S.growth],
  },
  {
    id: "capital_objective",
    kind: "capital_objective",
    section: "raise",
    title: "Are you raising now?",
    stepKeys: [
      S.raising,
      S.currency,
      S.targetAmount,
      S.instrument,
      S.timeframe,
      S.useOfFunds,
      S.raiseConfirm,
    ],
  },
  {
    id: "follow_up",
    kind: "narrative",
    section: "review",
    title: "Anything else you want on record?",
    stepKeys: [S.followUp],
  },
  SNAPSHOT_GROUP,
];

export const SECTIONS = [
  { id: "company", label: "Company" },
  { id: "business", label: "Business" },
  { id: "raise", label: "Raise" },
  { id: "review", label: "Review" },
] as const;

const GROUP_BY_STEP = new Map<string, Group>(
  GROUPS.flatMap((group) => group.stepKeys.map((key) => [key, group])),
);
const GROUP_BY_ID = new Map(GROUPS.map((group) => [group.id, group]));
const STEP_CONFIG = new Map(
  FOUNDER_DEFINITION_V1.steps.map((step) => [step.stepKey, step]),
);

export function groupOf(stepKey: string): Group | undefined {
  return GROUP_BY_STEP.get(stepKey);
}

export function groupById(id: string): Group | undefined {
  return GROUP_BY_ID.get(id as GroupId);
}

function config(stepKey: string) {
  const step = STEP_CONFIG.get(stepKey);
  if (step === undefined) {
    throw new Error(`unknown founder step ${stepKey}`);
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

function labelOf(stepKey: string, optionKey: string | undefined) {
  return optionsOf(stepKey).find((o) => o.value === optionKey)?.label;
}

// ---------------------------------------------------------------------------
// Runtime state helpers
// ---------------------------------------------------------------------------

export type RuntimeState = {
  readonly view: OnboardingSessionView;
  readonly eligible: ReadonlyMap<string, OnboardingStepProgressStatus>;
  readonly responses: ReadonlyMap<string, OnboardingResponseValue>;
};

export function runtimeState(view: OnboardingSessionView): RuntimeState {
  return {
    view,
    eligible: new Map(
      view.progress.eligibleSteps.map((step) => [step.stepKey, step.status]),
    ),
    responses: new Map(view.responses.map((r) => [r.stepKey, r.value])),
  };
}

export function isSupportedVersion(view: OnboardingSessionView): boolean {
  return view.session.definitionVersion === FOUNDER_DEFINITION_VERSION;
}

function single(state: RuntimeState, key: string): string | undefined {
  const value = state.responses.get(key);
  return value?.type === "SINGLE_SELECT" ? value.optionKey : undefined;
}
function multi(state: RuntimeState, key: string): string[] | undefined {
  const value = state.responses.get(key);
  return value?.type === "MULTI_SELECT" ? [...value.optionKeys] : undefined;
}
function text(state: RuntimeState, key: string): string | undefined {
  const value = state.responses.get(key);
  return value?.type === "TEXT" ? value.text : undefined;
}
function range(state: RuntimeState, key: string): string | undefined {
  const value = state.responses.get(key);
  return value?.type === "RANGE" ? value.value : undefined;
}
function refs(state: RuntimeState, key: string): string[] | undefined {
  const value = state.responses.get(key);
  return value?.type === "RESOURCE_REFERENCE"
    ? [...value.resourceIds]
    : undefined;
}

/** The screen the session is on: by current step, or the snapshot once complete. */
export function currentGroup(view: OnboardingSessionView): Group {
  const key = view.session.currentStepKey;
  const group = key === null ? undefined : GROUP_BY_STEP.get(key);
  return group ?? SNAPSHOT_GROUP;
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
  if (statuses.length === 0) {
    return null;
  }
  if (group.id === current.id) {
    return "current";
  }
  if (statuses.every((status) => status === "SKIPPED")) {
    return "skipped";
  }
  if (
    statuses.every((status) => status === "COMPLETED" || status === "SKIPPED")
  ) {
    return "completed";
  }
  return "pending";
}

function skippedGroup(group: Group, state: RuntimeState): boolean {
  const statuses = group.stepKeys.flatMap((key) => {
    const status = state.eligible.get(key);
    return status === undefined ? [] : [status];
  });
  return statuses.length > 0 && statuses.every((s) => s === "SKIPPED");
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

export type PresentationExtras = {
  /** Labels for taxonomy node ids the founder already selected. */
  readonly selectedTaxonomy?: readonly TaxonomyCandidateView[] | undefined;
};

export function toPresentation(
  view: OnboardingSessionView,
  source: { readonly adapter: string; readonly synthetic: boolean },
  extras: PresentationExtras = {},
): FounderOnboardingSessionView {
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
    definitionVersion: `founder-v${String(view.session.definitionVersion)}`,
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
  firstStepKey = group.stepKeys[0],
) {
  const { configuration, required } = config(firstStepKey);
  return {
    id: group.id,
    kind,
    section: group.section,
    title: group.title,
    prompt: configuration.prompt,
    help: configuration.supportingText,
    optional: !required,
    skipped: skippedGroup(group, state),
  };
}

function buildStep(
  group: Group,
  state: RuntimeState,
  extras: PresentationExtras,
): StepView {
  const context = state.view.currentStep?.context;
  switch (group.id) {
    case "intent":
    case "stage": {
      const key = group.stepKeys[0];
      const value = single(state, key);
      return {
        ...base(group, "choice", state),
        options: optionsOf(key),
        response: value === undefined ? undefined : { kind: "choice", value },
      };
    }
    case "company_basics": {
      const name = text(state, S.companyName);
      const website = text(state, S.website);
      const country = single(state, S.country);
      return {
        ...base(group, "company_basics", state),
        countries: optionsOf(S.country),
        response:
          name === undefined
            ? undefined
            : {
                kind: "company_basics",
                name,
                ...(website === undefined ? {} : { website }),
                ...(country === undefined ? {} : { countryCode: country }),
              },
      };
    }
    case "description":
    case "follow_up": {
      const key = group.stepKeys[0];
      const { configuration } = config(key);
      const value = text(state, key);
      return {
        ...base(group, "narrative", state),
        maxLength:
          configuration.stepType === "long_text"
            ? configuration.maxLength
            : 2000,
        voiceEnabled: false,
        ...(group.id === "follow_up"
          ? {
              privacyNote:
                "Private to you. Investors never see this and it changes nothing about your company profile.",
            }
          : {}),
        response:
          value === undefined ? undefined : { kind: "narrative", text: value },
      };
    }
    case "categories": {
      const { configuration } = config(S.categories);
      const nodeIds = refs(state, S.categories);
      return {
        ...base(group, "taxonomy_select", state),
        sourceText: text(state, S.description),
        maxItems:
          configuration.stepType === "reference_select"
            ? configuration.maxItems
            : 8,
        selected: extras.selectedTaxonomy ?? [],
        response:
          nodeIds === undefined
            ? undefined
            : { kind: "taxonomy_select", nodeIds },
      };
    }
    case "materials": {
      const { configuration } = config(S.materials);
      const values = multi(state, S.materials);
      return {
        ...base(group, "multi_choice", state),
        options: optionsOf(S.materials),
        exclusiveValues:
          configuration.stepType === "multi_select"
            ? configuration.exclusiveOptionKeys
            : [],
        response:
          values === undefined ? undefined : { kind: "multi_choice", values },
      };
    }
    case "review":
      return buildReview(group, state, context);
    case "team": {
      const role = single(state, S.founderRole);
      const founders = range(state, S.founderCount);
      const fullTime = single(state, S.fullTime);
      const teamSize = range(state, S.teamSize);
      return {
        ...base(group, "team", state),
        prompt: "Your founding team",
        help: "Structured facts only. The narrative comes later.",
        roleOptions: optionsOf(S.founderRole),
        fullTimeOptions: optionsOf(S.fullTime),
        functionOptions: optionsOf(S.functions),
        response:
          role === undefined ||
          founders === undefined ||
          fullTime === undefined ||
          teamSize === undefined
            ? undefined
            : {
                kind: "team",
                role,
                founders,
                fullTime,
                teamSize,
                functions: multi(state, S.functions) ?? [],
              },
      };
    }
    case "traction":
      return buildTraction(group, state);
    case "capital_objective":
      return buildCapitalObjective(group, state, context);
    case "snapshot":
      return buildSnapshot(group, state, context);
  }
}

function buildReview(
  group: Group,
  state: RuntimeState,
  context: unknown,
): StepView {
  const parsed = FounderReviewContextSchema.safeParse(context);
  const review = parsed.success ? parsed.data : undefined;
  const item = (
    id: string,
    label: string,
    value: string | undefined,
    editStepId: GroupId,
  ): ReviewItem => ({ id, label, value, source: "founder", editStepId });
  return {
    ...base(group, "review", state),
    primaryActionLabel: "Looks right",
    intro:
      "Everything below is what you entered. Nothing has been analysed or shared.",
    items: [
      item("intent", "Why you're here", review?.intent?.label, "intent"),
      item("name", "Company", review?.company.name, "company_basics"),
      item(
        "website",
        "Website",
        review?.company.websiteUrl ?? undefined,
        "company_basics",
      ),
      item(
        "country",
        "Based in",
        review?.company.country?.label,
        "company_basics",
      ),
      item("stage", "Stage", review?.company.stage?.label, "stage"),
      item(
        "description",
        "What it does",
        review?.company.description ?? undefined,
        "description",
      ),
    ],
    categories: review?.categories.map((c) => c.label) ?? [],
    materials: review?.materials?.map((m) => m.label) ?? undefined,
    response: undefined,
  };
}

function metricOf(stepKey: string): MetricQuestion {
  const { configuration, required } = config(stepKey);
  return {
    id: stepKey,
    label: configuration.prompt,
    help: configuration.supportingText,
    kind: configuration.stepType === "range" ? "number" : "choice",
    options:
      configuration.stepType === "single_select"
        ? optionsOf(stepKey)
        : undefined,
    optional: !required,
  };
}

function buildTraction(group: Group, state: RuntimeState): StepView {
  const eligibleKeys = group.stepKeys.filter((key) => state.eligible.has(key));
  const metrics: Record<string, { value: string } | { unknown: true }> = {};
  for (const key of eligibleKeys) {
    const value = single(state, key) ?? range(state, key);
    if (value !== undefined) {
      metrics[key] = { value };
    } else if (state.eligible.get(key) === "SKIPPED") {
      metrics[key] = { unknown: true };
    }
  }
  const variant = state.eligible.has(S.signal) ? "pre_revenue" : "revenue";
  return {
    ...base(group, "traction", state, eligibleKeys[0]),
    prompt: "Business and traction",
    variant,
    intro:
      variant === "pre_revenue"
        ? "Early signals count. Unknown is a valid answer."
        : "Recent numbers as you track them. Unknown is a valid answer.",
    metrics: eligibleKeys.map(metricOf),
    response:
      Object.keys(metrics).length === 0
        ? undefined
        : { kind: "traction", metrics },
  };
}

function buildCapitalObjective(
  group: Group,
  state: RuntimeState,
  context: unknown,
): StepView {
  const raise = FounderRaiseContextSchema.safeParse(context);
  const raisingStatus = single(state, S.raising);
  const amount = range(state, S.targetAmount);
  const currency = single(state, S.currency);
  const instrument = single(state, S.instrument);
  const timeframe = single(state, S.timeframe);
  const useOfFunds = multi(state, S.useOfFunds);
  return {
    ...base(group, "capital_objective", state),
    help: "The raise is its own object, separate from the company profile. You can recalibrate it any time.",
    raisingOptions: optionsOf(S.raising),
    instrumentOptions: optionsOf(S.instrument),
    timeframeOptions: optionsOf(S.timeframe),
    useOfFundsOptions: optionsOf(S.useOfFunds),
    currencies: CURRENCY_OPTIONS.map((option) => ({
      code: option.optionKey.toUpperCase(),
      label: option.label,
    })),
    existingObjective:
      raise.success && raise.data.existing !== null
        ? {
            amount: raise.data.existing.amount,
            currency: raise.data.existing.currency,
          }
        : undefined,
    response:
      raisingStatus === undefined
        ? undefined
        : {
            kind: "capital_objective",
            raisingStatus,
            ...(amount !== undefined && currency !== undefined
              ? { targetAmount: { amount, currency: currency.toUpperCase() } }
              : {}),
            ...(instrument === undefined ? {} : { instrument }),
            ...(timeframe === undefined ? {} : { timeframe }),
            ...(useOfFunds === undefined ? {} : { useOfFunds }),
          },
  };
}

const MISSING_COPY: Readonly<Record<string, string>> = {
  description: "Add a sentence or two on what the company does.",
  categories: "Confirm the categories investors would find you under.",
  stage: "Set the company's stage.",
  materials:
    "Note which materials you have; uploads arrive in a later release.",
  founder_count: "Complete the founding team facts.",
  team_size: "Add today's team size.",
  capital_objective: "Define your raise when you're ready.",
};

function buildSnapshot(
  group: Group,
  state: RuntimeState,
  context: unknown,
): StepView {
  const parsed = FounderSnapshotContextSchema.safeParse(context);
  const snapshot: FounderSnapshotContext | undefined = parsed.success
    ? parsed.data
    : undefined;
  const sections: SnapshotSection[] =
    snapshot === undefined ? [] : snapshotSections(snapshot);
  const missing = snapshot?.missing ?? [];
  return {
    ...base(group, "snapshot", state),
    primaryActionLabel: "Go to Home",
    headline: "Here's what we have so far.",
    summary:
      "A plain summary of what you entered. Q has not analysed anything, and investors don't see this.",
    sections,
    nextSteps: missing.flatMap((key) => {
      const copy = MISSING_COPY[key];
      return copy === undefined ? [] : [{ id: key, text: copy }];
    }),
    provenanceNote:
      "Entered by you during setup. Q hasn't reviewed any of it yet, and investors don't see it.",
    response: undefined,
  };
}

function snapshotSections(snapshot: FounderSnapshotContext): SnapshotSection[] {
  const item = (id: string, text: string | undefined) =>
    text === undefined ? [] : [{ id, text, evidence: "from_founder" as const }];
  const company = snapshot.company;
  const team = snapshot.team;
  const traction = snapshot.traction;
  const raise = snapshot.raise;
  const sections: SnapshotSection[] = [
    {
      id: "company",
      title: "Your company",
      items: [
        ...item("name", company.name),
        ...item(
          "stage",
          company.stage === null ? undefined : `Stage: ${company.stage.label}`,
        ),
        ...item(
          "country",
          company.country === null
            ? undefined
            : `Based in ${company.country.label}`,
        ),
        ...item("website", company.websiteUrl ?? undefined),
        ...item("description", company.description ?? undefined),
        ...item(
          "categories",
          company.categories.length === 0
            ? undefined
            : `Categories: ${company.categories.map((c) => c.label).join(", ")}`,
        ),
      ],
    },
    {
      id: "team",
      title: "Your team",
      items: [
        ...item(
          "role",
          team.role === null ? undefined : `Your role: ${team.role.label}`,
        ),
        ...item(
          "founders",
          team.founderCount === null
            ? undefined
            : `${String(team.founderCount)} founder${team.founderCount === 1 ? "" : "s"}${
                team.fullTimeFounderCount === null
                  ? ""
                  : `, ${String(team.fullTimeFounderCount)} full-time`
              }`,
        ),
        ...item(
          "size",
          team.teamSize === null
            ? undefined
            : `${String(team.teamSize)} people today`,
        ),
        ...item(
          "functions",
          team.functions.length === 0
            ? undefined
            : `Covers: ${team.functions.map((f) => f.label).join(", ")}`,
        ),
      ],
    },
    {
      id: "traction",
      title: "Traction",
      items: [
        ...item("signal", traction.signal?.label),
        ...item(
          "pilots",
          traction.pilots === null
            ? undefined
            : `${traction.pilots} pilots or design partners`,
        ),
        ...item("revenue", traction.revenueStatus?.label),
        ...item(
          "customers",
          traction.customers === null
            ? undefined
            : `${traction.customers} paying customers`,
        ),
        ...item("growth", traction.growth?.label),
      ],
    },
    {
      id: "raise",
      title: "Your raise",
      items:
        raise.status === "active"
          ? [
              ...item("target", `Raising ${raise.currency} ${raise.amount}`),
              ...item(
                "instrument",
                raise.instrumentCode === null
                  ? undefined
                  : `Instrument: ${raise.instrumentCode}`,
              ),
              ...item("use", raise.useOfFundsSummary ?? undefined),
            ]
          : item("none", raise.raising?.label ?? "No raise defined yet"),
    },
    {
      id: "materials",
      title: "Materials you have",
      items:
        snapshot.materials === null || snapshot.materials.length === 0
          ? item("none", "None declared yet")
          : snapshot.materials.map((m) => ({
              id: m.key,
              text: m.label,
              evidence: "from_founder" as const,
            })),
    },
  ];
  return sections.filter((section) => section.items.length > 0);
}

// ---------------------------------------------------------------------------
// Composite responses → runtime submissions
// ---------------------------------------------------------------------------

export type Submission =
  | {
      readonly stepKey: string;
      readonly action: "submit";
      readonly value: OnboardingResponseValue;
    }
  | { readonly stepKey: string; readonly action: "skip" }
  /** Not asked on this screen yet (becomes eligible later); leave untouched. */
  | { readonly stepKey: string; readonly action: "leave" };

export class SubmissionPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubmissionPlanError";
  }
}

const submit = (
  stepKey: string,
  value: OnboardingResponseValue,
): Submission => ({ stepKey, action: "submit", value });
const skip = (stepKey: string): Submission => ({ stepKey, action: "skip" });
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

/**
 * What one composite answer means in runtime steps, in order. Eligibility
 * is decided at execution time against the live session (a raise answer
 * makes the amount eligible), so the plan lists every step of the group.
 */
export function planSubmissions(
  group: Group,
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
    case "multi_choice":
      return [multiOrSkip(group.stepKeys[0], response.values)];
    case "narrative":
      return [textOrSkip(group.stepKeys[0], response.text)];
    case "company_basics":
      return [
        submit(S.companyName, { type: "TEXT", text: response.name.trim() }),
        textOrSkip(S.website, response.website),
        selectOrSkip(
          S.country,
          response.countryCode === undefined
            ? undefined
            : response.countryCode.toLowerCase(),
        ),
      ];
    case "taxonomy_select":
      return [
        response.nodeIds.length === 0
          ? skip(S.categories)
          : submit(S.categories, {
              type: "RESOURCE_REFERENCE",
              resourceType: "TAXONOMY_NODE",
              resourceIds: [...response.nodeIds],
            }),
      ];
    case "review":
      return [submit(S.review, { type: "CONFIRMATION", confirmed: true })];
    case "team":
      return [
        submit(S.founderRole, {
          type: "SINGLE_SELECT",
          optionKey: response.role,
        }),
        submit(S.founderCount, { type: "RANGE", value: response.founders }),
        submit(S.fullTime, {
          type: "SINGLE_SELECT",
          optionKey: response.fullTime,
        }),
        submit(S.teamSize, { type: "RANGE", value: response.teamSize }),
        multiOrSkip(S.functions, response.functions),
      ];
    case "traction":
      return group.stepKeys.map((stepKey) => {
        const answer = response.metrics[stepKey];
        if (answer === undefined) {
          return { stepKey, action: "leave" };
        }
        if ("unknown" in answer) {
          return skip(stepKey);
        }
        return config(stepKey).configuration.stepType === "range"
          ? submit(stepKey, { type: "RANGE", value: answer.value })
          : submit(stepKey, { type: "SINGLE_SELECT", optionKey: answer.value });
      });
    case "capital_objective": {
      const raising = (RAISING_ACTIVE_OPTIONS as readonly string[]).includes(
        response.raisingStatus,
      );
      const head = submit(S.raising, {
        type: "SINGLE_SELECT",
        optionKey: response.raisingStatus,
      });
      if (!raising) {
        return [head];
      }
      if (response.targetAmount === undefined) {
        throw new SubmissionPlanError(
          "Enter the target amount to save the raise.",
        );
      }
      return [
        head,
        submit(S.currency, {
          type: "SINGLE_SELECT",
          optionKey: response.targetAmount.currency.toLowerCase(),
        }),
        submit(S.targetAmount, {
          type: "RANGE",
          value: response.targetAmount.amount,
        }),
        selectOrSkip(S.instrument, response.instrument),
        selectOrSkip(S.timeframe, response.timeframe),
        multiOrSkip(S.useOfFunds, response.useOfFunds),
        submit(S.raiseConfirm, { type: "CONFIRMATION", confirmed: true }),
      ];
    }
    case "snapshot":
      return [submit(S.snapshot, { type: "CONFIRMATION", confirmed: true })];
  }
}

export function sameValue(
  a: OnboardingResponseValue | undefined,
  b: OnboardingResponseValue,
): boolean {
  return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

/** Country keys are lowercase option keys in the definition; the UI shows ISO codes. */
export function countryOptionsForSelect(): readonly ChoiceOption[] {
  return optionsOf(S.country).map((option) => ({
    ...option,
    value:
      option.value === COUNTRY_OTHER_OPTION
        ? option.value
        : option.value.toUpperCase(),
  }));
}

export { labelOf as optionLabel };
