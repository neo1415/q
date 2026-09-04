import type {
  BranchExpression,
  OnboardingDefinitionManifest,
  OnboardingStepManifest,
} from "@capital-q/onboarding";

/**
 * Investor Definition v1 — the I0–I12 journey as declarative reference data.
 *
 * Published by migration (rendered by the runtime's SQL renderer and
 * drift-guarded by a test) and pinned by every investor session. Copy is
 * product copy; option keys are the canonical vocabularies of the Investor
 * domain (investor types, deployment states, discovery modes, constraint
 * codes) in lower_snake_case where the runtime requires it; branching is
 * data; `writesTo` names semantic targets the integration layer maps onto
 * canonical services. Nothing here is a table, a model call or a screen.
 *
 * A published version is immutable: any change to this file is v2.
 */

export const INVESTOR_JOURNEY_TYPE = "investor" as const;
export const INVESTOR_DEFINITION_VERSION = 1 as const;
export const INVESTOR_DEFINITION_NAME = "Investor onboarding" as const;

export const INVESTOR_WRITE_TARGETS = {
  bootstrap: "investor.bootstrap",
  representative: "investor.representative",
  deploymentStatus: "investor.deployment_status",
  mandateEnsure: "investor.mandate.ensure",
  mandateSelect: "investor.mandate.select",
  stageCheque: "investor.mandate.stage_cheque",
  taxonomy: "investor.mandate.taxonomy",
  businessAttributes: "investor.mandate.business_attributes",
  founderPreferences: "investor.mandate.founder_preferences",
  greenFlags: "investor.mandate.green_flags",
  exclusions: "investor.mandate.exclusions",
  portfolio: "investor.portfolio",
  discoveryMode: "investor.mandate.discovery_mode",
  rawText: "investor.mandate.raw_text",
  confirm: "investor.mandate.confirm",
} as const;

export const INVESTOR_STEP_CONTEXTS = {
  mandates: "investor.mandates",
  review: "investor.review",
  handoff: "investor.handoff",
} as const;

export const INVESTOR_PHASES = {
  I0: "I0",
  I1: "I1",
  I2: "I2",
  I3: "I3",
  I4: "I4",
  I5: "I5",
  I6: "I6",
  I7: "I7",
  I8: "I8",
  I9: "I9",
  I10: "I10",
  I11: "I11",
  I12: "I12",
} as const;

export const INVESTOR_STEPS = {
  investorType: "I0.investor_type",
  organisationName: "I0.organisation_name",
  businessTitle: "I0.business_title",
  deploymentStatus: "I1.deployment_status",
  mandateContext: "I1.mandate_context",
  stages: "I2.stages",
  currency: "I2.currency",
  chequeMin: "I2.cheque_min",
  chequeTypical: "I2.cheque_typical",
  chequeMax: "I2.cheque_max",
  investmentRole: "I2.investment_role",
  geography: "I3.geography",
  geographyStrength: "I3.geography_strength",
  sectors: "I3.sectors",
  sectorStrength: "I3.sector_strength",
  sectorsAvoid: "I3.sectors_avoid",
  businessModels: "I4.business_models",
  customerTypes: "I4.customer_types",
  capitalIntensity: "I4.capital_intensity",
  regulatoryAppetite: "I4.regulatory_appetite",
  revenueState: "I4.revenue_state",
  founderPreferences: "I5.founder_preferences",
  founderStrength: "I5.founder_strength",
  greenFlags: "I6.green_flags",
  greenFlagStrength: "I6.green_flag_strength",
  customCriteria: "I6.custom_criteria",
  avoid: "I7.avoid",
  hardExclusions: "I7.hard_exclusions",
  sectorExclusions: "I7.sector_exclusions",
  portfolio: "I8.portfolio",
  discoveryMode: "I9.discovery_mode",
  inboundPreference: "I10.inbound_preference",
  additionalContext: "I11.additional_context",
  review: "I11.review",
  handoff: "I12.handoff",
} as const;
export type InvestorStepKey =
  (typeof INVESTOR_STEPS)[keyof typeof INVESTOR_STEPS];

// ---------------------------------------------------------------------------
// Vocabularies (keys are canonical codes, lower-cased where the runtime requires)
// ---------------------------------------------------------------------------

type Option = {
  readonly optionKey: string;
  readonly label: string;
  readonly description?: string;
};

/** Keys are canonical INVESTOR_TYPES lower-cased; the handler upper-cases them. */
export const INVESTOR_TYPE_OPTIONS: Option[] = [
  { optionKey: "angel", label: "Angel investor" },
  { optionKey: "vc", label: "Venture capital fund" },
  { optionKey: "family_office", label: "Family office" },
  { optionKey: "cvc", label: "Corporate venture" },
  { optionKey: "syndicate", label: "Syndicate" },
  { optionKey: "accelerator", label: "Accelerator" },
  { optionKey: "scout", label: "Scout" },
  { optionKey: "institutional", label: "Institutional investor" },
  { optionKey: "other", label: "Something else" },
];

/** The workspace name a solo angel gets when no firm exists (I0). */
export const PERSONAL_INVESTING_WORKSPACE = "Personal Investing";

/** Keys are canonical INVESTOR_DEPLOYMENT_STATES lower-cased. Operating state, never reputation. */
export const DEPLOYMENT_STATUS_OPTIONS: Option[] = [
  {
    optionKey: "actively_investing",
    label: "Actively investing",
    description: "Deploying now.",
  },
  {
    optionKey: "selective",
    label: "Selective",
    description: "Open, but only for a strong fit.",
  },
  {
    optionKey: "paused",
    label: "Paused",
    description: "Not deploying at the moment.",
  },
  {
    optionKey: "exploring_only",
    label: "Exploring only",
    description: "Looking, not yet investing.",
  },
];

/** Canonical company_stage codes (CQ-TAX-001). */
export const STAGE_OPTIONS: Option[] = [
  { optionKey: "pre_seed", label: "Pre-seed" },
  { optionKey: "seed", label: "Seed" },
  { optionKey: "series_a", label: "Series A" },
  { optionKey: "series_b", label: "Series B" },
  { optionKey: "series_c_plus", label: "Series C or later" },
];
/** Stage order for deriving the mandate's min/max envelope. */
export const STAGE_ORDER = [
  "pre_seed",
  "seed",
  "series_a",
  "series_b",
  "series_c_plus",
] as const;

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

/** Canonical investment_role codes. */
export const INVESTMENT_ROLE_OPTIONS: Option[] = [
  { optionKey: "lead", label: "Lead rounds" },
  { optionKey: "co_invest", label: "Co-invest alongside a lead" },
  { optionKey: "follow", label: "Follow in later rounds" },
];

/** Positive strengths, product-friendly but explicit. */
export const POSITIVE_STRENGTH_OPTIONS: Option[] = [
  {
    optionKey: "must",
    label: "Must match",
    description: "A strong requirement for what you want to see.",
  },
  {
    optionKey: "strong",
    label: "Strong preference",
    description: "Counts a lot; other opportunities can still appear.",
  },
  {
    optionKey: "nice",
    label: "Nice to have",
    description: "A moderate preference.",
  },
];

export const GEOGRAPHY_VOCABULARIES = ["geography"] as const;
export const SECTOR_VOCABULARIES = ["industry", "product_category"] as const;
export const BUSINESS_MODEL_VOCABULARIES = ["business_model"] as const;
export const CUSTOMER_TYPE_VOCABULARIES = ["customer_type"] as const;

/** business.attribute codes from the Investor constraint registry. */
export const CAPITAL_INTENSITY_OPTIONS: Option[] = [
  {
    optionKey: "any",
    label: "No preference",
  },
  {
    optionKey: "capital_light",
    label: "Prefer capital-light",
    description:
      "Recorded as a strong preference for capital-light businesses.",
  },
  {
    optionKey: "avoid_hardware",
    label: "Rather not hardware-heavy",
    description:
      "Recorded as a soft avoid; hardware companies can still appear.",
  },
];
export const REGULATORY_APPETITE_OPTIONS: Option[] = [
  { optionKey: "any", label: "No preference" },
  {
    optionKey: "prefer_regulated",
    label: "Regulated markets are a plus",
    description: "Recorded as a strong preference.",
  },
  {
    optionKey: "avoid_regulated",
    label: "Rather not heavily regulated",
    description: "Recorded as a soft avoid.",
  },
];
/** Onboarding-only in v1: no numeric revenue dimension exists in the registry. */
export const REVENUE_STATE_OPTIONS: Option[] = [
  { optionKey: "pre_revenue_ok", label: "Pre-revenue is fine" },
  { optionKey: "revenue_preferred", label: "Some revenue preferred" },
  { optionKey: "revenue_required", label: "Revenue expected" },
];

/** Exactly the founder.business_attribute allowlist. Nothing personal or protected. */
export const FOUNDER_PREFERENCE_OPTIONS: Option[] = [
  {
    optionKey: "technical_founding_capability",
    label: "Technical founding capability",
  },
  { optionKey: "repeat_founder_experience", label: "Repeat founders" },
  { optionKey: "deep_domain_expertise", label: "Deep domain expertise" },
  {
    optionKey: "enterprise_sales_experience",
    label: "Enterprise sales experience",
  },
];

/** Exactly the green_flag codes. */
export const GREEN_FLAG_OPTIONS: Option[] = [
  { optionKey: "strong_revenue_growth", label: "Strong revenue growth" },
  { optionKey: "capital_efficiency", label: "Capital efficiency" },
  { optionKey: "enterprise_customers", label: "Enterprise customers" },
  { optionKey: "regulatory_moat", label: "Regulatory moat" },
  { optionKey: "repeat_founder", label: "Repeat founder" },
  { optionKey: "deep_domain_expertise", label: "Deep domain expertise" },
  { optionKey: "high_retention", label: "High retention" },
  { optionKey: "distribution_advantage", label: "Distribution advantage" },
];

/** Declared red-flag codes for v1 (bounded, lower_snake_case). */
export const RED_FLAG_OPTIONS: Option[] = [
  { optionKey: "gambling", label: "Gambling" },
  { optionKey: "tobacco", label: "Tobacco" },
  { optionKey: "weapons", label: "Weapons" },
  { optionKey: "adult_content", label: "Adult content" },
  { optionKey: "crypto_speculation", label: "Speculative crypto" },
  { optionKey: "hardware_heavy", label: "Hardware-heavy" },
  { optionKey: "pre_product", label: "Pre-product" },
  { optionKey: "single_founder", label: "Single founder" },
];

/** Canonical DISCOVERY_MODES lower-cased. */
export const DISCOVERY_MODE_OPTIONS: Option[] = [
  {
    optionKey: "strict",
    label: "Strict",
    description: "Stay close to what I've explicitly said.",
  },
  {
    optionKey: "balanced",
    label: "Balanced",
    description:
      "Mostly thesis-aligned, with selective adjacent opportunities.",
  },
  {
    optionKey: "exploratory",
    label: "Exploratory",
    description: "Show more justified outside-thesis opportunities.",
  },
];

/** INVESTOR_INBOUND_PREFERENCES lower-cased. A preference, not an active screen. */
export const INBOUND_PREFERENCE_OPTIONS: Option[] = [
  {
    optionKey: "closed",
    label: "Closed",
    description: "No unsolicited inbound.",
  },
  {
    optionKey: "qualified",
    label: "Qualified",
    description:
      "Founders may request contact once criteria you set later are met.",
  },
  {
    optionKey: "open",
    label: "Open",
    description: "Broader inbound accepted.",
  },
];

export const PORTFOLIO_MAX_ENTRIES = 5;

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

const referenceSelect = (
  phaseKey: string,
  vocabularyCodes: readonly string[],
  maxItems: number,
) => ({
  stepType: "reference_select" as const,
  phaseKey,
  resourceType: "TAXONOMY_NODE" as const,
  vocabularyCodes: [...vocabularyCodes],
  minItems: 1,
  maxItems,
});

const STEPS: readonly Omit<OnboardingStepManifest, "sequenceOrder">[] = [
  // I0 — role / organisation ---------------------------------------------
  step({
    stepKey: INVESTOR_STEPS.investorType,
    required: true,
    configuration: {
      stepType: "single_select",
      phaseKey: INVESTOR_PHASES.I0,
      prompt: "How do you invest?",
      supportingText: "This describes your organisation, not you personally.",
      options: INVESTOR_TYPE_OPTIONS,
    },
    writesTo: [],
  }),
  step({
    stepKey: INVESTOR_STEPS.organisationName,
    required: true,
    configuration: {
      stepType: "short_text",
      phaseKey: INVESTOR_PHASES.I0,
      prompt: "Your firm",
      supportingText:
        "The name investors and founders would recognise. Investing personally? Keep “Personal Investing”.",
      minLength: 1,
      maxLength: 120,
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.bootstrap }],
  }),
  step({
    stepKey: INVESTOR_STEPS.businessTitle,
    required: false,
    configuration: {
      stepType: "short_text",
      phaseKey: INVESTOR_PHASES.I0,
      prompt: "Your role there",
      supportingText:
        "Optional. A title is descriptive only; it grants no permissions.",
      minLength: 1,
      maxLength: 120,
      placeholder: "Partner, Principal, Angel",
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.representative }],
  }),

  // I1 — deployment status + mandate context ---------------------------------
  step({
    stepKey: INVESTOR_STEPS.deploymentStatus,
    required: true,
    configuration: {
      stepType: "single_select",
      phaseKey: INVESTOR_PHASES.I1,
      prompt: "Are you deploying capital right now?",
      supportingText: "An operating state you can change any time.",
      options: DEPLOYMENT_STATUS_OPTIONS,
    },
    writesTo: [
      { targetKey: INVESTOR_WRITE_TARGETS.deploymentStatus },
      // A first mandate exists before the investor is asked which one to
      // define; nothing is activated here.
      { targetKey: INVESTOR_WRITE_TARGETS.mandateEnsure },
    ],
  }),
  step({
    stepKey: INVESTOR_STEPS.mandateContext,
    required: true,
    configuration: {
      stepType: "reference_select",
      phaseKey: INVESTOR_PHASES.I1,
      prompt: "Which mandate are we defining?",
      supportingText:
        "Most investors have one. Choose the draft to continue with; nothing is activated yet.",
      resourceType: "INVESTOR_MANDATE",
      vocabularyCodes: [],
      minItems: 1,
      maxItems: 1,
      contextKey: INVESTOR_STEP_CONTEXTS.mandates,
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.mandateSelect }],
  }),

  // I2 — stage & cheque ---------------------------------------------------------
  step({
    stepKey: INVESTOR_STEPS.stages,
    required: true,
    configuration: {
      stepType: "multi_select",
      phaseKey: INVESTOR_PHASES.I2,
      prompt: "Which stages do you invest at?",
      options: STAGE_OPTIONS,
      minSelections: 1,
      maxSelections: 5,
      exclusiveOptionKeys: [],
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.stageCheque }],
  }),
  step({
    stepKey: INVESTOR_STEPS.currency,
    required: true,
    configuration: {
      stepType: "single_select",
      phaseKey: INVESTOR_PHASES.I2,
      prompt: "Cheque currency",
      options: CURRENCY_OPTIONS,
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.stageCheque }],
  }),
  step({
    stepKey: INVESTOR_STEPS.chequeMin,
    required: false,
    configuration: {
      stepType: "range",
      phaseKey: INVESTOR_PHASES.I2,
      prompt: "Minimum cheque",
      min: "0",
      max: "1000000000000",
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.stageCheque }],
  }),
  step({
    stepKey: INVESTOR_STEPS.chequeTypical,
    required: false,
    configuration: {
      stepType: "range",
      phaseKey: INVESTOR_PHASES.I2,
      prompt: "Typical cheque",
      min: "0",
      max: "1000000000000",
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.stageCheque }],
  }),
  step({
    stepKey: INVESTOR_STEPS.chequeMax,
    required: false,
    configuration: {
      stepType: "range",
      phaseKey: INVESTOR_PHASES.I2,
      prompt: "Maximum cheque",
      min: "0",
      max: "1000000000000",
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.stageCheque }],
  }),
  step({
    stepKey: INVESTOR_STEPS.investmentRole,
    required: false,
    configuration: {
      stepType: "multi_select",
      phaseKey: INVESTOR_PHASES.I2,
      prompt: "How do you usually take part?",
      options: INVESTMENT_ROLE_OPTIONS,
      minSelections: 1,
      maxSelections: 3,
      exclusiveOptionKeys: [],
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.stageCheque }],
  }),

  // I3 — geography & sectors ------------------------------------------------------
  step({
    stepKey: INVESTOR_STEPS.geography,
    required: false,
    configuration: {
      ...referenceSelect(INVESTOR_PHASES.I3, GEOGRAPHY_VOCABULARIES, 20),
      prompt: "Where do you invest?",
      supportingText: "Regions or countries. Leave empty for anywhere.",
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.taxonomy }],
  }),
  step({
    stepKey: INVESTOR_STEPS.geographyStrength,
    required: false,
    branching: { op: "EXISTS", stepKey: INVESTOR_STEPS.geography },
    configuration: {
      stepType: "single_select",
      phaseKey: INVESTOR_PHASES.I3,
      prompt: "How firm is that?",
      options: POSITIVE_STRENGTH_OPTIONS,
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.taxonomy }],
  }),
  step({
    stepKey: INVESTOR_STEPS.sectors,
    required: false,
    configuration: {
      ...referenceSelect(INVESTOR_PHASES.I3, SECTOR_VOCABULARIES, 20),
      prompt: "Which sectors and product areas?",
      supportingText:
        "Suggested categories come from your own words; only what you keep is recorded.",
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.taxonomy }],
  }),
  step({
    stepKey: INVESTOR_STEPS.sectorStrength,
    required: false,
    branching: { op: "EXISTS", stepKey: INVESTOR_STEPS.sectors },
    configuration: {
      stepType: "single_select",
      phaseKey: INVESTOR_PHASES.I3,
      prompt: "How firm is that?",
      options: POSITIVE_STRENGTH_OPTIONS,
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.taxonomy }],
  }),
  step({
    stepKey: INVESTOR_STEPS.sectorsAvoid,
    required: false,
    configuration: {
      ...referenceSelect(INVESTOR_PHASES.I3, SECTOR_VOCABULARIES, 20),
      prompt: "Sectors you'd rather not see",
      supportingText:
        "A soft preference: these can still appear. Hard exclusions come later.",
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.taxonomy }],
  }),

  // I4 — business attributes ------------------------------------------------------
  step({
    stepKey: INVESTOR_STEPS.businessModels,
    required: false,
    configuration: {
      ...referenceSelect(INVESTOR_PHASES.I4, BUSINESS_MODEL_VOCABULARIES, 10),
      prompt: "Business models you back",
      supportingText: "Recorded as a strong preference.",
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.taxonomy }],
  }),
  step({
    stepKey: INVESTOR_STEPS.customerTypes,
    required: false,
    configuration: {
      ...referenceSelect(INVESTOR_PHASES.I4, CUSTOMER_TYPE_VOCABULARIES, 10),
      prompt: "Customer types you back",
      supportingText: "Recorded as a strong preference.",
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.taxonomy }],
  }),
  step({
    stepKey: INVESTOR_STEPS.capitalIntensity,
    required: false,
    configuration: {
      stepType: "single_select",
      phaseKey: INVESTOR_PHASES.I4,
      prompt: "Capital intensity",
      options: CAPITAL_INTENSITY_OPTIONS,
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.businessAttributes }],
  }),
  step({
    stepKey: INVESTOR_STEPS.regulatoryAppetite,
    required: false,
    configuration: {
      stepType: "single_select",
      phaseKey: INVESTOR_PHASES.I4,
      prompt: "Regulated markets",
      options: REGULATORY_APPETITE_OPTIONS,
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.businessAttributes }],
  }),
  step({
    stepKey: INVESTOR_STEPS.revenueState,
    required: false,
    configuration: {
      stepType: "single_select",
      phaseKey: INVESTOR_PHASES.I4,
      prompt: "Revenue expectations",
      supportingText:
        "Kept with your onboarding answers for now; it becomes structured policy when thresholds are supported.",
      options: REVENUE_STATE_OPTIONS,
    },
    writesTo: [],
  }),

  // I5 — founder / business-relevant preferences (optional) ----------------------
  step({
    stepKey: INVESTOR_STEPS.founderPreferences,
    required: false,
    configuration: {
      stepType: "multi_select",
      phaseKey: INVESTOR_PHASES.I5,
      prompt: "Founding-team capabilities that matter to you",
      supportingText:
        "Investment-relevant capabilities only. Personal characteristics are never criteria.",
      options: FOUNDER_PREFERENCE_OPTIONS,
      minSelections: 1,
      maxSelections: 4,
      exclusiveOptionKeys: [],
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.founderPreferences }],
  }),
  step({
    stepKey: INVESTOR_STEPS.founderStrength,
    required: false,
    branching: { op: "EXISTS", stepKey: INVESTOR_STEPS.founderPreferences },
    configuration: {
      stepType: "single_select",
      phaseKey: INVESTOR_PHASES.I5,
      prompt: "How firm is that?",
      options: POSITIVE_STRENGTH_OPTIONS,
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.founderPreferences }],
  }),

  // I6 — green flags -------------------------------------------------------------------
  step({
    stepKey: INVESTOR_STEPS.greenFlags,
    required: false,
    configuration: {
      stepType: "multi_select",
      phaseKey: INVESTOR_PHASES.I6,
      prompt: "Green flags",
      supportingText:
        "Positive signals you weigh. Recorded as strong preferences unless you change the strength.",
      options: GREEN_FLAG_OPTIONS,
      minSelections: 1,
      maxSelections: 8,
      exclusiveOptionKeys: [],
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.greenFlags }],
  }),
  step({
    stepKey: INVESTOR_STEPS.greenFlagStrength,
    required: false,
    branching: { op: "EXISTS", stepKey: INVESTOR_STEPS.greenFlags },
    configuration: {
      stepType: "single_select",
      phaseKey: INVESTOR_PHASES.I6,
      prompt: "How firm are those?",
      options: POSITIVE_STRENGTH_OPTIONS,
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.greenFlags }],
  }),
  step({
    stepKey: INVESTOR_STEPS.customCriteria,
    required: false,
    configuration: {
      stepType: "long_text",
      phaseKey: INVESTOR_PHASES.I6,
      prompt: "Anything else you look for?",
      supportingText:
        "In your own words. Kept for people to read; it never becomes an automatic filter.",
      minLength: 1,
      maxLength: 1000,
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.greenFlags }],
  }),

  // I7 — red flags / hard exclusions --------------------------------------------------
  step({
    stepKey: INVESTOR_STEPS.avoid,
    required: false,
    configuration: {
      stepType: "multi_select",
      phaseKey: INVESTOR_PHASES.I7,
      prompt: "I'd rather not see",
      supportingText:
        "A soft negative: these can still appear, ranked lower. Nothing is hidden.",
      options: RED_FLAG_OPTIONS,
      minSelections: 1,
      maxSelections: 8,
      exclusiveOptionKeys: [],
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.exclusions }],
  }),
  step({
    stepKey: INVESTOR_STEPS.hardExclusions,
    required: false,
    configuration: {
      stepType: "multi_select",
      phaseKey: INVESTOR_PHASES.I7,
      prompt: "Never show me",
      supportingText:
        "A hard exclusion: opportunities matching these are not shown in standard discovery, whatever the discovery style.",
      options: RED_FLAG_OPTIONS,
      minSelections: 1,
      maxSelections: 8,
      exclusiveOptionKeys: [],
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.exclusions }],
  }),
  step({
    stepKey: INVESTOR_STEPS.sectorExclusions,
    required: false,
    configuration: {
      ...referenceSelect(INVESTOR_PHASES.I7, SECTOR_VOCABULARIES, 20),
      prompt: "Sectors to exclude outright",
      supportingText:
        "A hard exclusion, not a preference: companies in these categories are not shown in standard discovery.",
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.taxonomy }],
  }),

  // I8 — portfolio context (optional) -----------------------------------------------------
  step({
    stepKey: INVESTOR_STEPS.portfolio,
    required: false,
    configuration: {
      stepType: "long_text",
      phaseKey: INVESTOR_PHASES.I8,
      prompt: "A few representative portfolio companies",
      supportingText:
        "One per line, up to five. Names only; nothing is looked up or linked.",
      minLength: 1,
      maxLength: 1200,
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.portfolio }],
  }),

  // I9 — discovery style ---------------------------------------------------------------
  step({
    stepKey: INVESTOR_STEPS.discoveryMode,
    required: true,
    configuration: {
      stepType: "single_select",
      phaseKey: INVESTOR_PHASES.I9,
      prompt: "How adventurous should discovery be?",
      supportingText: "Hard exclusions always apply, whichever you choose.",
      options: DISCOVERY_MODE_OPTIONS,
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.discoveryMode }],
  }),

  // I10 — inbound preference (typed placeholder; GateQ later) ---------------------------
  step({
    stepKey: INVESTOR_STEPS.inboundPreference,
    required: true,
    configuration: {
      stepType: "single_select",
      phaseKey: INVESTOR_PHASES.I10,
      prompt: "How should founders reach you?",
      supportingText:
        "Your preference for now. Screening rules are set up later; nothing is enforced yet.",
      options: INBOUND_PREFERENCE_OPTIONS,
    },
    writesTo: [],
  }),

  // I11 — review / confirmation ------------------------------------------------------------
  step({
    stepKey: INVESTOR_STEPS.additionalContext,
    required: false,
    configuration: {
      stepType: "long_text",
      phaseKey: INVESTOR_PHASES.I11,
      prompt: "Add something we missed",
      supportingText:
        "Optional context in your own words. Stored with the mandate for people to read; the structured criteria above stay authoritative.",
      minLength: 1,
      maxLength: 4000,
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.rawText }],
  }),
  step({
    stepKey: INVESTOR_STEPS.review,
    required: true,
    configuration: {
      stepType: "confirmation",
      phaseKey: INVESTOR_PHASES.I11,
      prompt: "Here's the mandate you've defined",
      supportingText:
        "Everything below is what you set. Confirming activates this mandate; it changes nothing about who can see it.",
      confirmLabel: "Looks right",
      requireAffirmative: true,
      contextKey: INVESTOR_STEP_CONTEXTS.review,
    },
    writesTo: [{ targetKey: INVESTOR_WRITE_TARGETS.confirm }],
  }),

  // I12 — handoff ------------------------------------------------------------------------------
  step({
    stepKey: INVESTOR_STEPS.handoff,
    required: true,
    configuration: {
      stepType: "confirmation",
      phaseKey: INVESTOR_PHASES.I12,
      prompt: "Your mandate is ready",
      supportingText:
        "Capital Q now has the structured criteria needed to generate your opportunities.",
      confirmLabel: "Go to Discover",
      requireAffirmative: true,
      contextKey: INVESTOR_STEP_CONTEXTS.handoff,
    },
    writesTo: [],
  }),
];

export const INVESTOR_DEFINITION_V1: OnboardingDefinitionManifest = {
  journeyType: INVESTOR_JOURNEY_TYPE,
  name: INVESTOR_DEFINITION_NAME,
  version: INVESTOR_DEFINITION_VERSION,
  schema: {
    schemaVersion: 1,
    phases: [
      { phaseKey: INVESTOR_PHASES.I0, label: "Role" },
      { phaseKey: INVESTOR_PHASES.I1, label: "Deployment" },
      { phaseKey: INVESTOR_PHASES.I2, label: "Stage and cheque" },
      { phaseKey: INVESTOR_PHASES.I3, label: "Geography and sectors" },
      { phaseKey: INVESTOR_PHASES.I4, label: "Business attributes" },
      { phaseKey: INVESTOR_PHASES.I5, label: "Founding team" },
      { phaseKey: INVESTOR_PHASES.I6, label: "Green flags" },
      { phaseKey: INVESTOR_PHASES.I7, label: "Red flags" },
      { phaseKey: INVESTOR_PHASES.I8, label: "Portfolio" },
      { phaseKey: INVESTOR_PHASES.I9, label: "Discovery style" },
      { phaseKey: INVESTOR_PHASES.I10, label: "Inbound" },
      { phaseKey: INVESTOR_PHASES.I11, label: "Review" },
      { phaseKey: INVESTOR_PHASES.I12, label: "Handoff" },
    ],
    // An investor starts before any organisation exists; I0 binds the investor organisation.
    runtime: { subjectType: "INVESTOR_ORGANISATION", allowUnboundStart: true },
  },
  steps: STEPS.map((definition, sequenceOrder) => ({
    ...definition,
    sequenceOrder,
  })),
};
