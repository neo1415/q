/**
 * The shape of the fictional demo world (SEED).
 *
 * Every company, person and investor described with these types is
 * invented for demonstrations. None is a real company, a real person or
 * real customer data, and every story says so in its first line.
 *
 * Money is a decimal string plus an ISO 4217 currency code, never a float.
 * Truth class and evidence status are separate axes (ADR-001); a claim
 * with nothing behind it says UNKNOWN / NO_EVIDENCE rather than zero.
 */

export type Money = { readonly amount: string; readonly currency: string };

export type FictionalClaim = {
  /** Stable natural key inside the company: the idempotency key of the claim. */
  readonly claimKey: string;
  readonly claimType: string;
  readonly statement: string;
  readonly structuredValue?: Readonly<Record<string, unknown>> | undefined;
  readonly truthClass: "USER_CLAIM" | "ESTIMATE" | "UNKNOWN";
  readonly evidenceStatus:
    "NO_EVIDENCE" | "SELF_REPORTED" | "DOCUMENT_SUPPORTED";
  readonly lifecycleStatus?: "CURRENT" | "CONTRADICTORY" | undefined;
  /** For DOCUMENT_SUPPORTED: the (fictional) document the figure comes from. */
  readonly documentTitle?: string | undefined;
};

/** One line of the deck, by Company Intelligence dimension. */
export type DeckLine = {
  readonly dimension:
    | "DESCRIPTION"
    | "PRODUCT"
    | "MARKET"
    | "BUSINESS_MODEL"
    | "CUSTOMERS"
    | "TRACTION"
    | "FINANCIAL"
    | "TEAM"
    | "STRATEGY"
    | "CAPITAL_OBJECTIVE";
  readonly statement: string;
  readonly truthClass?: "USER_CLAIM" | "ESTIMATE" | undefined;
};

export type FictionalCompany = {
  /** Stable natural key: account email, idempotency keys and the manifest use it. */
  readonly key: string;
  readonly name: string;
  readonly legalName: string;
  readonly website: string;
  readonly foundedDate: string;
  /** Founder onboarding option keys. */
  readonly countryOption: "ng" | "ke" | "gh" | "za" | "eg";
  readonly city: string;
  readonly stageOption: "pre_seed" | "seed" | "series_a" | "series_b";
  readonly shortDescription: string;
  /** Canonical taxonomy codes (industry / product_category / business_model / customer_type). */
  readonly categories: readonly string[];
  readonly founder: {
    readonly displayName: string;
    readonly headline: string;
    readonly roleOption: "ceo" | "cto" | "coo" | "cpo" | "other";
    readonly businessTitle: string;
    readonly professionalSummary: string;
    readonly backgroundSummary: string;
  };
  readonly team: {
    readonly founderCount: number;
    readonly fullTimeOption: "all" | "some" | "none";
    readonly fullTimeFounderCount: number;
    readonly teamSize: number;
    readonly functions: readonly string[];
  };
  /** F5: early stage answers signal/pilots; later stage revenue/customers/growth. */
  readonly signal?: "pilots" | "lois" | "waitlist" | "users" | "none" | undefined;
  readonly pilots?: number | undefined;
  readonly revenueStatus?:
    "recurring" | "recurring_flat" | "project" | "early" | undefined;
  readonly customers?: number | undefined;
  readonly growth?: "over_100" | "50_100" | "under_50" | "flat" | undefined;
  readonly raise: {
    readonly target: Money;
    readonly currencyOption: "usd" | "ngn" | "kes" | "zar";
    readonly instrument: "priced" | "safe" | "convertible" | "unsure";
    readonly timeframe: "under_3" | "3_6" | "6_12" | "unsure";
    readonly useOfFunds: readonly (
      "product" | "hiring" | "gtm" | "runway" | "expansion"
    )[];
  };
  readonly story: {
    readonly problem: string;
    readonly solution: string;
    readonly traction: string;
    readonly team: string;
    readonly market: string;
    readonly competition: string;
    readonly risks: string;
    readonly raise: string;
    /** Things the company has not told Capital Q. Said as not known, never as zero. */
    readonly unknowns: readonly string[];
  };
  readonly claims: readonly FictionalClaim[];
  readonly deck: readonly DeckLine[];
  readonly direction?: "MINIMAL_INSTITUTIONAL" | "DARK_TECHNICAL" | "WARM_GROWTH";
};

export type FictionalInvestor = {
  readonly key: string;
  readonly name: string;
  readonly typeOption:
    "angel" | "vc" | "family_office" | "cvc" | "syndicate" | "institutional";
  readonly person: {
    readonly displayName: string;
    readonly headline: string;
    readonly businessTitle: string;
  };
  readonly stages: readonly ("pre_seed" | "seed" | "series_a" | "series_b")[];
  readonly currencyOption: "usd" | "ngn" | "kes" | "zar";
  readonly cheque: { readonly min: string; readonly typical: string; readonly max: string };
  readonly roles: readonly ("lead" | "co_invest" | "follow")[];
  /** Canonical geography codes. */
  readonly geographies: readonly string[];
  /** Canonical industry / product_category codes. */
  readonly sectors: readonly string[];
  readonly thesis: string;
  readonly discoveryMode: "strict" | "balanced" | "exploratory";
};

/** An investor's interest in a company, and how the founder answered (if at all). */
export type FictionalInterest = {
  readonly investorKey: string;
  readonly companyKey: string;
  readonly founderAnswer: "accept" | "decline" | "pending";
};
