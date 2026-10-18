import type { BlueprintPillar } from "@capital-q/contracts";

/**
 * Readiness rules, version 1: the whole judgement, as data.
 *
 * Each check names a signal (code in ../domain/signals.ts reads it from
 * the company's own records), how much it matters at each stage, and the
 * action that closes it. Changing a weight, a word or a check is a new
 * rules version: the stored assessment records which version produced it,
 * so a reader can always tell why a status changed.
 *
 * Severity by stage rank (pre-seed, seed, Series A, Series B+):
 *   BLOCKER     investors at this stage expect it before a first call;
 *               missing, it is listed under "what could stop the raise"
 *               and the pillar reads Gap.
 *   EXPECTED    missing, the pillar cannot read Strong.
 *   SUPPORTING  adds evidence; missing changes nothing.
 *
 * No weights are summed and nothing becomes a percentage (Q.03 audit;
 * doc 12 §21): a pillar's status follows the rules in ../domain/assess.ts.
 */

export type ReadinessSeverity = "BLOCKER" | "EXPECTED" | "SUPPORTING";

export type ReadinessSignal =
  | "team.founders"
  | "team.backgrounds"
  | "team.identity"
  | "team.size"
  | "profile.description"
  | "profile.categories"
  | "claims.market"
  | "claims.traction"
  | "claims.revenue"
  | "claims.economics"
  | "claims.risk"
  | "verification.organisation"
  | "verification.domain"
  | "dataroom.financials"
  | "dataroom.corporate"
  | "dataroom.fundraising"
  | "raise.target"
  | "raise.use_of_funds"
  | "raise.terms"
  | "deck.present"
  | `deck.section.${string}`;

export type ReadinessOwner = "FOUNDER" | "WITH_Q" | "EXPERT_SUPPORT";

export type ReadinessCheckRule = {
  /** Stable id: the finding id a Blueprint step's `closesGapId` names. */
  readonly id: string;
  readonly pillar: BlueprintPillar;
  readonly signal: ReadinessSignal;
  /** Short noun phrase for summaries ("Revenue evidence"). */
  readonly label: string;
  readonly severity: readonly [
    ReadinessSeverity,
    ReadinessSeverity,
    ReadinessSeverity,
    ReadinessSeverity,
  ];
  /** Stated is not enough: a document must support it (else UNSUPPORTED). */
  readonly requireEvidenced?: boolean | undefined;
  readonly blocker: {
    readonly missing: string;
    readonly unsupported?: string | undefined;
    readonly contradicted?: string | undefined;
    readonly why: string;
  };
  readonly action: {
    readonly key: string;
    readonly title: string;
    readonly why: string;
    readonly next: string;
    readonly doneWhen: string;
    readonly owner: ReadinessOwner;
    readonly href: string | null;
    readonly askQ: string | null;
  };
};

export type ReadinessRules = {
  readonly version: string;
  /** Checks with document-backed (or recorded) evidence a pillar needs to read Strong. */
  readonly strongMinEvidenced: number;
  readonly blockersMax: number;
  readonly pillars: readonly {
    readonly pillar: BlueprintPillar;
    readonly label: string;
    readonly unknownLine: string;
  }[];
  readonly checks: readonly ReadinessCheckRule[];
};

const ALL_EXPECTED = ["EXPECTED", "EXPECTED", "EXPECTED", "EXPECTED"] as const;
const ALL_SUPPORTING = [
  "SUPPORTING",
  "SUPPORTING",
  "SUPPORTING",
  "SUPPORTING",
] as const;
const ALL_BLOCKER = ["BLOCKER", "BLOCKER", "BLOCKER", "BLOCKER"] as const;

export const READINESS_RULES_V1: ReadinessRules = {
  version: "readiness-rules/v1",
  strongMinEvidenced: 2,
  blockersMax: 5,
  pillars: [
    {
      pillar: "FOUNDER",
      label: "Team",
      unknownLine: "Nothing about the founders is on record yet.",
    },
    {
      pillar: "MARKET_OPPORTUNITY",
      label: "Market",
      unknownLine: "No market size or category shared yet.",
    },
    {
      pillar: "PRODUCT_AND_SOLUTION",
      label: "Product",
      unknownLine: "No description of the product shared yet.",
    },
    {
      pillar: "COMMERCIAL_VALIDATION",
      label: "Traction",
      unknownLine: "No customers, usage or revenue shared yet.",
    },
    {
      pillar: "BUSINESS_ECONOMICS",
      label: "Financials",
      unknownLine:
        "No burn, runway, margin or unit economics shared. Q can't say anything here yet.",
    },
    {
      pillar: "EXECUTION_CAPACITY",
      label: "Execution",
      unknownLine: "No team size or go-to-market plan shared yet.",
    },
    {
      pillar: "GOVERNANCE_AND_TRUST",
      label: "Governance & trust",
      unknownLine: "No verification, cap table or company documents yet.",
    },
    {
      pillar: "INVESTMENT_READINESS",
      label: "Raise & documents",
      unknownLine: "No raise or pitch deck recorded yet.",
    },
  ],
  checks: [
    // FOUNDER --------------------------------------------------------------
    {
      id: "team.founders",
      pillar: "FOUNDER",
      signal: "team.founders",
      label: "Founders named",
      severity: ALL_EXPECTED,
      blocker: {
        missing: "Who the founders are isn't on record",
        why: "The first thing an investor checks is who is building this.",
      },
      action: {
        key: "confirm-founders",
        title: "Confirm who the founders are",
        why: "Investors back people first; the team must be on record.",
        next: "Add the founders and whether they are full-time.",
        doneWhen: "Founder count and full-time status are on your profile.",
        owner: "FOUNDER",
        href: "/profile",
        askQ: null,
      },
    },
    {
      id: "team.backgrounds",
      pillar: "FOUNDER",
      signal: "team.backgrounds",
      label: "Founder backgrounds",
      severity: ALL_SUPPORTING,
      blocker: {
        missing: "No founder backgrounds",
        why: "Investors look for why this team can win this market.",
      },
      action: {
        key: "founder-backgrounds",
        title: "Add each founder's background",
        why: "Relevant experience is the quickest answer to 'why you?'.",
        next: "Add one or two lines of relevant experience per founder.",
        doneWhen: "Each founder has a background line.",
        owner: "FOUNDER",
        href: "/profile",
        askQ: null,
      },
    },
    {
      id: "team.identity",
      pillar: "FOUNDER",
      signal: "team.identity",
      label: "Founder identity verified",
      severity: ["SUPPORTING", "EXPECTED", "EXPECTED", "EXPECTED"],
      blocker: {
        missing: "No founder identity is verified",
        why: "A verified founder is the first trust signal investors see.",
      },
      action: {
        key: "verify-identity",
        title: "Verify your identity",
        why: "Investors see a verified founder before anything else.",
        next: "Start identity verification.",
        doneWhen: "At least one founder is verified.",
        owner: "FOUNDER",
        href: "/verification",
        askQ: null,
      },
    },
    {
      id: "deck.founders",
      pillar: "FOUNDER",
      signal: "deck.section.FOUNDERS",
      label: "Founders slide",
      severity: ALL_SUPPORTING,
      blocker: {
        missing: "The deck doesn't introduce the founders",
        why: "The deck is often read before the profile.",
      },
      action: {
        key: "deck-founders",
        title: "Strengthen the founders slide",
        why: "The deck is often read before the profile.",
        next: "Say why this team is the one to build it.",
        doneWhen: "Q reads the founders slide as Clear or better.",
        owner: "FOUNDER",
        href: "/pitch",
        askQ: null,
      },
    },
    // MARKET ---------------------------------------------------------------
    {
      id: "market.size",
      pillar: "MARKET_OPPORTUNITY",
      signal: "claims.market",
      label: "Market size",
      severity: ALL_EXPECTED,
      requireEvidenced: true,
      blocker: {
        missing: "No market size",
        unsupported: "Your market size has no source",
        contradicted: "Two figures for your market size",
        why: "A stated market size without a source gets discounted.",
      },
      action: {
        key: "source-market",
        title: "Source your market size",
        why: "A stated number without a source gets discounted.",
        next: "Add a market size with a public source or report.",
        doneWhen: "Market size is supported by a document or source.",
        owner: "WITH_Q",
        href: null,
        askQ: "Find public sources for my market size and show me what you'd keep.",
      },
    },
    {
      id: "deck.market",
      pillar: "MARKET_OPPORTUNITY",
      signal: "deck.section.MARKET",
      label: "Market slide",
      severity: ALL_EXPECTED,
      blocker: {
        missing: "The deck doesn't size the market",
        why: "Investors need to see the size of the prize.",
      },
      action: {
        key: "deck-market",
        title: "Make the market slide clear",
        why: "Investors need to see the size of the prize.",
        next: "Size the market bottom-up and say who buys.",
        doneWhen: "Q reads the market slide as Clear or better.",
        owner: "FOUNDER",
        href: "/pitch",
        askQ: null,
      },
    },
    {
      id: "profile.categories",
      pillar: "MARKET_OPPORTUNITY",
      signal: "profile.categories",
      label: "Sector",
      severity: ALL_SUPPORTING,
      blocker: {
        missing: "No sector chosen",
        why: "Investors filter by sector before anything else.",
      },
      action: {
        key: "choose-sector",
        title: "Choose your sector",
        why: "Investors filter by sector before anything else.",
        next: "Pick the categories that describe the company.",
        doneWhen: "At least one category is on your profile.",
        owner: "FOUNDER",
        href: "/profile",
        askQ: null,
      },
    },
    // PRODUCT --------------------------------------------------------------
    {
      id: "profile.description",
      pillar: "PRODUCT_AND_SOLUTION",
      signal: "profile.description",
      label: "Product description",
      severity: ALL_EXPECTED,
      blocker: {
        missing: "No description of what you do",
        why: "An investor must understand the product in one line.",
      },
      action: {
        key: "describe-product",
        title: "Describe the product in one line",
        why: "An investor must understand the product in one line.",
        next: "Write what you sell, to whom, and why they pay.",
        doneWhen: "Your profile has a description.",
        owner: "FOUNDER",
        href: "/profile",
        askQ: null,
      },
    },
    {
      id: "deck.problem",
      pillar: "PRODUCT_AND_SOLUTION",
      signal: "deck.section.PROBLEM",
      label: "Problem slide",
      severity: ALL_EXPECTED,
      blocker: {
        missing: "The deck doesn't state the problem",
        why: "Without a clear problem the product has nothing to solve.",
      },
      action: {
        key: "deck-problem",
        title: "Put a number on the problem",
        why: "A quantified pain is what makes investors lean in.",
        next: "Say who has the problem and what it costs them.",
        doneWhen: "Q reads the problem slide as Clear or better.",
        owner: "FOUNDER",
        href: "/pitch",
        askQ: null,
      },
    },
    {
      id: "deck.solution",
      pillar: "PRODUCT_AND_SOLUTION",
      signal: "deck.section.SOLUTION",
      label: "Solution slide",
      severity: ALL_EXPECTED,
      blocker: {
        missing: "The deck doesn't show the product",
        why: "Investors need to see what you built.",
      },
      action: {
        key: "deck-solution",
        title: "Show the product in the deck",
        why: "Investors need to see what you built.",
        next: "Explain the product in one sentence and show it.",
        doneWhen: "Q reads the solution slide as Clear or better.",
        owner: "FOUNDER",
        href: "/pitch",
        askQ: null,
      },
    },
    // TRACTION -------------------------------------------------------------
    {
      id: "traction.metrics",
      pillar: "COMMERCIAL_VALIDATION",
      signal: "claims.traction",
      label: "Traction figures",
      severity: ALL_EXPECTED,
      blocker: {
        missing: "No traction figures",
        contradicted: "Two figures for the same traction number",
        why: "Two figures for one fact make investors check everything twice.",
      },
      action: {
        key: "traction-figures",
        title: "Share your traction figures",
        why: "Customers, usage or pilots are the evidence the market wants this.",
        next: "Add customers, usage or pilot numbers, each with a date.",
        doneWhen: "Traction figures are on record with no open contradiction.",
        owner: "FOUNDER",
        href: "/documents",
        askQ: null,
      },
    },
    {
      id: "traction.revenue",
      pillar: "COMMERCIAL_VALIDATION",
      signal: "claims.revenue",
      label: "Revenue evidence",
      severity: ["SUPPORTING", "BLOCKER", "BLOCKER", "BLOCKER"],
      requireEvidenced: true,
      blocker: {
        missing: "No revenue evidence yet",
        unsupported: "Revenue is stated but no document backs it",
        contradicted: "Two figures for revenue",
        why: "Investors at this stage ask for revenue evidence before a first call. Three months of statements or invoices close it.",
      },
      action: {
        key: "revenue-evidence",
        title: "Add 3 months of revenue evidence",
        why: "Investors at this stage ask for it before a first call.",
        next: "Upload bank statements or invoices for the last three months.",
        doneWhen: "Revenue is supported by a document.",
        owner: "FOUNDER",
        href: "/documents",
        askQ: null,
      },
    },
    {
      id: "deck.traction",
      pillar: "COMMERCIAL_VALIDATION",
      signal: "deck.section.TRACTION",
      label: "Traction slide",
      severity: ALL_EXPECTED,
      blocker: {
        missing: "The deck has no traction",
        why: "Traction is the slide investors spend longest on.",
      },
      action: {
        key: "deck-traction",
        title: "Make the traction slide count",
        why: "Traction is the slide investors spend longest on.",
        next: "Show the trend over time, with dates on every number.",
        doneWhen: "Q reads the traction slide as Clear or better.",
        owner: "FOUNDER",
        href: "/pitch",
        askQ: null,
      },
    },
    // FINANCIALS -----------------------------------------------------------
    {
      id: "financials.economics",
      pillar: "BUSINESS_ECONOMICS",
      signal: "claims.economics",
      label: "Burn, runway or margin",
      severity: ["SUPPORTING", "EXPECTED", "BLOCKER", "BLOCKER"],
      blocker: {
        missing: "No burn, runway or margin shared",
        contradicted: "Two figures for the same financial number",
        why: "Investors size the round against your burn and runway.",
      },
      action: {
        key: "share-burn-runway",
        title: "Share burn and runway",
        why: "Investors size the round against your runway.",
        next: "Add monthly burn, runway in months, and gross margin if you have it.",
        doneWhen: "Burn or runway is on record.",
        owner: "FOUNDER",
        href: "/documents",
        askQ: null,
      },
    },
    {
      id: "dataroom.financials",
      pillar: "BUSINESS_ECONOMICS",
      signal: "dataroom.financials",
      label: "Financial statements",
      severity: ["SUPPORTING", "EXPECTED", "BLOCKER", "BLOCKER"],
      blocker: {
        missing: "No financial statements in the data room",
        why: "Financial statements are the first diligence request.",
      },
      action: {
        key: "upload-financials",
        title: "Upload your financial statements",
        why: "They are the first diligence request.",
        next: "Add management accounts or a financial model to the data room.",
        doneWhen: "The data room's financials items are filed.",
        owner: "FOUNDER",
        href: "/documents",
        askQ: null,
      },
    },
    {
      id: "deck.business-model",
      pillar: "BUSINESS_ECONOMICS",
      signal: "deck.section.BUSINESS_MODEL",
      label: "Business model slide",
      severity: ALL_EXPECTED,
      blocker: {
        missing: "The deck doesn't say how you make money",
        why: "Investors need to see how a customer becomes revenue.",
      },
      action: {
        key: "deck-business-model",
        title: "Say how you make money",
        why: "Investors need to see how a customer becomes revenue.",
        next: "Show price, who pays, and the margin on each sale.",
        doneWhen: "Q reads the business model slide as Clear or better.",
        owner: "FOUNDER",
        href: "/pitch",
        askQ: null,
      },
    },
    // EXECUTION ------------------------------------------------------------
    {
      id: "team.size",
      pillar: "EXECUTION_CAPACITY",
      signal: "team.size",
      label: "Team size",
      severity: ALL_EXPECTED,
      blocker: {
        missing: "Team size isn't on record",
        why: "Investors read the plan against the team that delivers it.",
      },
      action: {
        key: "team-size",
        title: "Add your team size",
        why: "Investors read the plan against the team that delivers it.",
        next: "Say how many people work on the company today.",
        doneWhen: "Team size is on your profile.",
        owner: "FOUNDER",
        href: "/profile",
        askQ: null,
      },
    },
    {
      id: "deck.go-to-market",
      pillar: "EXECUTION_CAPACITY",
      signal: "deck.section.GO_TO_MARKET",
      label: "Go-to-market slide",
      severity: ["SUPPORTING", "EXPECTED", "EXPECTED", "EXPECTED"],
      blocker: {
        missing: "The deck has no go-to-market plan",
        why: "How you reach customers is how the money turns into growth.",
      },
      action: {
        key: "deck-go-to-market",
        title: "Show how you reach customers",
        why: "It is how the money turns into growth.",
        next: "Name the channel that works today and what it costs.",
        doneWhen: "Q reads the go-to-market slide as Clear or better.",
        owner: "FOUNDER",
        href: "/pitch",
        askQ: null,
      },
    },
    // GOVERNANCE -----------------------------------------------------------
    {
      id: "verification.organisation",
      pillar: "GOVERNANCE_AND_TRUST",
      signal: "verification.organisation",
      label: "Company verified",
      severity: ALL_EXPECTED,
      blocker: {
        missing: "The company isn't verified",
        why: "Verification tells investors the company is real and yours.",
      },
      action: {
        key: "verify-company",
        title: "Verify the company",
        why: "It tells investors the company is real and yours.",
        next: "Request company verification.",
        doneWhen: "The company is verified.",
        owner: "FOUNDER",
        href: "/verification",
        askQ: null,
      },
    },
    {
      id: "verification.domain",
      pillar: "GOVERNANCE_AND_TRUST",
      signal: "verification.domain",
      label: "Domain verified",
      severity: ALL_SUPPORTING,
      blocker: {
        missing: "Your web domain isn't verified",
        why: "A verified domain links the company to its website.",
      },
      action: {
        key: "verify-domain",
        title: "Verify your web domain",
        why: "It links the company to its website.",
        next: "Verify the domain from Verification.",
        doneWhen: "Your domain is verified.",
        owner: "FOUNDER",
        href: "/verification",
        askQ: null,
      },
    },
    {
      id: "dataroom.corporate",
      pillar: "GOVERNANCE_AND_TRUST",
      signal: "dataroom.corporate",
      label: "Company and cap table documents",
      severity: ["EXPECTED", "EXPECTED", "BLOCKER", "BLOCKER"],
      requireEvidenced: true,
      blocker: {
        missing: "No company or cap table documents in the data room",
        unsupported: "Some company or cap table documents are missing",
        why: "Incorporation, ownership and the cap table are checked in every diligence.",
      },
      action: {
        key: "corporate-documents",
        title: "File incorporation and cap table documents",
        why: "They are checked in every diligence.",
        next: "Add the certificate of incorporation and a cap table summary.",
        doneWhen: "Every company and cap table item for your stage is filed.",
        owner: "EXPERT_SUPPORT",
        href: "/documents",
        askQ: null,
      },
    },
    {
      id: "risk.disclosed",
      pillar: "GOVERNANCE_AND_TRUST",
      signal: "claims.risk",
      label: "Risks and compliance",
      severity: ALL_SUPPORTING,
      blocker: {
        missing: "No risks or compliance stated",
        why: "Naming the risks yourself builds trust.",
      },
      action: {
        key: "state-risks",
        title: "Name your main risks",
        why: "Naming the risks yourself builds trust.",
        next: "Add the two or three risks you are managing and how.",
        doneWhen: "A risk or compliance fact is on record.",
        owner: "FOUNDER",
        href: "/documents",
        askQ: null,
      },
    },
    // RAISE & DOCUMENTS ----------------------------------------------------
    {
      id: "raise.deck",
      pillar: "INVESTMENT_READINESS",
      signal: "deck.present",
      label: "Pitch deck",
      severity: ALL_BLOCKER,
      blocker: {
        missing: "No pitch deck",
        why: "Almost every investor asks for the deck first.",
      },
      action: {
        key: "upload-deck",
        title: "Upload your pitch deck",
        why: "Almost every investor asks for the deck first.",
        next: "Upload the deck you are sending investors.",
        doneWhen: "A pitch deck is on your profile.",
        owner: "FOUNDER",
        href: "/pitch",
        askQ: null,
      },
    },
    {
      id: "raise.target",
      pillar: "INVESTMENT_READINESS",
      signal: "raise.target",
      label: "Raise target",
      severity: ALL_EXPECTED,
      blocker: {
        missing: "No raise recorded",
        contradicted: "Two figures for your raise",
        why: "Investors need to know how much you are raising.",
      },
      action: {
        key: "record-raise",
        title: "Record your raise",
        why: "Investors need to know how much you are raising.",
        next: "Add the target and the currency on Capital.",
        doneWhen: "A current raise with a target is on Capital.",
        owner: "FOUNDER",
        href: "/capital",
        askQ: null,
      },
    },
    {
      id: "raise.use-of-funds",
      pillar: "INVESTMENT_READINESS",
      signal: "raise.use_of_funds",
      label: "Use of funds",
      severity: ["EXPECTED", "BLOCKER", "BLOCKER", "BLOCKER"],
      blocker: {
        missing: "No use of funds",
        why: "A target with no plan for the money reads as unfinished.",
      },
      action: {
        key: "use-of-funds",
        title: "Name your use of funds",
        why: "A target with no plan for the money reads as unfinished.",
        next: "Say where the money goes: hiring, product, growth, runway.",
        doneWhen: "The raise lists where the money goes.",
        owner: "WITH_Q",
        href: "/capital",
        askQ: "Draft my use of funds from my deck and plans, for me to approve.",
      },
    },
    {
      id: "raise.terms",
      pillar: "INVESTMENT_READINESS",
      signal: "raise.terms",
      label: "Instrument and terms",
      severity: ["SUPPORTING", "EXPECTED", "EXPECTED", "EXPECTED"],
      blocker: {
        missing: "No instrument or valuation for the raise",
        why: "Investors decide faster when the instrument is known.",
      },
      action: {
        key: "raise-terms",
        title: "Set the instrument and terms",
        why: "Investors decide faster when the instrument is known.",
        next: "Choose SAFE, note or equity, and the cap or valuation if set.",
        doneWhen: "The raise has an instrument or valuation.",
        owner: "FOUNDER",
        href: "/capital",
        askQ: null,
      },
    },
    {
      id: "deck.the-ask",
      pillar: "INVESTMENT_READINESS",
      signal: "deck.section.THE_ASK",
      label: "The ask slide",
      severity: ALL_EXPECTED,
      blocker: {
        missing: "The deck doesn't state the ask",
        why: "The ask tells investors whether the round fits their cheque.",
      },
      action: {
        key: "deck-the-ask",
        title: "State the ask in the deck",
        why: "It tells investors whether the round fits their cheque.",
        next: "Say how much, on what instrument, and what it buys.",
        doneWhen: "Q reads the ask slide as Clear or better.",
        owner: "FOUNDER",
        href: "/pitch",
        askQ: null,
      },
    },
    {
      id: "dataroom.fundraising",
      pillar: "INVESTMENT_READINESS",
      signal: "dataroom.fundraising",
      label: "Fundraising documents",
      severity: ALL_EXPECTED,
      blocker: {
        missing: "No fundraising documents in the data room",
        why: "A one-page summary is what gets forwarded inside a fund.",
      },
      action: {
        key: "one-pager",
        title: "Add a one-page summary",
        why: "It is what gets forwarded inside a fund.",
        next: "File a one-page summary in the data room.",
        doneWhen: "The data room's fundraising items are filed.",
        owner: "WITH_Q",
        href: "/documents",
        askQ: "Draft a one-page summary of my company for investors, for me to approve.",
      },
    },
  ],
};
