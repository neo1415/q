import type { ChoiceOption } from "@capital-q/ui/choice-list";
import type { CurrencyOption } from "@capital-q/ui/money-input";

import type {
  AssetTypeOption,
  FactView,
  MetricQuestion,
} from "../models/presentation";

/**
 * Synthetic development content for the founder onboarding fixture.
 *
 * "NexaRail Technologies" is an invented company. Nothing here is derived
 * from a real founder, customer, investor or document, and every value that
 * reaches a screen is labelled as synthetic by the fixture adapter.
 */

export const FIXTURE_COMPANY_NAME = "NexaRail Technologies";

/** UI-only provisional allow-list until the evidence contract owns policy. */
export const PROVISIONAL_ACCEPTED_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".pptx",
  ".txt",
  ".md",
] as const;

export const INTENT_OPTIONS: readonly ChoiceOption[] = [
  {
    value: "raising",
    label: "I'm raising for a company",
    description: "There is a round in motion or about to be.",
  },
  {
    value: "preparing",
    label: "I'm preparing to raise",
    description: "Getting the company and the story ready first.",
  },
  {
    value: "exploring",
    label: "I'm exploring Capital Q",
    description: "Curious what Q can see before committing.",
  },
];

export const STAGE_OPTIONS: readonly ChoiceOption[] = [
  { value: "pre_seed", label: "Pre-seed" },
  { value: "seed", label: "Seed" },
  { value: "series_a", label: "Series A" },
  { value: "series_b_plus", label: "Series B or later" },
  { value: "unsure", label: "Not sure yet" },
];

/** Compact reference list for the fixture; real reference data is server-side. */
export const COUNTRY_OPTIONS: readonly ChoiceOption[] = [
  { value: "NG", label: "Nigeria" },
  { value: "KE", label: "Kenya" },
  { value: "ZA", label: "South Africa" },
  { value: "GH", label: "Ghana" },
  { value: "EG", label: "Egypt" },
  { value: "GB", label: "United Kingdom" },
  { value: "US", label: "United States" },
  { value: "DE", label: "Germany" },
  { value: "FR", label: "France" },
  { value: "NL", label: "Netherlands" },
  { value: "AE", label: "United Arab Emirates" },
  { value: "IN", label: "India" },
  { value: "SG", label: "Singapore" },
  { value: "BR", label: "Brazil" },
  { value: "CA", label: "Canada" },
  { value: "OTHER", label: "Somewhere else" },
];

export const CURRENCIES: readonly CurrencyOption[] = [
  { code: "USD", label: "US dollar" },
  { code: "EUR", label: "Euro" },
  { code: "GBP", label: "Pound sterling" },
  { code: "NGN", label: "Nigerian naira" },
  { code: "KES", label: "Kenyan shilling" },
  { code: "ZAR", label: "South African rand" },
  { code: "AED", label: "UAE dirham" },
  { code: "INR", label: "Indian rupee" },
  { code: "SGD", label: "Singapore dollar" },
];

export const ASSET_TYPES: readonly AssetTypeOption[] = [
  { value: "pitch_deck", label: "Pitch deck", uploadable: true },
  {
    value: "financial_model",
    label: "Financial model",
    description:
      "Spreadsheets can be selected now; Q reads them in a later release.",
    uploadable: true,
  },
  {
    value: "management_accounts",
    label: "Management accounts",
    uploadable: true,
  },
  {
    value: "company_profile",
    label: "Company profile or memo",
    uploadable: true,
  },
  { value: "other", label: "Something else", uploadable: true },
  {
    value: "nothing",
    label: "Nothing yet",
    description: "That's fine. Q starts from what you tell it.",
    uploadable: false,
  },
];

export const FOUNDER_COUNT_OPTIONS: readonly ChoiceOption[] = [
  { value: "1", label: "Just me" },
  { value: "2", label: "Two founders" },
  { value: "3", label: "Three founders" },
  { value: "4_plus", label: "Four or more" },
];

export const FULL_TIME_OPTIONS: readonly ChoiceOption[] = [
  { value: "all", label: "All founders are full-time" },
  { value: "some", label: "Some founders are full-time" },
  { value: "none", label: "Not full-time yet" },
];

export const ROLE_OPTIONS: readonly ChoiceOption[] = [
  { value: "ceo", label: "CEO" },
  { value: "cto", label: "CTO" },
  { value: "coo", label: "COO" },
  { value: "cpo", label: "Product" },
  { value: "other", label: "Something else" },
];

export const FUNCTION_OPTIONS: readonly ChoiceOption[] = [
  { value: "product", label: "Product" },
  { value: "engineering", label: "Engineering" },
  { value: "sales", label: "Sales and partnerships" },
  { value: "operations", label: "Operations" },
  { value: "finance", label: "Finance" },
  { value: "domain", label: "Deep industry expertise" },
];

export const TEAM_SIZE_OPTIONS: readonly ChoiceOption[] = [
  { value: "founders_only", label: "Founders only" },
  { value: "2_5", label: "2–5 people" },
  { value: "6_15", label: "6–15 people" },
  { value: "16_50", label: "16–50 people" },
  { value: "50_plus", label: "More than 50" },
];

export const PRE_REVENUE_METRICS: readonly MetricQuestion[] = [
  {
    id: "signal",
    label: "What early signal do you have?",
    kind: "choice",
    optional: false,
    options: [
      { value: "pilots", label: "Pilots running" },
      { value: "lois", label: "Signed letters of intent" },
      { value: "waitlist", label: "A waitlist" },
      { value: "users", label: "Active users, not yet paying" },
      { value: "none", label: "Nothing measurable yet" },
    ],
  },
  {
    id: "pilots",
    label: "How many pilots or design partners?",
    kind: "number",
    optional: true,
  },
  {
    id: "partnerships",
    label: "Committed partnerships",
    kind: "number",
    optional: true,
    help: "Signed, not in discussion.",
  },
];

export const REVENUE_METRICS: readonly MetricQuestion[] = [
  {
    id: "revenue_status",
    label: "How would you describe revenue today?",
    kind: "choice",
    optional: false,
    options: [
      { value: "recurring", label: "Recurring and growing" },
      { value: "recurring_flat", label: "Recurring, roughly flat" },
      { value: "project", label: "Project or one-off revenue" },
      { value: "early", label: "First revenue only" },
    ],
  },
  {
    id: "arr",
    label: "Annual recurring revenue",
    kind: "money",
    optional: true,
    help: "Last twelve months, as booked.",
  },
  {
    id: "customers",
    label: "Paying customers",
    kind: "number",
    optional: true,
  },
  {
    id: "growth",
    label: "Growth over the last six months",
    kind: "choice",
    optional: true,
    options: [
      { value: "over_100", label: "More than doubled" },
      { value: "50_100", label: "Grew 50–100%" },
      { value: "under_50", label: "Grew under 50%" },
      { value: "flat", label: "Flat or down" },
    ],
  },
];

export const RAISING_OPTIONS: readonly ChoiceOption[] = [
  { value: "active", label: "Yes, actively" },
  { value: "preparing", label: "Preparing to raise" },
  { value: "not_now", label: "Not right now" },
];

export const INSTRUMENT_OPTIONS: readonly ChoiceOption[] = [
  { value: "priced", label: "Priced equity round" },
  { value: "safe", label: "SAFE" },
  { value: "convertible", label: "Convertible note" },
  { value: "unsure", label: "Not sure yet" },
];

export const TIMEFRAME_OPTIONS: readonly ChoiceOption[] = [
  { value: "under_3", label: "Within 3 months" },
  { value: "3_6", label: "3–6 months" },
  { value: "6_12", label: "6–12 months" },
  { value: "unsure", label: "Not sure yet" },
];

export const USE_OF_FUNDS_OPTIONS: readonly ChoiceOption[] = [
  { value: "product", label: "Product and engineering" },
  { value: "hiring", label: "Key hires" },
  { value: "gtm", label: "Sales and go-to-market" },
  { value: "runway", label: "Runway and operations" },
  { value: "expansion", label: "New markets" },
];

/** What "Q found" when a deck was provided. Synthetic. */
export const DECK_FACTS: readonly FactView[] = [
  {
    id: "building",
    label: "You are building",
    value: "Claims-automation infrastructure for insurers",
    evidence: "from_document",
    evidenceDetail: "deck, page 2",
    verdict: "suggested",
  },
  {
    id: "customer",
    label: "Primary customer",
    value: "Mid-sized general insurers",
    evidence: "from_document",
    evidenceDetail: "deck, page 5",
    verdict: "suggested",
  },
  {
    id: "model",
    label: "Business model",
    value: "B2B SaaS subscription plus API usage",
    evidence: "from_document",
    evidenceDetail: "deck, page 7",
    verdict: "suggested",
  },
  {
    id: "stage",
    label: "Current stage",
    value: "Seed",
    evidence: "from_founder",
    verdict: "suggested",
  },
  {
    id: "traction",
    label: "Key traction",
    value: "45 customers referenced; 31 active accounts in a separate figure",
    evidence: "needs_confirmation",
    evidenceDetail: "deck, pages 9 and 12",
    verdict: "suggested",
  },
];

/** What "Q found" from the founder's own words only. Synthetic. */
export const DESCRIPTION_FACTS: readonly FactView[] = [
  {
    id: "building",
    label: "You are building",
    value: "Claims-automation infrastructure for insurers",
    evidence: "from_founder",
    verdict: "suggested",
  },
  {
    id: "customer",
    label: "Primary customer",
    value: "",
    evidence: "needs_evidence",
    verdict: "missing",
  },
  {
    id: "model",
    label: "Business model",
    value: "",
    evidence: "needs_evidence",
    verdict: "missing",
  },
  {
    id: "stage",
    label: "Current stage",
    value: "Seed",
    evidence: "from_founder",
    verdict: "suggested",
  },
];

export const TAXONOMY_SUGGESTIONS = [
  "Insurance Technology",
  "Claims Automation",
  "B2B Software",
  "API Infrastructure",
] as const;

export const CLARIFICATION_WITH_DECK = {
  observation:
    "Your deck mentions 45 customers on page 9, while page 12 lists 31 active accounts.",
  question: "Which number represents current paying customers?",
  why: "Investors read these two figures very differently, and a clean answer now avoids a harder conversation later.",
  options: [
    { value: "45", label: "45 paying customers" },
    {
      value: "31",
      label: "31 paying customers",
      description: "The other figure includes trials or churned accounts.",
    },
    {
      value: "other",
      label: "A different number",
      description: "Tell Q what the current figure is.",
    },
  ],
} as const;

export const CLARIFICATION_WITHOUT_DECK = {
  observation:
    "Nothing in your answers conflicts so far, and there is no document to check them against yet.",
  question:
    "What is the one thing an investor should know that you haven't told Q?",
  why: "Q uses this to decide what to ask for evidence on first.",
  options: [],
} as const;
