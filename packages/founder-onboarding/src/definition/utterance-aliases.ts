import type { OnboardingUtteranceAliases } from "@capital-q/onboarding";

import { FOUNDER_STEPS } from "./founder-v1.js";

/**
 * Plain-language names a founder uses for the options Founder Definition v2
 * offers (CQ-PRE-REC-001 §19). Recognition only: the conversational
 * interview maps "we're at seed" to the `seed` option and submits it through
 * the ordinary validated path; the definition still decides what is valid.
 * A phrase absent here is not guessed at — it goes to Q's reading.
 */
export const FOUNDER_UTTERANCE_ALIASES: OnboardingUtteranceAliases = {
  [FOUNDER_STEPS.intent]: {
    raising_now: ["raising", "raising now", "fundraising", "we are raising"],
    preparing_to_raise: [
      "preparing",
      "getting ready",
      "soon",
      "in a few months",
    ],
    exploring: ["exploring", "just looking", "not raising", "curious"],
  },
  [FOUNDER_STEPS.stage]: {
    pre_seed: ["preseed", "pre seed", "angel round", "friends and family"],
    seed: ["seed round", "seed stage"],
    series_a: ["series a", "a round"],
    series_b: ["series b", "b round"],
    series_c_plus: ["series c", "series d", "growth", "late stage"],
    unsure: ["not sure", "unsure", "no idea"],
  },
  [FOUNDER_STEPS.country]: {
    ng: ["nigeria", "lagos", "abuja", "nigerian"],
    ke: ["kenya", "nairobi", "kenyan"],
    za: ["south africa", "cape town", "johannesburg", "joburg"],
    gh: ["ghana", "accra", "ghanaian"],
    eg: ["egypt", "cairo", "egyptian"],
    gb: ["uk", "united kingdom", "britain", "london", "england", "british"],
    us: [
      "usa",
      "united states",
      "america",
      "new york",
      "san francisco",
      "american",
    ],
    de: ["germany", "berlin", "german"],
    fr: ["france", "paris", "french"],
    nl: ["netherlands", "amsterdam", "holland", "dutch"],
    ae: ["uae", "dubai", "abu dhabi", "emirates"],
    in: ["india", "bangalore", "bengaluru", "mumbai", "delhi", "indian"],
    sg: ["singapore"],
    br: ["brazil", "sao paulo", "brazilian"],
    ca: ["canada", "toronto", "vancouver", "canadian"],
    other: ["elsewhere", "somewhere else", "another country"],
  },
  [FOUNDER_STEPS.founderRole]: {
    ceo: [
      "chief executive",
      "founder and ceo",
      "co-founder and ceo",
      "i run the company",
    ],
    cto: [
      "chief technology",
      "tech lead",
      "engineering lead",
      "technical cofounder",
      "technical co-founder",
    ],
    coo: ["chief operating", "operations"],
    cpo: ["chief product", "head of product", "product lead"],
    other: ["something else", "other role"],
  },
  [FOUNDER_STEPS.fullTime]: {
    all: ["all full time", "everyone is full time", "all of us", "full time"],
    some: ["some full time", "some of us", "part time for some", "partly"],
    none: ["none full time", "nobody full time", "still part time", "not yet"],
  },
  [FOUNDER_STEPS.functions]: {
    product: ["product"],
    engineering: [
      "engineering",
      "engineers",
      "technical",
      "developers",
      "tech",
    ],
    sales: [
      "sales",
      "partnerships",
      "commercial",
      "business development",
      "bd",
    ],
    operations: ["operations", "ops"],
    finance: ["finance", "cfo"],
    domain: [
      "domain",
      "industry expertise",
      "industry experience",
      "domain expertise",
    ],
  },
  [FOUNDER_STEPS.signal]: {
    pilots: ["pilot", "pilots", "trials", "trial"],
    lois: [
      "loi",
      "lois",
      "letters of intent",
      "letter of intent",
      "signed intent",
    ],
    waitlist: ["waitlist", "wait list", "waiting list", "signups"],
    users: ["users", "active users", "free users", "not paying"],
    none: ["nothing yet", "nothing measurable", "no traction", "none"],
  },
  [FOUNDER_STEPS.revenueStatus]: {
    recurring: ["recurring", "growing", "arr", "mrr", "subscription"],
    recurring_flat: ["flat", "roughly flat", "steady"],
    project: ["project", "one off", "one-off", "projects", "services"],
    early: ["first revenue", "early revenue", "just started"],
  },
  [FOUNDER_STEPS.growth]: {
    over_100: [
      "doubled",
      "more than doubled",
      "tripled",
      "over 100",
      "2x",
      "3x",
    ],
    "50_100": ["50 to 100", "between 50 and 100", "almost doubled"],
    under_50: ["under 50", "less than 50", "modest"],
    flat: ["flat", "down", "declined", "no growth"],
  },
  [FOUNDER_STEPS.raising]: {
    active: [
      "yes",
      "actively",
      "raising now",
      "we are raising",
      "currently raising",
    ],
    preparing: ["preparing", "soon", "getting ready", "next quarter"],
    not_now: ["no", "not now", "not raising", "not at the moment"],
  },
  [FOUNDER_STEPS.currency]: {
    usd: ["dollars", "usd", "us dollar", "$"],
    eur: ["euro", "euros", "eur"],
    gbp: ["pounds", "sterling", "gbp", "£"],
    ngn: ["naira", "ngn"],
    kes: ["shillings", "kenyan shilling", "kes"],
    zar: ["rand", "zar"],
    aed: ["dirham", "aed"],
    inr: ["rupee", "rupees", "inr"],
    sgd: ["singapore dollar", "sgd"],
  },
  [FOUNDER_STEPS.instrument]: {
    priced: ["priced", "equity round", "priced equity", "priced round"],
    safe: ["safe", "safes", "post money safe"],
    convertible: ["convertible", "convertible note", "note", "cln"],
    unsure: ["not sure", "unsure", "undecided"],
  },
  [FOUNDER_STEPS.timeframe]: {
    under_3: [
      "within 3 months",
      "this quarter",
      "next month",
      "asap",
      "immediately",
      "soon",
    ],
    "3_6": ["3 to 6 months", "in six months", "next two quarters"],
    "6_12": ["6 to 12 months", "within a year", "next year", "later this year"],
    unsure: ["not sure", "unsure", "no timeline"],
  },
  [FOUNDER_STEPS.useOfFunds]: {
    product: [
      "product",
      "engineering",
      "build",
      "development",
      "r and d",
      "r&d",
    ],
    hiring: ["hiring", "hires", "team", "recruit", "headcount"],
    gtm: [
      "sales",
      "go to market",
      "go-to-market",
      "marketing",
      "gtm",
      "commercial",
    ],
    runway: ["runway", "operations", "opex", "working capital"],
    expansion: [
      "expansion",
      "new markets",
      "expand",
      "international",
      "us expansion",
    ],
  },
};
