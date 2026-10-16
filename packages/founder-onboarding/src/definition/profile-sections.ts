/**
 * The founder company profile, section by section (owner template,
 * 2026-10-16): the ONE versioned list both lanes read. Lane ov renders the
 * company Overview from it; founder onboarding (lane ob1) uses it for
 * coverage, so Q fills each section from the deck, then the pitch
 * transcript, and asks only for what neither answered.
 *
 * A section is held by journey steps: Our Team and Our Ask by the steps that
 * already collect them (F4, F6), every other section by its own optional
 * long-text step in founder definition v6 (phase F9). `factKey` is what the
 * document and transcript reading proposes for it. A change to the template
 * is a new version here (and a new definition version where steps change);
 * nothing else keeps its own copy.
 */

export const FOUNDER_PROFILE_SECTIONS_VERSION =
  "founder-profile-sections-2026-10-16.1" as const;

/** Where a section's content may come from, in the order Q tries them. */
export const FOUNDER_PROFILE_SECTION_SOURCES = [
  "DECK",
  "PITCH_TRANSCRIPT",
  "QUESTION",
] as const;
export type FounderProfileSectionSource =
  (typeof FOUNDER_PROFILE_SECTION_SOURCES)[number];

export type FounderProfileSection = {
  /** Stable key; never shown. */
  readonly key: string;
  /** The owner's wording, as the Overview shows it. */
  readonly title: string;
  /** Position in the Overview (1-based, the template's order). */
  readonly order: number;
  /**
   * What investors need first (1 = first): the order Q asks for gaps in.
   * Not the display order.
   */
  readonly investorRank: number;
  /** False: filled from the deck or transcript only, never asked as a gap. */
  readonly askable: boolean;
  /** The journey steps that hold this section's content. */
  readonly stepKeys: readonly string[];
  /** The fact key document and transcript reading proposes for it; null when its steps' own facts cover it. */
  readonly factKey: string | null;
  /** How Q asks for it when nothing else answered it. */
  readonly question: string | null;
};

/** The v6 step that holds a section of its own. */
export const FOUNDER_PROFILE_STEPS = {
  opportunity: "F9.opportunity",
  problem: "F9.problem",
  solution: "F9.solution",
  howItWorks: "F9.how_it_works",
  businessModel: "F9.business_model",
  vision: "F9.vision",
  goToMarket: "F9.go_to_market",
  competition: "F9.competition",
  moats: "F9.moats",
  roadmap: "F9.roadmap",
  whyUsWhyNow: "F9.why_us_why_now",
  closing: "F9.closing",
} as const;

const TEAM_STEPS = [
  "F4.founder_role",
  "F4.founder_count",
  "F4.full_time",
  "F4.team_size",
  "F4.functions",
] as const;
const ASK_STEPS = [
  "F6.raising",
  "F6.currency",
  "F6.target_amount",
  "F6.instrument",
  "F6.timeframe",
  "F6.use_of_funds",
] as const;

export const FOUNDER_PROFILE_SECTIONS: readonly FounderProfileSection[] = [
  {
    key: "opportunity",
    title: "Opportunity and Economics",
    order: 1,
    investorRank: 5,
    askable: true,
    stepKeys: [FOUNDER_PROFILE_STEPS.opportunity],
    factKey: "opportunity",
    question:
      "How big is the opportunity, and how do the economics work for you?",
  },
  {
    key: "problem",
    title: "The Problem",
    order: 2,
    investorRank: 1,
    askable: true,
    stepKeys: [FOUNDER_PROFILE_STEPS.problem],
    factKey: "problem",
    question: "What problem are you solving, and for whom?",
  },
  {
    key: "solution",
    title: "Solution",
    order: 3,
    investorRank: 2,
    askable: true,
    stepKeys: [FOUNDER_PROFILE_STEPS.solution],
    factKey: "solution",
    question: "What is your solution?",
  },
  {
    key: "how_it_works",
    title: "How It Works",
    order: 4,
    investorRank: 11,
    askable: true,
    stepKeys: [FOUNDER_PROFILE_STEPS.howItWorks],
    factKey: "how_it_works",
    question: "Briefly, how does it work?",
  },
  {
    key: "business_model",
    title: "Business Model",
    order: 5,
    investorRank: 4,
    askable: true,
    stepKeys: [FOUNDER_PROFILE_STEPS.businessModel],
    factKey: "business_model",
    question: "How do you make money?",
  },
  {
    key: "vision",
    title: "Our Vision",
    order: 6,
    investorRank: 13,
    askable: true,
    stepKeys: [FOUNDER_PROFILE_STEPS.vision],
    factKey: "vision",
    question: "What is your long-term vision for the company?",
  },
  {
    key: "team",
    title: "Our Team",
    order: 7,
    investorRank: 6,
    askable: true,
    stepKeys: TEAM_STEPS,
    factKey: null,
    question: null,
  },
  {
    key: "go_to_market",
    title: "Go-to-Market Strategy",
    order: 8,
    investorRank: 8,
    askable: true,
    stepKeys: [FOUNDER_PROFILE_STEPS.goToMarket],
    factKey: "go_to_market",
    question: "How do you reach and win customers?",
  },
  {
    key: "competition",
    title: "Competitive Landscape",
    order: 9,
    investorRank: 9,
    askable: true,
    stepKeys: [FOUNDER_PROFILE_STEPS.competition],
    factKey: "competition",
    question: "Who else is solving this, and how are you different?",
  },
  {
    key: "moats",
    title: "Moats",
    order: 10,
    investorRank: 10,
    askable: true,
    stepKeys: [FOUNDER_PROFILE_STEPS.moats],
    factKey: "moats",
    question: "What makes your position hard to copy?",
  },
  {
    key: "roadmap",
    title: "Roadmap",
    order: 11,
    investorRank: 12,
    askable: true,
    stepKeys: [FOUNDER_PROFILE_STEPS.roadmap],
    factKey: "roadmap",
    question: "What are the next milestones on your roadmap?",
  },
  {
    key: "why_us_why_now",
    title: "Why Us? Why Now?",
    order: 12,
    investorRank: 7,
    askable: true,
    stepKeys: [FOUNDER_PROFILE_STEPS.whyUsWhyNow],
    factKey: "why_us_why_now",
    question: "Why are you the team to do this, and why now?",
  },
  {
    key: "ask",
    title: "Our Ask",
    order: 13,
    investorRank: 3,
    askable: true,
    stepKeys: ASK_STEPS,
    factKey: null,
    question: null,
  },
  {
    // Owner: optional, and never asked as a gap.
    key: "closing",
    title: "Closing",
    order: 14,
    investorRank: 14,
    askable: false,
    stepKeys: [FOUNDER_PROFILE_STEPS.closing],
    factKey: "closing",
    question: null,
  },
];

/** The section a step holds, if any. */
export function founderProfileSectionOf(
  stepKey: string,
): FounderProfileSection | undefined {
  return FOUNDER_PROFILE_SECTIONS.find((section) =>
    section.stepKeys.includes(stepKey),
  );
}
