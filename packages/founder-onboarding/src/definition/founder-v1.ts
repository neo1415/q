import type {
  BranchExpression,
  OnboardingDefinitionManifest,
  OnboardingStepManifest,
} from "@capital-q/onboarding";

/**
 * Founder Definition v1 — the F0–F8 journey as declarative reference data.
 *
 * This is the manifest the production migration publishes (rendered by
 * `render-sql.ts`, drift-guarded by a test) and the exact shape the runtime
 * pins every founder session to. Copy is product copy, options are bounded
 * vocabularies, branching is data, and `writesTo` names semantic targets the
 * integration layer maps onto canonical domains. Nothing here is a table,
 * a column, a model call or a screen.
 *
 * A published version is immutable: any change to this file is v2.
 */

export const FOUNDER_JOURNEY_TYPE = "founder" as const;
export const FOUNDER_DEFINITION_VERSION = 1 as const;
export const FOUNDER_DEFINITION_NAME = "Founder onboarding" as const;

/** Semantic write targets the Founder integration layer registers. */
export const FOUNDER_WRITE_TARGETS = {
  companyBootstrap: "company.bootstrap",
  companyBasics: "company.basics",
  companyTaxonomy: "company.taxonomy",
  founderMembership: "founder.membership",
  companyTeamFacts: "company.team_facts",
  capitalObjective: "capital.objective",
} as const;

/** Server-side step contexts (deterministic projections, never analysis). */
export const FOUNDER_STEP_CONTEXTS = {
  review: "founder.review",
  raise: "founder.raise",
  snapshot: "founder.snapshot",
} as const;

export const FOUNDER_PHASES = {
  F0: "F0",
  F1: "F1",
  F2: "F2",
  F3: "F3",
  F4: "F4",
  F5: "F5",
  F6: "F6",
  F7: "F7",
  F8: "F8",
} as const;

export const FOUNDER_STEPS = {
  intent: "F0.intent",
  companyName: "F1.company_name",
  website: "F1.website",
  country: "F1.country",
  stage: "F1.stage",
  description: "F1.description",
  categories: "F1.categories",
  materials: "F2.materials",
  review: "F3.review",
  founderRole: "F4.founder_role",
  founderCount: "F4.founder_count",
  fullTime: "F4.full_time",
  teamSize: "F4.team_size",
  functions: "F4.functions",
  signal: "F5.signal",
  pilots: "F5.pilots",
  revenueStatus: "F5.revenue_status",
  customers: "F5.customers",
  growth: "F5.growth",
  raising: "F6.raising",
  currency: "F6.currency",
  targetAmount: "F6.target_amount",
  instrument: "F6.instrument",
  timeframe: "F6.timeframe",
  useOfFunds: "F6.use_of_funds",
  raiseConfirm: "F6.confirm",
  followUp: "F7.follow_up",
  snapshot: "F8.snapshot",
} as const;
export type FounderStepKey = (typeof FOUNDER_STEPS)[keyof typeof FOUNDER_STEPS];

// ---------------------------------------------------------------------------
// Bounded option vocabularies. Keys are stable identifiers; labels are copy.
// ---------------------------------------------------------------------------

type Option = {
  readonly optionKey: string;
  readonly label: string;
  readonly description?: string;
};

export const INTENT_OPTIONS: Option[] = [
  {
    optionKey: "raising_now",
    label: "I'm raising for a company",
    description: "There is a round in motion or about to be.",
  },
  {
    optionKey: "preparing_to_raise",
    label: "I'm preparing to raise",
    description: "Getting the company and the story ready first.",
  },
  {
    optionKey: "exploring",
    label: "I'm exploring Capital Q",
    description: "Curious what Q can see before committing.",
  },
];

/** Stage option keys are the canonical `company_stage` codes, plus an honest unknown. */
export const STAGE_OPTIONS: Option[] = [
  { optionKey: "pre_seed", label: "Pre-seed" },
  { optionKey: "seed", label: "Seed" },
  { optionKey: "series_a", label: "Series A" },
  { optionKey: "series_b", label: "Series B" },
  { optionKey: "series_c_plus", label: "Series C or later" },
  { optionKey: "unsure", label: "Not sure yet" },
];
export const STAGE_UNKNOWN_OPTION = "unsure";
/** Stages whose traction questions are the pre-revenue variant. */
export const EARLY_STAGE_OPTIONS = ["pre_seed", "seed", "unsure"] as const;
export const LATER_STAGE_OPTIONS = [
  "series_a",
  "series_b",
  "series_c_plus",
] as const;

/** Compact V1 country list; option keys are lowercase ISO 3166-1 alpha-2. */
export const COUNTRY_OPTIONS: Option[] = [
  { optionKey: "ng", label: "Nigeria" },
  { optionKey: "ke", label: "Kenya" },
  { optionKey: "za", label: "South Africa" },
  { optionKey: "gh", label: "Ghana" },
  { optionKey: "eg", label: "Egypt" },
  { optionKey: "gb", label: "United Kingdom" },
  { optionKey: "us", label: "United States" },
  { optionKey: "de", label: "Germany" },
  { optionKey: "fr", label: "France" },
  { optionKey: "nl", label: "Netherlands" },
  { optionKey: "ae", label: "United Arab Emirates" },
  { optionKey: "in", label: "India" },
  { optionKey: "sg", label: "Singapore" },
  { optionKey: "br", label: "Brazil" },
  { optionKey: "ca", label: "Canada" },
  { optionKey: "other", label: "Somewhere else" },
];
export const COUNTRY_OTHER_OPTION = "other";

export const CATEGORY_VOCABULARIES = [
  "industry",
  "product_category",
  "business_model",
  "customer_type",
] as const;

export const MATERIAL_OPTIONS: Option[] = [
  { optionKey: "pitch_deck", label: "Pitch deck" },
  { optionKey: "financial_model", label: "Financial model" },
  { optionKey: "management_accounts", label: "Management accounts" },
  { optionKey: "company_profile", label: "Company profile or memo" },
  { optionKey: "other", label: "Something else" },
  {
    optionKey: "nothing_yet",
    label: "Nothing yet",
    description: "That's fine. Q starts from what you tell it.",
  },
];
export const MATERIAL_NONE_OPTION = "nothing_yet";

export const FOUNDER_ROLE_OPTIONS: Option[] = [
  { optionKey: "ceo", label: "CEO" },
  { optionKey: "cto", label: "CTO" },
  { optionKey: "coo", label: "COO" },
  { optionKey: "cpo", label: "Product" },
  { optionKey: "other", label: "Something else" },
];
/** Business title recorded on the founder's company membership. */
export const FOUNDER_ROLE_TITLES: Readonly<Record<string, string | null>> = {
  ceo: "CEO",
  cto: "CTO",
  coo: "COO",
  cpo: "Chief Product Officer",
  other: null,
};

export const FULL_TIME_OPTIONS: Option[] = [
  { optionKey: "all", label: "All founders are full-time" },
  { optionKey: "some", label: "Some founders are full-time" },
  { optionKey: "none", label: "Not full-time yet" },
];

export const FUNCTION_OPTIONS: Option[] = [
  { optionKey: "product", label: "Product" },
  { optionKey: "engineering", label: "Engineering" },
  { optionKey: "sales", label: "Sales and partnerships" },
  { optionKey: "operations", label: "Operations" },
  { optionKey: "finance", label: "Finance" },
  { optionKey: "domain", label: "Deep industry expertise" },
];

export const SIGNAL_OPTIONS: Option[] = [
  { optionKey: "pilots", label: "Pilots running" },
  { optionKey: "lois", label: "Signed letters of intent" },
  { optionKey: "waitlist", label: "A waitlist" },
  { optionKey: "users", label: "Active users, not yet paying" },
  { optionKey: "none", label: "Nothing measurable yet" },
];

export const REVENUE_STATUS_OPTIONS: Option[] = [
  { optionKey: "recurring", label: "Recurring and growing" },
  { optionKey: "recurring_flat", label: "Recurring, roughly flat" },
  { optionKey: "project", label: "Project or one-off revenue" },
  { optionKey: "early", label: "First revenue only" },
];

export const GROWTH_OPTIONS: Option[] = [
  { optionKey: "over_100", label: "More than doubled" },
  { optionKey: "50_100", label: "Grew 50–100%" },
  { optionKey: "under_50", label: "Grew under 50%" },
  { optionKey: "flat", label: "Flat or down" },
];

export const RAISING_OPTIONS: Option[] = [
  { optionKey: "active", label: "Yes, actively" },
  { optionKey: "preparing", label: "Preparing to raise" },
  { optionKey: "not_now", label: "Not right now" },
];
export const RAISING_ACTIVE_OPTIONS = ["active", "preparing"] as const;

/** Option keys are lowercase ISO 4217 codes. */
export const CURRENCY_OPTIONS: Option[] = [
  { optionKey: "usd", label: "US dollar" },
  { optionKey: "eur", label: "Euro" },
  { optionKey: "gbp", label: "Pound sterling" },
  { optionKey: "ngn", label: "Nigerian naira" },
  { optionKey: "kes", label: "Kenyan shilling" },
  { optionKey: "zar", label: "South African rand" },
  { optionKey: "aed", label: "UAE dirham" },
  { optionKey: "inr", label: "Indian rupee" },
  { optionKey: "sgd", label: "Singapore dollar" },
];

export const INSTRUMENT_OPTIONS: Option[] = [
  { optionKey: "priced", label: "Priced equity round" },
  { optionKey: "safe", label: "SAFE" },
  { optionKey: "convertible", label: "Convertible note" },
  { optionKey: "unsure", label: "Not sure yet" },
];
/** Canonical instrument codes; "unsure" records nothing. */
export const INSTRUMENT_CODES: Readonly<Record<string, string | null>> = {
  priced: "priced_equity",
  safe: "safe",
  convertible: "convertible_note",
  unsure: null,
};

export const TIMEFRAME_OPTIONS: Option[] = [
  { optionKey: "under_3", label: "Within 3 months" },
  { optionKey: "3_6", label: "3–6 months" },
  { optionKey: "6_12", label: "6–12 months" },
  { optionKey: "unsure", label: "Not sure yet" },
];

export const USE_OF_FUNDS_OPTIONS: Option[] = [
  { optionKey: "product", label: "Product and engineering" },
  { optionKey: "hiring", label: "Key hires" },
  { optionKey: "gtm", label: "Sales and go-to-market" },
  { optionKey: "runway", label: "Runway and operations" },
  { optionKey: "expansion", label: "New markets" },
];

// ---------------------------------------------------------------------------
// Branching (data, evaluated by the runtime)
// ---------------------------------------------------------------------------

const earlyStage: BranchExpression = {
  op: "IN",
  stepKey: FOUNDER_STEPS.stage,
  values: [...EARLY_STAGE_OPTIONS],
};
const laterStage: BranchExpression = {
  op: "IN",
  stepKey: FOUNDER_STEPS.stage,
  values: [...LATER_STAGE_OPTIONS],
};
const raising: BranchExpression = {
  op: "IN",
  stepKey: FOUNDER_STEPS.raising,
  values: [...RAISING_ACTIVE_OPTIONS],
};
const hasPilotSignal: BranchExpression = {
  op: "ALL",
  expressions: [
    earlyStage,
    { op: "IN", stepKey: FOUNDER_STEPS.signal, values: ["pilots", "lois"] },
  ],
};

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function step(
  input: Omit<OnboardingStepManifest, "sequenceOrder" | "branching"> & {
    readonly branching?: BranchExpression;
  },
): Omit<OnboardingStepManifest, "sequenceOrder"> {
  return { ...input, branching: input.branching ?? null };
}

const STEPS: readonly Omit<OnboardingStepManifest, "sequenceOrder">[] = [
  // F0 — intent -------------------------------------------------------------
  step({
    stepKey: FOUNDER_STEPS.intent,
    required: true,
    configuration: {
      stepType: "single_select",
      phaseKey: FOUNDER_PHASES.F0,
      prompt: "What brings you to Capital Q?",
      supportingText: "One tap. You can change this later.",
      options: INTENT_OPTIONS,
    },
    writesTo: [],
  }),

  // F1 — company ------------------------------------------------------------
  step({
    stepKey: FOUNDER_STEPS.companyName,
    required: true,
    configuration: {
      stepType: "short_text",
      phaseKey: FOUNDER_PHASES.F1,
      prompt: "Your company",
      supportingText: "The name investors would recognise.",
      minLength: 1,
      maxLength: 120,
    },
    writesTo: [{ targetKey: FOUNDER_WRITE_TARGETS.companyBootstrap }],
  }),
  step({
    stepKey: FOUNDER_STEPS.website,
    required: false,
    configuration: {
      stepType: "short_text",
      phaseKey: FOUNDER_PHASES.F1,
      prompt: "Website",
      supportingText: "Optional. Q can read a website later to fill gaps.",
      minLength: 1,
      maxLength: 200,
      placeholder: "example.com",
    },
    writesTo: [{ targetKey: FOUNDER_WRITE_TARGETS.companyBasics }],
  }),
  step({
    stepKey: FOUNDER_STEPS.country,
    required: false,
    configuration: {
      stepType: "single_select",
      phaseKey: FOUNDER_PHASES.F1,
      prompt: "Where is the company based?",
      supportingText: "Optional for now.",
      options: COUNTRY_OPTIONS,
    },
    writesTo: [{ targetKey: FOUNDER_WRITE_TARGETS.companyBasics }],
  }),
  step({
    stepKey: FOUNDER_STEPS.stage,
    required: true,
    configuration: {
      stepType: "single_select",
      phaseKey: FOUNDER_PHASES.F1,
      prompt: "What stage is the company at?",
      whyQAsks:
        "Stage decides which questions come next and how investors read the numbers.",
      options: STAGE_OPTIONS,
    },
    writesTo: [{ targetKey: FOUNDER_WRITE_TARGETS.companyBasics }],
  }),
  step({
    stepKey: FOUNDER_STEPS.description,
    required: false,
    configuration: {
      stepType: "long_text",
      phaseKey: FOUNDER_PHASES.F1,
      prompt: "In a sentence or two, what does the company do?",
      supportingText:
        "Plain words are best. Who it's for and what it changes for them.",
      minLength: 1,
      maxLength: 2000,
    },
    writesTo: [{ targetKey: FOUNDER_WRITE_TARGETS.companyBasics }],
  }),
  step({
    stepKey: FOUNDER_STEPS.categories,
    required: false,
    configuration: {
      stepType: "reference_select",
      phaseKey: FOUNDER_PHASES.F1,
      prompt: "How would you categorise the company?",
      supportingText:
        "Suggested categories come from your description. Pick the ones that fit; nothing is assigned until you confirm.",
      resourceType: "TAXONOMY_NODE",
      vocabularyCodes: [...CATEGORY_VOCABULARIES],
      minItems: 1,
      maxItems: 8,
    },
    writesTo: [{ targetKey: FOUNDER_WRITE_TARGETS.companyTaxonomy }],
  }),

  // F2 — materials (declaration only; uploads arrive with Evidence) --------
  step({
    stepKey: FOUNDER_STEPS.materials,
    required: false,
    configuration: {
      stepType: "multi_select",
      phaseKey: FOUNDER_PHASES.F2,
      prompt: "What do you already have?",
      supportingText:
        "Tell us what exists today. Uploading arrives in a later release; nothing is collected here.",
      options: MATERIAL_OPTIONS,
      minSelections: 1,
      maxSelections: 6,
      exclusiveOptionKeys: [MATERIAL_NONE_OPTION],
    },
    writesTo: [],
  }),

  // F3 — review -------------------------------------------------------------
  step({
    stepKey: FOUNDER_STEPS.review,
    required: true,
    configuration: {
      stepType: "confirmation",
      phaseKey: FOUNDER_PHASES.F3,
      prompt: "Here's what we have so far",
      supportingText:
        "Everything below is what you entered. Go back to change anything.",
      confirmLabel: "Looks right",
      requireAffirmative: true,
      contextKey: FOUNDER_STEP_CONTEXTS.review,
    },
    writesTo: [],
  }),

  // F4 — team ---------------------------------------------------------------
  step({
    stepKey: FOUNDER_STEPS.founderRole,
    required: true,
    configuration: {
      stepType: "single_select",
      phaseKey: FOUNDER_PHASES.F4,
      prompt: "Your role",
      options: FOUNDER_ROLE_OPTIONS,
    },
    writesTo: [{ targetKey: FOUNDER_WRITE_TARGETS.founderMembership }],
  }),
  step({
    stepKey: FOUNDER_STEPS.founderCount,
    required: true,
    configuration: {
      stepType: "range",
      phaseKey: FOUNDER_PHASES.F4,
      prompt: "How many founders?",
      min: "1",
      max: "50",
      step: "1",
    },
    writesTo: [{ targetKey: FOUNDER_WRITE_TARGETS.companyTeamFacts }],
  }),
  step({
    stepKey: FOUNDER_STEPS.fullTime,
    required: true,
    configuration: {
      stepType: "single_select",
      phaseKey: FOUNDER_PHASES.F4,
      prompt: "Are the founders full-time?",
      options: FULL_TIME_OPTIONS,
    },
    writesTo: [{ targetKey: FOUNDER_WRITE_TARGETS.companyTeamFacts }],
  }),
  step({
    stepKey: FOUNDER_STEPS.teamSize,
    required: true,
    configuration: {
      stepType: "range",
      phaseKey: FOUNDER_PHASES.F4,
      prompt: "How many people work on the company today?",
      supportingText: "Founders included.",
      min: "1",
      max: "100000",
      step: "1",
    },
    writesTo: [{ targetKey: FOUNDER_WRITE_TARGETS.companyTeamFacts }],
  }),
  step({
    stepKey: FOUNDER_STEPS.functions,
    required: false,
    configuration: {
      stepType: "multi_select",
      phaseKey: FOUNDER_PHASES.F4,
      prompt: "Which of these does the founding team cover?",
      options: FUNCTION_OPTIONS,
      minSelections: 1,
      maxSelections: 6,
      exclusiveOptionKeys: [],
    },
    writesTo: [],
  }),

  // F5 — traction, adaptive on stage ---------------------------------------
  step({
    stepKey: FOUNDER_STEPS.signal,
    required: true,
    branching: earlyStage,
    configuration: {
      stepType: "single_select",
      phaseKey: FOUNDER_PHASES.F5,
      prompt: "What early signal do you have?",
      options: SIGNAL_OPTIONS,
    },
    writesTo: [],
  }),
  step({
    stepKey: FOUNDER_STEPS.pilots,
    required: false,
    branching: hasPilotSignal,
    configuration: {
      stepType: "range",
      phaseKey: FOUNDER_PHASES.F5,
      prompt: "How many pilots or design partners?",
      min: "0",
      max: "10000",
      step: "1",
    },
    writesTo: [],
  }),
  step({
    stepKey: FOUNDER_STEPS.revenueStatus,
    required: true,
    branching: laterStage,
    configuration: {
      stepType: "single_select",
      phaseKey: FOUNDER_PHASES.F5,
      prompt: "How would you describe revenue today?",
      options: REVENUE_STATUS_OPTIONS,
    },
    writesTo: [],
  }),
  step({
    stepKey: FOUNDER_STEPS.customers,
    required: false,
    branching: laterStage,
    configuration: {
      stepType: "range",
      phaseKey: FOUNDER_PHASES.F5,
      prompt: "Paying customers",
      min: "0",
      max: "10000000",
      step: "1",
    },
    writesTo: [],
  }),
  step({
    stepKey: FOUNDER_STEPS.growth,
    required: false,
    branching: laterStage,
    configuration: {
      stepType: "single_select",
      phaseKey: FOUNDER_PHASES.F5,
      prompt: "Growth over the last six months",
      options: GROWTH_OPTIONS,
    },
    writesTo: [],
  }),

  // F6 — the raise ----------------------------------------------------------
  step({
    stepKey: FOUNDER_STEPS.raising,
    required: true,
    configuration: {
      stepType: "single_select",
      phaseKey: FOUNDER_PHASES.F6,
      prompt: "Are you raising now?",
      options: RAISING_OPTIONS,
    },
    writesTo: [],
  }),
  step({
    stepKey: FOUNDER_STEPS.currency,
    required: true,
    branching: raising,
    configuration: {
      stepType: "single_select",
      phaseKey: FOUNDER_PHASES.F6,
      prompt: "Currency",
      options: CURRENCY_OPTIONS,
    },
    writesTo: [],
  }),
  step({
    stepKey: FOUNDER_STEPS.targetAmount,
    required: true,
    branching: raising,
    configuration: {
      stepType: "range",
      phaseKey: FOUNDER_PHASES.F6,
      prompt: "Target amount",
      supportingText: "An exact figure, in the currency above.",
      min: "1",
      max: "1000000000000",
      step: "1",
    },
    writesTo: [],
  }),
  step({
    stepKey: FOUNDER_STEPS.instrument,
    required: false,
    branching: raising,
    configuration: {
      stepType: "single_select",
      phaseKey: FOUNDER_PHASES.F6,
      prompt: "Instrument",
      options: INSTRUMENT_OPTIONS,
    },
    writesTo: [],
  }),
  step({
    stepKey: FOUNDER_STEPS.timeframe,
    required: false,
    branching: raising,
    configuration: {
      stepType: "single_select",
      phaseKey: FOUNDER_PHASES.F6,
      prompt: "When do you want to close?",
      options: TIMEFRAME_OPTIONS,
    },
    writesTo: [],
  }),
  step({
    stepKey: FOUNDER_STEPS.useOfFunds,
    required: false,
    branching: raising,
    configuration: {
      stepType: "multi_select",
      phaseKey: FOUNDER_PHASES.F6,
      prompt: "What will the money mainly go to?",
      options: USE_OF_FUNDS_OPTIONS,
      minSelections: 1,
      maxSelections: 5,
      exclusiveOptionKeys: [],
    },
    writesTo: [],
  }),
  step({
    stepKey: FOUNDER_STEPS.raiseConfirm,
    required: true,
    branching: raising,
    configuration: {
      stepType: "confirmation",
      phaseKey: FOUNDER_PHASES.F6,
      prompt: "Save this as your capital objective?",
      supportingText:
        "This becomes the company's current raise. You can recalibrate it any time.",
      confirmLabel: "Save my raise",
      requireAffirmative: true,
      contextKey: FOUNDER_STEP_CONTEXTS.raise,
    },
    writesTo: [{ targetKey: FOUNDER_WRITE_TARGETS.capitalObjective }],
  }),

  // F7 — founder-private follow-up ----------------------------------------
  step({
    stepKey: FOUNDER_STEPS.followUp,
    required: false,
    configuration: {
      stepType: "long_text",
      phaseKey: FOUNDER_PHASES.F7,
      prompt: "Anything else you want on record?",
      supportingText:
        "Private to you. Investors never see this and it changes nothing about your company profile.",
      minLength: 1,
      maxLength: 2000,
    },
    writesTo: [],
  }),

  // F8 — snapshot -----------------------------------------------------------
  step({
    stepKey: FOUNDER_STEPS.snapshot,
    required: true,
    configuration: {
      stepType: "confirmation",
      phaseKey: FOUNDER_PHASES.F8,
      prompt: "Here's what we have so far",
      supportingText:
        "A plain summary of what you entered. Q has not analysed anything yet.",
      confirmLabel: "Go to Home",
      requireAffirmative: true,
      contextKey: FOUNDER_STEP_CONTEXTS.snapshot,
    },
    writesTo: [],
  }),
];

export const FOUNDER_DEFINITION_V1: OnboardingDefinitionManifest = {
  journeyType: FOUNDER_JOURNEY_TYPE,
  name: FOUNDER_DEFINITION_NAME,
  version: FOUNDER_DEFINITION_VERSION,
  schema: {
    schemaVersion: 1,
    phases: [
      { phaseKey: FOUNDER_PHASES.F0, label: "Welcome" },
      { phaseKey: FOUNDER_PHASES.F1, label: "Company" },
      { phaseKey: FOUNDER_PHASES.F2, label: "Materials" },
      { phaseKey: FOUNDER_PHASES.F3, label: "Review" },
      { phaseKey: FOUNDER_PHASES.F4, label: "Team" },
      { phaseKey: FOUNDER_PHASES.F5, label: "Traction" },
      { phaseKey: FOUNDER_PHASES.F6, label: "Raise" },
      { phaseKey: FOUNDER_PHASES.F7, label: "Anything else" },
      { phaseKey: FOUNDER_PHASES.F8, label: "Snapshot" },
    ],
    // A founder starts before any organisation exists; F1 binds the company.
    runtime: { subjectType: "COMPANY", allowUnboundStart: true },
  },
  steps: STEPS.map((definition, sequenceOrder) => ({
    ...definition,
    sequenceOrder,
  })),
};
