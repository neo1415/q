/**
 * Rehearsal modes for researched external entities. Each mode has its own
 * opening, topic directions, follow-up behaviour and scoring focus, so the
 * Shadi Qishta, QInvest, Muhannad Taslaq, Invest Qatar and AlRayan
 * rehearsals are different conversations, not one template with a name.
 *
 * A mode holds DIRECTIONS (what a counterpart of this kind probes), never
 * facts about the entity and never words attributed to it: facts and quotes
 * arrive only as sourced public evidence (PersonBrief), and a source quote
 * is shown beside the rehearsal, never put in the persona's mouth.
 *
 * Organisations (and agencies) are played as a clearly labelled synthetic
 * role, "not a real employee"; people as a research-informed simulation of
 * their public priorities. Nothing about voice, accent or face is derived
 * from a name or nationality.
 */

export type EntityKind = "PERSON" | "ORGANIZATION" | "GOVERNMENT_AGENCY";

export type Direction = {
  readonly key: string;
  /** Short, for priorities and the scoring focus. */
  readonly label: string;
  /** How the counterpart raises it, in the founder's terms. */
  readonly question: (company: string) => string;
  /** What the counterpart presses on when the answer is thin. */
  readonly pressure: string;
  /** Where the founder's words are checked for coverage. */
  readonly keywords: RegExp;
};

export type Scenario = {
  readonly id: string;
  readonly entityKind: EntityKind;
  /** Lower-case alphanumeric aliases the subject is matched on. */
  readonly aliases: readonly string[];
  /** Organisations only: the synthetic role played, without an article. */
  readonly roleLine: string | null;
  /** First thing the counterpart opens on, in order. */
  readonly openingThemes: readonly string[];
  readonly directions: readonly Direction[];
  /** How this counterpart follows up and challenges. */
  readonly followUp: readonly string[];
  readonly family: "INVESTOR" | "EXECUTIVE";
};

const k = (words: string) => new RegExp(`\\b(?:${words})`, "iu");

const SHADI: Scenario = {
  id: "SHADI_QISHTA",
  entityKind: "PERSON",
  aliases: ["shadiqishta"],
  roleLine: null,
  family: "EXECUTIVE",
  openingThemes: [
    "who actually pays for this and whether they can keep paying",
    "how reliable the financial picture is",
  ],
  directions: [
    {
      key: "strategic_finance",
      label: "Strategic finance",
      question: (c) =>
        `How have you built the financial plan for ${c}, and what has to be true for it to hold?`,
      pressure: "a plan with no stated assumptions",
      keywords: k("financial plan|forecast|budget|cash flow|assumption|financ"),
    },
    {
      key: "purchasing_power",
      label: "Consumer purchasing power",
      question: () =>
        "What shows your customers can afford this and will keep paying for it?",
      pressure: "demand claimed from broad market figures rather than spending",
      keywords: k("afford|purchasing power|spend|willing(?:ness)? to pay|disposable|price sensitiv|customers? pay"),
    },
    {
      key: "financial_transparency",
      label: "Financial transparency",
      question: () =>
        "How reliable are your numbers, who checks them, and how comparable are they to a standard report?",
      pressure: "unaudited or unreconciled figures",
      keywords: k("audit|ifrs|reconcil|transparen|report(?:ing)?|accounts|books"),
    },
    {
      key: "commercial_viability",
      label: "Commercial viability",
      question: () =>
        "Show me the unit economics: does each customer make money, and from when?",
      pressure: "growth with no path to profit",
      keywords: k("unit economics|margin|profitab|break.?even|cac|ltv|payback"),
    },
    {
      key: "partnerships",
      label: "Partnerships",
      question: (c) =>
        `Which partner makes ${c}'s plan executable, and what do they get out of it?`,
      pressure: "a partnership named but not agreed",
      keywords: k("partner|distribution|channel|alliance|integrat|reseller"),
    },
    {
      key: "digital_transformation",
      label: "Digital transformation",
      question: () =>
        "What practical change does the technology make for the customer, beyond the label?",
      pressure: "technology described without a measurable result",
      keywords: k("digital|automat|technology|platform|data|ai\\b|software"),
    },
  ],
  followUp: [
    "Turn every broad claim into a question about money actually spent or saved.",
    "If a figure is quoted, ask where it comes from and who verified it.",
    "Move on only once the commercial answer is specific.",
  ],
};

const QINVEST: Scenario = {
  id: "QINVEST",
  entityKind: "ORGANIZATION",
  aliases: ["qinvest", "qinvestllc", "qinvestqatar"],
  roleLine: "QInvest investment professional",
  family: "INVESTOR",
  openingThemes: [
    "the exact financing structure on the table and whether it is Sharia-compliant",
    "the downside case and how capital is protected",
  ],
  directions: [
    {
      key: "sharia_financing",
      label: "Sharia-compliant financing",
      question: () =>
        "What exact structure are you proposing, and how is it Sharia-compliant?",
      pressure: "a structure described only as 'standard'",
      keywords: k("sharia|islamic|murabaha|ijara|sukuk|musharaka|compliant"),
    },
    {
      key: "risk_returns",
      label: "Risk and returns",
      question: () =>
        "What supports your return assumptions, and what happens in the downside case?",
      pressure: "returns shown without a downside",
      keywords: k("return|irr|yield|downside|risk|sensitiv|scenario"),
    },
    {
      key: "structures",
      label: "Deal structure",
      question: () =>
        "How are the sources and uses of funds laid out, and where do we sit in the structure?",
      pressure: "uses of funds that are vague",
      keywords: k("sources and uses|use of funds|structure|tranche|seniority|security|collateral|mezzanine"),
    },
    {
      key: "asset_classes",
      label: "Credit, equity and asset management",
      question: () =>
        "Is this a credit, equity or asset-backed proposition, and why that form?",
      pressure: "an instrument chosen without reasons",
      keywords: k("credit|equity|debt|asset|fund|portfolio|mandate"),
    },
    {
      key: "governance",
      label: "Governance",
      question: () =>
        "What governance and reporting would we have, and what risks remain unresolved?",
      pressure: "no board, covenants or reporting rights discussed",
      keywords: k("governance|board|covenant|reporting|control|oversight|compliance"),
    },
    {
      key: "exits",
      label: "Exits and repayment",
      question: () => "What is the exit or repayment mechanism, and when?",
      pressure: "an exit that depends on a hoped-for event",
      keywords: k("exit|repay|redemption|ipo|buyback|refinanc|maturity"),
    },
  ],
  followUp: [
    "Ask for the structure in plain terms before discussing anything else.",
    "Every return figure gets 'and in the downside?'.",
    "Probe governance and repayment last, firmly, if they were skipped.",
  ],
};

const MUHANNAD: Scenario = {
  id: "MUHANNAD_TASLAQ",
  entityKind: "PERSON",
  aliases: ["muhannadtaslaq"],
  roleLine: null,
  family: "INVESTOR",
  openingThemes: [
    "whether the founder is fully committed to this one venture",
    "what has actually shipped and who is using it",
  ],
  directions: [
    {
      key: "founder_conviction",
      label: "Founder conviction",
      question: (c) =>
        `Is ${c} the one thing you are building, and what would make you stop?`,
      pressure: "attention split across several ideas",
      keywords: k("committed|full.?time|conviction|only|focus|all.?in|quit"),
    },
    {
      key: "traction",
      label: "Traction",
      question: () => "What have you shipped, and who is actually using it?",
      pressure: "traction described as interest rather than use",
      keywords: k("traction|users?|customers?|revenue|pilot|launched|shipped|retention"),
    },
    {
      key: "runway",
      label: "Runway",
      question: () => "How many months of cash do you have, and what is the burn?",
      pressure: "a runway answer that is a guess",
      keywords: k("runway|burn|cash|months|bank"),
    },
    {
      key: "execution_speed",
      label: "Execution speed",
      question: () =>
        "What will you have done in the next thirty days that you have not done yet?",
      pressure: "plans with no near-term dates",
      keywords: k("sprint|thirty days|30 days|weekly|ship|iterat|milestone|next month"),
    },
    {
      key: "founder_market_fit",
      label: "Founder-market fit",
      question: () => "Why are you the person to build this, here, now?",
      pressure: "no earned insight into the customer",
      keywords: k("background|experience|insight|years|why me|spoke to|interviews?"),
    },
    {
      key: "capital_efficiency",
      label: "Capital efficiency",
      question: () =>
        "What does the money buy that you cannot do without it?",
      pressure: "a raise sized by habit rather than need",
      keywords: k("capital|efficien|raise|spend|hire|budget|use of funds"),
    },
  ],
  followUp: [
    "Short, direct questions; ask for the number, then the date.",
    "Challenge anything that sounds like a pitch rather than a result.",
    "If the founder is vague on runway or commitment, stay there until it is clear.",
  ],
};

const INVEST_QATAR: Scenario = {
  id: "INVEST_QATAR",
  entityKind: "GOVERNMENT_AGENCY",
  aliases: ["investqatar", "investqataragency"],
  roleLine: "Invest Qatar investment-promotion officer",
  family: "EXECUTIVE",
  openingThemes: [
    "what brings the business to Qatar and how it would enter the market",
    "the contribution it would make to the local economy",
  ],
  directions: [
    {
      key: "market_entry",
      label: "Market entry",
      question: (c) =>
        `How would ${c} enter Qatar: licence, entity, first customers, timeline?`,
      pressure: "an entry plan with no local steps",
      keywords: k("market entry|enter|licen[cs]e|entity|setup|launch|first customers"),
    },
    {
      key: "partnerships",
      label: "Partnerships",
      question: () =>
        "Which local partners or institutions are you working with, or need?",
      pressure: "partners assumed rather than engaged",
      keywords: k("partner|local|government|institution|supplier|joint venture"),
    },
    {
      key: "economic_contribution",
      label: "Economic contribution",
      question: () =>
        "What would this add to the economy: jobs, skills, technology, exports?",
      pressure: "contribution claimed without numbers",
      keywords: k("jobs?|hire|hiring|skills|economy|export|local content|employ"),
    },
    {
      key: "priority_industries",
      label: "Priority industries",
      question: () =>
        "Which national priority sector does this serve, and how do you know it fits?",
      pressure: "sector fit asserted loosely",
      keywords: k("sector|industry|priority|vision|strategy|technology|logistics|fintech"),
    },
    {
      key: "ecosystem_programmes",
      label: "Ecosystem programmes",
      question: () =>
        "Which programmes or incentives would you use, and what would you need from us?",
      pressure: "asking for support without a specific need",
      keywords: k("programme|program|incentive|accelerator|support|free zone|grant"),
    },
    {
      key: "vc_connections",
      label: "VC connections",
      question: () =>
        "If we introduced you to venture funds, what would you ask them for, and when?",
      pressure: "no clear raise or timetable",
      keywords: k("vc|venture|fund|investor|raise|round|series|seed"),
    },
  ],
  followUp: [
    "Courteous and procedural; ask what the next concrete step in Qatar is.",
    "Ask what you can offer in return before what you need.",
    "Do not promise introductions or incentives; ask what would be required.",
  ],
};

const ALRAYAN: Scenario = {
  id: "ALRAYAN_INVESTMENT",
  entityKind: "ORGANIZATION",
  aliases: ["alrayaninvestment", "alrayan", "alrayaninvestmentllc"],
  roleLine: "AlRayan Investment advisory professional",
  family: "INVESTOR",
  openingThemes: [
    "the capital requirement and how it is structured under Sharia principles",
    "whether the business is financially sustainable",
  ],
  directions: [
    {
      key: "sharia_structuring",
      label: "Sharia structuring",
      question: () =>
        "How would the transaction be structured to comply with Sharia principles?",
      pressure: "compliance treated as an afterthought",
      keywords: k("sharia|islamic|compliant|sukuk|murabaha|ijara"),
    },
    {
      key: "financial_sustainability",
      label: "Financial sustainability",
      question: () =>
        "Can the business sustain itself, and what do the numbers say about the next three years?",
      pressure: "profit promised without a basis",
      keywords: k("sustainab|profit|cash flow|break.?even|three years|forecast|margin"),
    },
    {
      key: "capital_instruments",
      label: "Equity, debt and sukuk",
      question: () =>
        "Is the need equity, debt or a sukuk-style instrument, and why?",
      pressure: "an instrument chosen without reasons",
      keywords: k("equity|debt|sukuk|loan|convertible|instrument|dilution"),
    },
    {
      key: "ma_advisory",
      label: "M&A and advisory",
      question: () =>
        "Is there a transaction or strategic move here where advisory would matter?",
      pressure: "no view of how the business ends up",
      keywords: k("m&a|acquisition|merger|advisory|strategic|buyer|sale"),
    },
    {
      key: "capital_requirements",
      label: "Capital requirements",
      question: () =>
        "How much do you need, in what stages, and against what milestones?",
      pressure: "a single large number with no staging",
      keywords: k("capital|raise|stage|tranche|milestone|amount|need"),
    },
    {
      key: "risk_management",
      label: "Risk management",
      question: () =>
        "What are the main risks, and what have you done about each of them?",
      pressure: "risks listed with no mitigation",
      keywords: k("risk|mitigat|hedge|insurance|contingen|downside"),
    },
  ],
  followUp: [
    "Formal and structured; take the topics in order and finish each.",
    "Ask for the structure on paper before accepting a description.",
    "If risk is vague, ask for the worst case in numbers.",
  ],
};

const GENERIC: Record<EntityKind, Scenario> = {
  PERSON: {
    id: "GENERIC_PERSON",
    entityKind: "PERSON",
    aliases: [],
    roleLine: null,
    family: "EXECUTIVE",
    openingThemes: ["what the business does and for whom"],
    directions: [
      {
        key: "model",
        label: "Business model",
        question: () => "How does the business make money?",
        pressure: "revenue with no stated model",
        keywords: k("business model|revenue|pricing|subscription|make money"),
      },
      {
        key: "market",
        label: "Market",
        question: () => "How big is the market, and how did you size it?",
        pressure: "a top-down market figure",
        keywords: k("market|tam|segment|demand|competitor"),
      },
      {
        key: "traction",
        label: "Traction",
        question: () => "What traction do you have so far?",
        pressure: "traction without numbers",
        keywords: k("traction|users?|customers?|revenue|pilot"),
      },
    ],
    followUp: ["Ask a follow-up whenever an answer skips the question."],
  },
  ORGANIZATION: {
    id: "GENERIC_ORGANIZATION",
    entityKind: "ORGANIZATION",
    aliases: [],
    roleLine: null,
    family: "INVESTOR",
    openingThemes: ["what the business does and what it needs from the organisation"],
    directions: [
      {
        key: "fit",
        label: "Fit with the organisation",
        question: () => "Why this organisation, and why now?",
        pressure: "no reason for choosing them",
        keywords: k("fit|why you|mandate|focus|strategy"),
      },
      {
        key: "returns",
        label: "Risk and returns",
        question: () => "What are the risks and the return?",
        pressure: "returns without risk",
        keywords: k("risk|return|yield|downside"),
      },
      {
        key: "terms",
        label: "Terms",
        question: () => "What are you proposing, in what form?",
        pressure: "an ask with no structure",
        keywords: k("terms|structure|equity|debt|raise|amount"),
      },
    ],
    followUp: ["Formal; ask for specifics on the ask before anything else."],
  },
  GOVERNMENT_AGENCY: {
    id: "GENERIC_AGENCY",
    entityKind: "GOVERNMENT_AGENCY",
    aliases: [],
    roleLine: null,
    family: "EXECUTIVE",
    openingThemes: ["how the business would contribute locally"],
    directions: [
      {
        key: "contribution",
        label: "Local contribution",
        question: () => "What would this contribute locally?",
        pressure: "contribution without numbers",
        keywords: k("jobs?|economy|local|skills|export"),
      },
      {
        key: "entry",
        label: "Market entry",
        question: () => "What are the next concrete steps to start?",
        pressure: "no steps",
        keywords: k("enter|launch|licen[cs]e|setup|timeline"),
      },
    ],
    followUp: ["Procedural; ask for the next concrete step."],
  },
};

export const SCENARIOS: readonly Scenario[] = [
  SHADI,
  QINVEST,
  MUHANNAD,
  INVEST_QATAR,
  ALRAYAN,
];

const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** The mode for a subject: by name or alias, else generic for its kind. */
export function scenarioFor(input: {
  readonly displayName: string;
  readonly nameVariants: readonly string[];
  readonly entityKind?: EntityKind | null | undefined;
}): Scenario {
  const names = [input.displayName, ...input.nameVariants].map(squash);
  const named = SCENARIOS.find((scenario) =>
    scenario.aliases.some((alias) => names.includes(alias)),
  );
  return named ?? GENERIC[input.entityKind ?? "PERSON"];
}

/** The line shown as the chip's long form and spoken at the start. */
export function simulationTitle(
  scenario: Scenario,
  displayName: string,
  organizationName: string | null,
): string {
  if (scenario.entityKind === "PERSON") {
    return `Research-informed simulation of ${displayName}'s public priorities`;
  }
  const role =
    scenario.roleLine !== null
      ? `a ${scenario.roleLine}`
      : `a representative of ${organizationName ?? displayName}`;
  return `AI simulation: ${role} (not a real employee)`;
}
